import express from 'express';
import mqtt from 'mqtt';
import * as dotenv from 'dotenv';
import cors from 'cors';
import { readFileSync } from 'fs';
import path from 'path';
import { 
  initDb, 
  getAllLocations, 
  createLocation, 
  updateLocation,
  getAllDevices, 
  getDeviceById, 
  getDeviceByLocationId,
  autoRegisterDevice, 
  enrollDevice,
  bindDeviceToLocation,
  unregisterDevice
} from './db.js'; // Note the .js extension for ES Module compatibility

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const mqttBrokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://broker.hivemq.com:1883';

// Dynamically resolve application version from package.json (Industry best practice)
const getAppVersion = (): string => {
  try {
    const packageJsonPath = path.resolve(__dirname, '../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version || '1.0.0';
  } catch (error) {
    console.warn('[VERSION] Could not dynamically load version from package.json, falling back to 1.0.0', error);
    return '1.0.0';
  }
};
const appVersion = getAppVersion();

app.use(express.json());
app.use(cors());

// --- In-Memory Real-Time Telemetry Cache ---
interface CachedTelemetry {
  gridActive: boolean;
  uptime: number;
  freeHeap: number;
  wifiRssi: number;
  timestamp: number;
}

const telemetryCache: Record<string, CachedTelemetry> = {};

// --- In-Memory Rolling Ingestion Logs Buffer ---
interface LogEntry {
  timestamp: number;
  message: string;
}
const logBuffer: LogEntry[] = [];
const addLog = (message: string) => {
  logBuffer.unshift({ timestamp: Date.now(), message });
  if (logBuffer.length > 50) {
    logBuffer.pop();
  }
};

// --- REST API Endpoints ---

// Serve rolling ingestion logs
app.get('/api/logs', (req, res) => {
  res.json(logBuffer);
});

// API Index Welcome
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the Project Lunagrid REST API',
    version: appVersion,
    endpoints: {
      health: 'GET /api/health',
      locations: 'GET /api/locations',
      devices: 'GET /api/devices',
      enrollDevice: 'POST /api/devices/enroll'
    }
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', version: appVersion, timestamp: new Date() });
});

// Locations API
app.get('/api/locations', async (req, res) => {
  try {
    const locations = await getAllLocations();
    res.json(locations);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve locations' });
  }
});

app.post('/api/locations', async (req, res) => {
  const { id, name, timezone } = req.body;
  if (!id || !name || !timezone) {
    return res.status(400).json({ error: 'id, name, and timezone are required' });
  }
  try {
    await createLocation(id, name, timezone);
    res.status(201).json({ status: 'created', location: { id, name, timezone } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create location. ID may already exist.' });
  }
});

app.put('/api/locations/:id', async (req, res) => {
  const id = req.params.id;
  const { name, timezone } = req.body;
  if (!name || !timezone) {
    return res.status(400).json({ error: 'name and timezone are required' });
  }
  try {
    await updateLocation(id, name, timezone);
    res.json({ status: 'success', location: { id, name, timezone } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// Map a device to a location (enforcing 1-device-per-location)
app.post('/api/locations/:id/bind', async (req, res) => {
  const locationId = req.params.id;
  const { deviceId } = req.body; // Can be null to unbind
  try {
    await bindDeviceToLocation(deviceId || null, locationId);
    res.json({ status: 'success', message: `Device ${deviceId} bound to location ${locationId}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to bind device to location' });
  }
});

// Retrieve latest telemetry cache for a location
app.get('/api/locations/:id/telemetry', async (req, res) => {
  const locationId = req.params.id;
  try {
    const device = await getDeviceByLocationId(locationId);
    if (!device) {
      return res.json({ gridActive: false, uptime: 0, freeHeap: 0, wifiRssi: 0, timestamp: 0, deviceId: null });
    }
    const cached = telemetryCache[device.id] || {
      gridActive: false,
      uptime: 0,
      freeHeap: 0,
      wifiRssi: 0,
      timestamp: 0
    };
    res.json({
      ...cached,
      deviceId: device.id,
      friendlyName: device.friendly_name
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve telemetry' });
  }
});

// Query InfluxDB securely for last 24h history for a location's device
app.get('/api/locations/:id/history', async (req, res) => {
  const locationId = req.params.id;
  try {
    const device = await getDeviceByLocationId(locationId);
    if (!device) {
      return res.json([]);
    }

    // Secure Flux Query targeting the device's timeline
    const fluxQuery = `from(bucket: "lunagrid-telemetry")
  |> range(start: -24h)
  |> filter(fn: (r) => r["_measurement"] == "mqtt_consumer" and r["device_id"] == "${device.id}")
  |> filter(fn: (r) => r["_field"] == "grid_active")
  |> keep(columns: ["_time", "_value"])`;

    // Query InfluxDB container securely using Node 20 fetch
    const response = await fetch('http://influxdb:8086/api/v2/query?org=lunagrid-org', {
      method: 'POST',
      headers: {
        'Authorization': 'Token lunagrid_secure_pass123',
        'Content-Type': 'application/vnd.flux',
        'Accept': 'application/csv'
      },
      body: fluxQuery
    });

    if (!response.ok) {
      throw new Error(`InfluxDB query failed: ${response.statusText}`);
    }

    const csvText = await response.text();
    const lines = csvText.split('\n');
    const history: Array<{ time: string; active: boolean }> = [];

    for (const line of lines) {
      const parts = line.split(',');
      // Parse CSV result rows from InfluxDB query engine
      // Since the Flux query keeps only _time and _value, columns are: ,result,table,_time,_value (length of 5)
      if (parts.length >= 5 && parts[0] === '' && (parts[1] === '_result' || parts[1] === 'result')) {
        if (parts[3] === '_time') continue; // Skip header row
        
        const time = parts[3];
        const active = parts[4].trim() === 'true';
        history.push({ time, active });
      }
    }

    // Sort by time descending (latest first)
    history.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    res.json(history);
  } catch (error) {
    console.error('[HISTORY] Error fetching from InfluxDB:', error);
    res.status(500).json({ error: 'Failed to retrieve historical telemetry' });
  }
});

// Query InfluxDB for last 7 days of B-tariff compliance metrics
app.get('/api/locations/:id/compliance', async (req, res) => {
  const locationId = req.params.id;
  try {
    const device = await getDeviceByLocationId(locationId);
    if (!device) {
      return res.json([]);
    }

    // Flux query that aggregates true/false states into hourly fractions, then sums them daily.
    // Result value is the total active hours in that 1-day calendar window.
    const fluxQuery = `from(bucket: "lunagrid-telemetry")
  |> range(start: -7d)
  |> filter(fn: (r) => r["_measurement"] == "mqtt_consumer" and r["device_id"] == "${device.id}")
  |> filter(fn: (r) => r["_field"] == "grid_active")
  |> map(fn: (r) => ({ r with _value: if string(v: r._value) == "true" then 1.0 else 0.0 }))
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false)
  |> keep(columns: ["_time", "_value"])`;

    const response = await fetch('http://influxdb:8086/api/v2/query?org=lunagrid-org', {
      method: 'POST',
      headers: {
        'Authorization': 'Token lunagrid_secure_pass123',
        'Content-Type': 'application/vnd.flux',
        'Accept': 'application/csv'
      },
      body: fluxQuery
    });

    if (!response.ok) {
      throw new Error(`InfluxDB query failed: ${response.statusText}`);
    }

    const csvText = await response.text();
    const lines = csvText.split('\n');
    const compliance: Array<{ date: string; activeHours: number; compliant: boolean }> = [];

    for (const line of lines) {
      const parts = line.split(',');
      // Since the Flux query keeps only _time and _value, columns are: ,result,table,_time,_value (length of 5)
      if (parts.length >= 5 && parts[0] === '' && (parts[1] === '_result' || parts[1] === 'result')) {
        if (parts[3] === '_time') continue; // Skip header row
        
        const time = parts[3];
        const activeHours = Math.round(parseFloat(parts[4]) * 10) / 10; // Round to 1 decimal place
        compliance.push({
          date: time,
          activeHours: activeHours,
          compliant: activeHours >= 8.0
        });
      }
    }

    // Sort by date ascending (oldest first, so it renders nicely from left to right)
    compliance.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    res.json(compliance);
  } catch (error) {
    console.error('[COMPLIANCE] Error fetching compliance metrics:', error);
    res.status(500).json({ error: 'Failed to retrieve compliance records' });
  }
});

// Devices API
app.get('/api/devices', async (req, res) => {
  try {
    const devices = await getAllDevices();
    res.json(devices);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve devices' });
  }
});

app.post('/api/devices/enroll', async (req, res) => {
  const { id, locationId, friendlyName } = req.body;
  if (!id || !friendlyName) {
    return res.status(400).json({ error: 'id and friendlyName are required' });
  }
  try {
    await enrollDevice(id, locationId || null, friendlyName);
    res.json({ status: 'success', message: `Device ${id} enrolled.` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to enroll device' });
  }
});

app.delete('/api/devices/:id', async (req, res) => {
  const id = req.params.id;
  try {
    await unregisterDevice(id);
    res.json({ status: 'success', message: `Device ${id} deleted.` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

// --- Boot Server and Ingest ---
const startServer = async () => {
  try {
    await initDb();
    console.log('[DATABASE] SQLite database initialized successfully.');
  } catch (err) {
    console.error('[DATABASE] Failed to initialize SQLite database:', err);
    process.exit(1);
  }

  app.listen(port, () => {
    console.log(`[BACKEND] Server running on http://localhost:${port}`);
  });

  console.log(`[MQTT] Connecting to broker at ${mqttBrokerUrl}`);
  const mqttClient = mqtt.connect(mqttBrokerUrl);

  mqttClient.on('connect', () => {
    console.log('[MQTT] Connected successfully to broker');
    mqttClient.subscribe([
      'lunagrid/devices/+/state',
      'lunagrid/devices/+/telemetry'
    ], (err) => {
      if (err) {
        console.error('[MQTT] Subscription failed:', err);
      } else {
        console.log('[MQTT] Subscribed to device message channels.');
      }
    });
  });

  mqttClient.on('message', async (topic, message) => {
    const topicParts = topic.split('/');
    if (topicParts.length < 4) return;

    const deviceId = topicParts[2];
    const messageType = topicParts[3]; // 'state' or 'telemetry'

    try {
      const payload = JSON.parse(message.toString());
      await autoRegisterDevice(deviceId);

      // Initialize cache block if needed
      if (!telemetryCache[deviceId]) {
        telemetryCache[deviceId] = {
          gridActive: false,
          uptime: 0,
          freeHeap: 0,
          wifiRssi: 0,
          timestamp: 0
        };
      }

      // Update in-memory telemetry cache
      if (messageType === 'state') {
        telemetryCache[deviceId].gridActive = payload.grid_active;
        telemetryCache[deviceId].timestamp = Date.now();
      } else if (messageType === 'telemetry') {
        telemetryCache[deviceId].uptime = payload.metrics.uptime_seconds;
        telemetryCache[deviceId].freeHeap = payload.metrics.free_heap_bytes;
        telemetryCache[deviceId].wifiRssi = payload.status.wifi_rssi;
        telemetryCache[deviceId].timestamp = Date.now();
      }

      const device = await getDeviceById(deviceId);
      const enrichedPayload = {
        ...payload,
        device_id: deviceId,
        friendly_name: device?.friendly_name || null,
        location_id: device?.location_id || null,
        status: device?.status || 'PENDING'
      };

      const statusText = telemetryCache[deviceId].gridActive ? 'OFF-PEAK (B-Tariff Active)' : 'ON-PEAK (B-Tariff Inactive)';
      const logLine = `Type: ${messageType.toUpperCase()} | Device: ${deviceId} | Location: ${enrichedPayload.location_id || 'UNASSIGNED'} | State: ${statusText}`;
      console.log(`[INGEST] ${logLine}`);
      addLog(logLine);
    } catch (error) {
      console.error(`[INGEST] Failed to process message on ${topic}:`, error);
      addLog(`ERROR: Failed to process message on ${topic} - ${error instanceof Error ? error.message : String(error)}`);
    }
  });
};

startServer();
