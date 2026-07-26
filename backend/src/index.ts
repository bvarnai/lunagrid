import express from 'express';
import mqtt from 'mqtt';
import * as dotenv from 'dotenv';
import cors from 'cors';
import { readFileSync } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { 
  initDb, 
  getAllLocations, 
  createLocation, 
  updateLocation,
  deleteLocation,
  getAllDevices, 
  getDeviceById, 
  getDeviceByLocationId,
  autoRegisterDevice, 
  enrollDevice,
  bindDeviceToLocation,
  unregisterDevice,
  getAllReleases,
  createRelease,
  deleteRelease,
  getLocationById,
  updateLocationEvWakeup,
  updateLocationEvAutomation
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
    return packageJson.version || '1.0.1';
  } catch (error) {
    console.warn('[VERSION] Could not dynamically load version from package.json, falling back to 1.0.1', error);
    return '1.0.1';
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
  firmwareVersion: string;
}

const telemetryCache: Record<string, CachedTelemetry> = {};

// Global MQTT client reference for endpoint triggers
let mqttClient: mqtt.MqttClient;

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

app.delete('/api/locations/:id', async (req, res) => {
  const id = req.params.id;
  try {
    // Check if there is any device currently mapped to this location
    const device = await getDeviceByLocationId(id);
    if (device) {
      return res.status(400).json({ error: 'Cannot delete location. There is an active device mapping. Unbind the device first.' });
    }
    await deleteLocation(id);
    res.json({ status: 'success', message: `Location ${id} deleted successfully` });
  } catch (error) {
    console.error('[LOCATIONS] Error deleting location:', error);
    res.status(500).json({ error: 'Failed to delete location' });
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
      return res.json({ gridActive: false, uptime: 0, freeHeap: 0, wifiRssi: 0, timestamp: 0, deviceId: null, firmwareVersion: null, connectionStatus: 'DISCONNECTED' });
    }
    const cached = telemetryCache[device.id] || {
      gridActive: false,
      uptime: 0,
      freeHeap: 0,
      wifiRssi: 0,
      timestamp: 0,
      firmwareVersion: '1.0.0'
    };
    const isOnline = cached.timestamp > 0 && (Date.now() - cached.timestamp < 360000); // 6 minutes timeout threshold
    const connectionStatus = cached.timestamp === 0 ? 'DISCONNECTED' : (isOnline ? 'ONLINE' : 'OFFLINE');
    res.json({
      ...cached,
      deviceId: device.id,
      friendlyName: device.friendly_name,
      firmwareVersion: cached.firmwareVersion || '1.0.0',
      connectionStatus
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve telemetry' });
  }
});

// Query InfluxDB securely for last 30h history of hourly B-tariff averages
app.get('/api/locations/:id/history', async (req, res) => {
  const locationId = req.params.id;
  try {
    const device = await getDeviceByLocationId(locationId);
    if (!device) {
      return res.json([]);
    }

    // Secure Flux Query targeting the device's timeline
    const fluxQuery = `from(bucket: "lunagrid-telemetry")
  |> range(start: -30h)
  |> filter(fn: (r) => r["_measurement"] == "mqtt_consumer" and r["device_id"] == "${device.id}")
  |> filter(fn: (r) => r["_field"] == "metrics_grid_active")
  |> group()
  |> map(fn: (r) => ({ r with _value: if string(v: r._value) == "true" then 1.0 else 0.0 }))
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false, timeSrc: "_start")
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
    const history: Array<{ time: string; value: number }> = [];

    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length >= 5 && parts[0] === '' && (parts[1] === '_result' || parts[1] === 'result')) {
        if (parts[3] === '_time') continue; // Skip header row
        
        const time = parts[3];
        const value = parseFloat(parts[4]);
        if (!isNaN(value)) {
          history.push({ time, value });
        }
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

// Query InfluxDB for history around a specific date (-1 day and +1 day range)
app.get('/api/locations/:id/history/range', async (req, res) => {
  const locationId = req.params.id;
  const dateParam = req.query.date as string;
  if (!dateParam) {
    return res.status(400).json({ error: 'Missing date parameter' });
  }

  try {
    const device = await getDeviceByLocationId(locationId);
    if (!device) {
      return res.json([]);
    }

    // Parse chosen date and establish range: [Target - 1 day, Target + 2 days] (Z-aligned)
    const targetDate = new Date(dateParam);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date parameter format' });
    }

    const startDate = new Date(targetDate.getTime() - 24 * 60 * 60 * 1000);
    const stopDate = new Date(targetDate.getTime() + 2 * 24 * 60 * 60 * 1000); // +2 days to cover target + 1 day completely (exclusive stop)

    // Secure Flux Query targeting absolute timestamp range
    const fluxQuery = `from(bucket: "lunagrid-telemetry")
  |> range(start: ${startDate.toISOString()}, stop: ${stopDate.toISOString()})
  |> filter(fn: (r) => r["_measurement"] == "mqtt_consumer" and r["device_id"] == "${device.id}")
  |> filter(fn: (r) => r["_field"] == "metrics_grid_active")
  |> group()
  |> map(fn: (r) => ({ r with _value: if string(v: r._value) == "true" then 1.0 else 0.0 }))
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false, timeSrc: "_start")
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
    const history: Array<{ time: string; value: number }> = [];

    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length >= 5 && parts[0] === '' && (parts[1] === '_result' || parts[1] === 'result')) {
        if (parts[3] === '_time') continue; // Skip header
        
        const time = parts[3];
        const value = parseFloat(parts[4]);
        if (!isNaN(value)) {
          history.push({ time, value });
        }
      }
    }

    // Sort by time ascending (earliest first) so we can map it to our timeline easily
    history.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    res.json(history);
  } catch (error) {
    console.error('[HISTORY RANGE] Error querying InfluxDB:', error);
    res.status(500).json({ error: 'Failed to retrieve historical range data' });
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
  |> filter(fn: (r) => r["_field"] == "metrics_grid_active")
  |> group()
  |> map(fn: (r) => ({ r with _value: if string(v: r._value) == "true" then 1.0 else 0.0 }))
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false, timeSrc: "_start")
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
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

// --- EV Wake-up Integration Trigger and Endpoints ---

async function triggerEvAutomation(locationId: string, state: 'on' | 'off', isManualTest: boolean = false) {
  try {
    const location = await getLocationById(locationId);
    if (!location) {
      console.warn(`[EV AUTOMATION] Location ${locationId} not found.`);
      return { success: false, error: 'Location not found' };
    }

    const enabled = location.ev_automation_enabled !== undefined ? location.ev_automation_enabled : location.ev_wakeup_enabled;
    const type = location.ev_automation_type || location.ev_wakeup_type || 'webhook';
    const target = location.ev_automation_target || location.ev_wakeup_target || '';
    const headersStr = location.ev_automation_headers || location.ev_wakeup_headers || '';

    if (!isManualTest && (!enabled || enabled === 0)) {
      return { success: false, error: 'Integration disabled' };
    }

    if (!target.trim()) {
      const msg = `[EV AUTOMATION] No target configured for location ${location.name}.`;
      console.warn(msg);
      addLog(msg);
      return { success: false, error: 'No target configured' };
    }

    const logPrefix = isManualTest ? '[EV AUTOMATION TEST]' : '[EV AUTOMATION]';
    const startMsg = `${logPrefix} Triggering state "${state}" for location: ${location.name} (${type})`;
    console.log(startMsg);
    addLog(startMsg);

    if (type === 'webhook') {
      let customHeaders: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (headersStr) {
        try {
          const parsed = JSON.parse(headersStr);
          customHeaders = { ...customHeaders, ...parsed };
        } catch (e) {
          const warnMsg = `${logPrefix} Warning: Failed to parse custom JSON headers: ${e instanceof Error ? e.message : String(e)}`;
          console.warn(warnMsg);
          addLog(warnMsg);
        }
      }

      const body = JSON.stringify({
        event: isManualTest ? `TEST_${state.toUpperCase()}` : `B_TARIFF_${state.toUpperCase()}`,
        status: state,
        locationId: location.id,
        locationName: location.name,
        timestamp: Date.now()
      });

      const response = await fetch(target, {
        method: 'POST',
        headers: customHeaders,
        body
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        const errMsg = `${logPrefix} Webhook failed with status ${response.status}: ${errText}`;
        console.error(errMsg);
        addLog(errMsg);
        return { success: false, error: `Status ${response.status}`, details: errText };
      }

      const successMsg = `${logPrefix} Webhook dispatched successfully to ${target}.`;
      console.log(successMsg);
      addLog(successMsg);
      return { success: true };

    } else if (type === 'ntfy') {
      let customHeaders: Record<string, string> = {
        'Title': isManualTest ? `EV Charging Test: ${state.toUpperCase()}` : `EV Charging: B-tariff ${state.toUpperCase()} (${location.name})`,
        'Priority': 'high',
        'Tags': 'electric_plug,car'
      };

      if (headersStr) {
        try {
          const parsed = JSON.parse(headersStr);
          customHeaders = { ...customHeaders, ...parsed };
        } catch (e) {
          const warnMsg = `${logPrefix} Warning: Failed to parse custom JSON headers: ${e instanceof Error ? e.message : String(e)}`;
          console.warn(warnMsg);
          addLog(warnMsg);
        }
      }

      const body = isManualTest
        ? `Test notification sent successfully for location: ${location.name} (state: ${state})`
        : `B-tariff (low-cost electricity) is now ${state.toUpperCase()} at location "${location.name}". Please check your EV charging status.`;

      const response = await fetch(target, {
        method: 'POST',
        headers: customHeaders,
        body
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        const errMsg = `${logPrefix} ntfy push failed with status ${response.status}: ${errText}`;
        console.error(errMsg);
        addLog(errMsg);
        return { success: false, error: `Status ${response.status}`, details: errText };
      }

      const successMsg = `${logPrefix} ntfy push notification dispatched successfully to ${target}.`;
      console.log(successMsg);
      addLog(successMsg);
      return { success: true };

    } else if (type === 'script') {
      return new Promise<{ success: boolean; error?: string }>((resolve) => {
        const commandToRun = target.replace(/{state}/g, state);
        const runEnv = {
          ...process.env,
          EV_STATE: state,
          LUNAGRID_STATE: state
        };

        exec(commandToRun, { env: runEnv }, (err, stdout, stderr) => {
          if (err) {
            const errMsg = `${logPrefix} Script execution failed: ${err.message}`;
            console.error(errMsg);
            addLog(errMsg);
            resolve({ success: false, error: err.message });
          } else {
            const successMsg = `${logPrefix} Script executed successfully. Output: ${stdout.trim()}`;
            console.log(successMsg);
            addLog(successMsg);
            resolve({ success: true });
          }
        });
      });

    } else if (type === 'mqtt') {
      if (mqttClient && mqttClient.connected) {
        let payload = state === 'on' ? 'C' : 'A';
        if (headersStr) {
          try {
            const parsed = JSON.parse(headersStr);
            if (state === 'on' && parsed.on !== undefined) {
              payload = String(parsed.on);
            } else if (state === 'off' && parsed.off !== undefined) {
              payload = String(parsed.off);
            }
          } catch (e) {
            const warnMsg = `${logPrefix} Warning: Failed to parse custom JSON payloads: ${e instanceof Error ? e.message : String(e)}`;
            console.warn(warnMsg);
            addLog(warnMsg);
          }
        }
        mqttClient.publish(target, payload, { qos: 1, retain: true });
        const successMsg = `${logPrefix} MQTT message '${payload}' published successfully to ${target}.`;
        console.log(successMsg);
        addLog(successMsg);
        return { success: true };
      } else {
        const errMsg = `${logPrefix} MQTT client not connected.`;
        console.error(errMsg);
        addLog(errMsg);
        return { success: false, error: 'MQTT client not connected' };
      }
    }

    return { success: false, error: 'Unknown integration type' };
  } catch (error) {
    const errMsg = `[EV AUTOMATION] Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
    console.error(errMsg);
    addLog(errMsg);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Update EV charging automation settings for a location
app.post('/api/locations/:id/automation', async (req, res) => {
  const locationId = req.params.id;
  const { enabled, type, target, headers } = req.body;

  if (typeof enabled !== 'boolean' || !type || target === undefined) {
    return res.status(400).json({ error: 'enabled (boolean), type, and target are required' });
  }

  try {
    await updateLocationEvAutomation(locationId, enabled, type, target, headers || '');
    res.json({ status: 'success', message: 'EV charging automation settings updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update EV charging automation settings' });
  }
});

// Trigger a manual EV charging automation test (ON)
app.post('/api/locations/:id/automation/test', async (req, res) => {
  const locationId = req.params.id;
  try {
    const result = await triggerEvAutomation(locationId, 'on', true);
    if (result.success) {
      res.json({ status: 'success', message: 'EV charging automation test triggered successfully' });
    } else {
      res.status(500).json({ error: result.error, details: 'details' in result ? (result as any).details : undefined });
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Keep legacy endpoints as fallback wrappers for backward compatibility
app.post('/api/locations/:id/wakeup', async (req, res) => {
  const locationId = req.params.id;
  const { enabled, type, target, headers } = req.body;

  if (typeof enabled !== 'boolean' || !type || target === undefined) {
    return res.status(400).json({ error: 'enabled (boolean), type, and target are required' });
  }

  try {
    await updateLocationEvAutomation(locationId, enabled, type, target, headers || '');
    res.json({ status: 'success', message: 'EV settings updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update EV settings' });
  }
});

app.post('/api/locations/:id/wakeup/test', async (req, res) => {
  const locationId = req.params.id;
  try {
    const result = await triggerEvAutomation(locationId, 'on', true);
    if (result.success) {
      res.json({ status: 'success', message: 'EV test triggered successfully' });
    } else {
      res.status(500).json({ error: result.error, details: 'details' in result ? (result as any).details : undefined });
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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

// --- Firmware Releases API ---

// Get all releases
app.get('/api/releases', async (req, res) => {
  try {
    const releases = await getAllReleases();
    res.json(releases);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve firmware releases' });
  }
});

// Create new release
app.post('/api/releases', async (req, res) => {
  const { version, url, description } = req.body;
  if (!version || !url) {
    return res.status(400).json({ error: 'version and url are required' });
  }
  try {
    await createRelease(version, url, description || '');
    res.status(201).json({ status: 'created', release: { version, url, description } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create firmware release. Version may already exist.' });
  }
});

// Delete a release
app.delete('/api/releases/:version', async (req, res) => {
  const version = req.params.version;
  try {
    await deleteRelease(version);
    res.json({ status: 'success', message: `Release ${version} deleted successfully` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete firmware release' });
  }
});

// Trigger rollout of a release to all outdated/eligible devices
app.post('/api/releases/rollout', async (req, res) => {
  const { version } = req.body;
  if (!version) {
    return res.status(400).json({ error: 'version is required' });
  }
  try {
    // Find the release details in SQLite
    const releases = await getAllReleases();
    const release = releases.find(r => r.version === version);
    if (!release) {
      return res.status(404).json({ error: `Release version ${version} not found` });
    }

    // Get all enrolled active devices
    const allDevices = await getAllDevices();
    const activeDevices = allDevices.filter(d => d.status === 'ACTIVE');

    let triggeredCount = 0;

    for (const device of activeDevices) {
      const cached = telemetryCache[device.id];
      const currentVersion = cached ? cached.firmwareVersion : '1.0.0';

      // Only push OTA update if the device version is different from the target version
      if (currentVersion !== version) {
        const cmdTopic = `lunagrid/devices/${device.id}/cmd`;
        const payload = JSON.stringify({
          cmd: 'OTA_UPDATE',
          url: release.url,
          version: release.version
        });

        // Publish to MQTT broker if connected
        if (mqttClient) {
          mqttClient.publish(cmdTopic, payload, { qos: 1 });
          const logLine = `Triggered OTA update for device ${device.id} (from ${currentVersion} to ${version})`;
          console.log(`[ROLLOUT] ${logLine}`);
          addLog(`[ROLLOUT] ${logLine}`);
          triggeredCount++;
        }
      }
    }

    res.json({ 
      status: 'success', 
      message: `Rollout initiated for v${version}. Commands dispatched to ${triggeredCount} devices.` 
    });
  } catch (error) {
    console.error('[ROLLOUT] Error initiating rollout:', error);
    res.status(500).json({ error: 'Failed to initiate firmware rollout' });
  }
});

// Get rollout status / metrics
app.get('/api/releases/rollout/status', async (req, res) => {
  const targetVersion = req.query.version as string;
  if (!targetVersion) {
    return res.status(400).json({ error: 'version query parameter is required' });
  }
  try {
    const allDevices = await getAllDevices();
    const activeDevices = allDevices.filter(d => d.status === 'ACTIVE');

    const total = activeDevices.length;
    let updated = 0;
    const devicesStatus = [];

    for (const device of activeDevices) {
      const cached = telemetryCache[device.id];
      const currentVersion = cached ? cached.firmwareVersion : '1.0.0';
      const isUpdated = currentVersion === targetVersion;
      if (isUpdated) {
        updated++;
      }
      devicesStatus.push({
        deviceId: device.id,
        friendlyName: device.friendly_name,
        currentVersion,
        isUpdated
      });
    }

    res.json({
      version: targetVersion,
      totalCount: total,
      updatedCount: updated,
      percentage: total > 0 ? Math.round((updated / total) * 100) : 0,
      devices: devicesStatus
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve rollout status' });
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
  mqttClient = mqtt.connect(mqttBrokerUrl);

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
          timestamp: 0,
          firmwareVersion: '1.0.0'
        };
      }

      const device = await getDeviceById(deviceId);

      // Update in-memory telemetry cache
      if (messageType === 'state') {
        const previousState = telemetryCache[deviceId].gridActive;
        const newState = payload.grid_active;
        
        telemetryCache[deviceId].gridActive = newState;
        telemetryCache[deviceId].timestamp = Date.now();

        // Trigger EV integration on state transition
        if (device?.location_id) {
          if (newState === true && previousState === false) {
            triggerEvAutomation(device.location_id, 'on').catch(err => {
              console.error('[EV AUTOMATION] ON Trigger failed:', err);
            });
          } else if (newState === false && previousState === true) {
            triggerEvAutomation(device.location_id, 'off').catch(err => {
              console.error('[EV AUTOMATION] OFF Trigger failed:', err);
            });
          }
        }
      } else if (messageType === 'telemetry') {
        telemetryCache[deviceId].uptime = payload.metrics.uptime_seconds;
        telemetryCache[deviceId].freeHeap = payload.metrics.free_heap_bytes;
        telemetryCache[deviceId].wifiRssi = payload.status.wifi_rssi;
        telemetryCache[deviceId].firmwareVersion = payload.status.firmware_version || '1.0.0';
        telemetryCache[deviceId].timestamp = Date.now();
      }

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
