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
  updateDeviceFriendlyName,
  getAllReleases,
  createRelease,
  deleteRelease,
  getLocationById,
  updateLocationEvWakeup,
  updateLocationEvAutomation,
  updateLocationNotificationsDisabled,
  updateLocationCarAwaySchedule,
  isLocationCarAwayActive,
  getAllAutomations,
  getAutomationsByLocationId,
  getAutomationById,
  createAutomation,
  updateAutomation,
  deleteAutomation
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
  const { id, name, timezone, target_compliance_hours } = req.body;
  if (!id || !name || !timezone) {
    return res.status(400).json({ error: 'id, name, and timezone are required' });
  }
  const targetHours = target_compliance_hours !== undefined ? parseFloat(target_compliance_hours) : 8.0;
  try {
    await createLocation(id, name, timezone, targetHours);
    res.status(201).json({ status: 'created', location: { id, name, timezone, target_compliance_hours: targetHours } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create location. ID may already exist.' });
  }
});

app.put('/api/locations/:id', async (req, res) => {
  const id = req.params.id;
  const { name, timezone, target_compliance_hours } = req.body;
  if (!name || !timezone) {
    return res.status(400).json({ error: 'name and timezone are required' });
  }
  const targetHours = target_compliance_hours !== undefined ? parseFloat(target_compliance_hours) : 8.0;
  try {
    await updateLocation(id, name, timezone, targetHours);
    res.json({ status: 'success', location: { id, name, timezone, target_compliance_hours: targetHours } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// Toggle notifications / disarm status for a location
app.patch('/api/locations/:id/notifications', async (req, res) => {
  const id = req.params.id;

  try {
    const loc = await getLocationById(id);
    if (!loc) {
      return res.status(404).json({ error: 'Location not found' });
    }

    let val = 0;
    if (req.body.override === 'auto' || req.body.notifications_disabled === 0) {
      val = 0; // Clear manual override, revert to Auto schedule
    } else if (req.body.override === 'on' || req.body.disabled === true || req.body.notifications_disabled === 1) {
      val = 1; // Force Manual ON
    } else if (req.body.override === 'off' || req.body.disabled === false || req.body.notifications_disabled === -1) {
      // If turning OFF while schedule is active, set forced OFF (-1), otherwise 0
      const currentActive = isLocationCarAwayActive(loc);
      val = (currentActive.reason === 'schedule' || loc.car_away_schedule_enabled) ? -1 : 0;
    } else if (typeof req.body.notifications_disabled === 'number') {
      val = req.body.notifications_disabled;
    }

    await updateLocationNotificationsDisabled(id, val);
    const updatedLoc = await getLocationById(id);
    const statusInfo = updatedLoc ? isLocationCarAwayActive(updatedLoc) : { active: false, reason: 'none' };

    let statusText = 'Car Away OFF (Car Present)';
    if (statusInfo.active) {
      statusText = statusInfo.reason === 'manual_on' 
        ? 'Car Away ON (Manual Override)' 
        : 'Car Away ON (Scheduled)';
    } else if (statusInfo.reason === 'manual_off') {
      statusText = 'Car Away OFF (Manual Override)';
    }

    const msg = `[SYSTEM] Location "${loc.name}" (${id}) set to ${statusText}.`;
    console.log(msg);
    addLog(msg);

    res.json({
      status: 'success',
      locationId: id,
      notifications_disabled: val,
      car_away_active: statusInfo.active,
      reason: statusInfo.reason,
      message: statusText
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update notification status' });
  }
});

// Update Car Away daily schedule for a location
app.patch('/api/locations/:id/schedule', async (req, res) => {
  const id = req.params.id;
  const { enabled, from, to } = req.body;
  try {
    const loc = await getLocationById(id);
    if (!loc) {
      return res.status(404).json({ error: 'Location not found' });
    }
    const fromTime = from || '08:00';
    const toTime = to || '17:00';
    await updateLocationCarAwaySchedule(id, Boolean(enabled), fromTime, toTime);
    
    const updatedLoc = await getLocationById(id);
    const statusInfo = updatedLoc ? isLocationCarAwayActive(updatedLoc) : { active: false, reason: 'none' };

    const msg = `[SYSTEM] Location "${loc.name}" (${id}) Car Away schedule set to ${enabled ? 'ENABLED' : 'DISABLED'} (${fromTime} - ${toTime}).`;
    console.log(msg);
    addLog(msg);

    res.json({
      status: 'success',
      locationId: id,
      car_away_schedule_enabled: enabled ? 1 : 0,
      car_away_schedule_from: fromTime,
      car_away_schedule_to: toTime,
      car_away_active: statusInfo.active,
      reason: statusInfo.reason
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update schedule' });
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

    const loc = await getLocationById(locationId);
    const targetHours = (loc && loc.target_compliance_hours !== undefined) ? loc.target_compliance_hours : 8.0;

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
          compliant: activeHours >= targetHours
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

async function executeAutomation(auto: any, state: 'on' | 'off', location: { id: string; name: string }, isManualTest: boolean = false) {
  const type = auto.type;
  const target = auto.target;
  const headersStr = auto.headers;

  if (!target.trim()) {
    const msg = `[EV AUTOMATION] No target configured for location ${location.name} (Automation ID: ${auto.id}).`;
    console.warn(msg);
    addLog(msg);
    return { success: false, error: 'No target configured' };
  }

  const logPrefix = isManualTest ? '[EV AUTOMATION TEST]' : '[EV AUTOMATION]';
  const startMsg = `${logPrefix} Triggering state "${state}" for location: ${location.name} (ID: ${auto.id}, Type: ${type})`;
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
}

async function triggerEvAutomation(locationId: string, state: 'on' | 'off', isManualTest: boolean = false) {
  try {
    const location = await getLocationById(locationId);
    if (!location) {
      console.warn(`[EV AUTOMATION] Location ${locationId} not found.`);
      return { success: false, error: 'Location not found' };
    }

    const carAwayStatus = isLocationCarAwayActive(location);
    if (carAwayStatus.active && !isManualTest) {
      const reasonText = carAwayStatus.reason === 'schedule'
        ? `Scheduled window (${location.car_away_schedule_from} - ${location.car_away_schedule_to})`
        : 'Manual toggle';
      const disarmedMsg = `[EV AUTOMATION] Location "${location.name}" (${locationId}) is in "Car Away" mode [${reasonText}]. Skipping notification dispatch.`;
      console.log(disarmedMsg);
      addLog(disarmedMsg);
      return { success: true, skipped: true, reason: `Car Away mode enabled (${reasonText})` };
    }

    const automations = await getAutomationsByLocationId(locationId);
    const activeAutomations = isManualTest ? automations : automations.filter(auto => auto.enabled === 1);

    if (activeAutomations.length === 0) {
      return { success: false, error: 'No active integrations configured' };
    }

    const results = await Promise.all(activeAutomations.map(async (auto) => {
      try {
        const res = await executeAutomation(auto, state, location, isManualTest);
        return { id: auto.id, success: res.success, error: res.error, details: (res as any).details };
      } catch (err) {
        return { id: auto.id, success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }));

    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      return { success: false, error: `${failed.length} automations failed`, details: results };
    }
    return { success: true };

  } catch (error) {
    const errMsg = `[EV AUTOMATION] Failed to trigger automation: ${error instanceof Error ? error.message : String(error)}`;
    console.error(errMsg);
    addLog(errMsg);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// --- Automations API ---

// Get all automations
app.get('/api/automations', async (req, res) => {
  try {
    const automations = await getAllAutomations();
    res.json(automations);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve automations' });
  }
});

// Get all automations for a location
app.get('/api/locations/:id/automations', async (req, res) => {
  const locationId = req.params.id;
  try {
    const automations = await getAutomationsByLocationId(locationId);
    res.json(automations);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve automations' });
  }
});

// Create new automation for a location
app.post('/api/locations/:id/automations', async (req, res) => {
  const locationId = req.params.id;
  const { enabled, type, target, headers } = req.body;
  if (!type || target === undefined) {
    return res.status(400).json({ error: 'type and target are required' });
  }
  try {
    const id = await createAutomation(locationId, enabled !== false, type, target, headers || '');
    res.status(201).json({ id, status: 'success', message: 'Automation created' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create automation' });
  }
});

// Update an automation
app.put('/api/automations/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { enabled, type, target, headers } = req.body;
  if (!type || target === undefined) {
    return res.status(400).json({ error: 'type and target are required' });
  }
  try {
    await updateAutomation(id, enabled !== false, type, target, headers || '');
    res.json({ status: 'success', message: 'Automation updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update automation' });
  }
});

// Delete an automation
app.delete('/api/automations/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    await deleteAutomation(id);
    res.json({ status: 'success', message: 'Automation deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete automation' });
  }
});

// Trigger a manual test for a specific automation
app.post('/api/automations/:id/test', async (req, res) => {
  const id = parseInt(req.params.id);
  const { state } = req.body;
  const targetState = (state === 'off') ? 'off' : 'on';
  try {
    const auto = await getAutomationById(id);
    if (!auto) {
      return res.status(404).json({ error: 'Automation not found' });
    }
    const location = await getLocationById(auto.location_id);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }
    const result = await executeAutomation(auto, targetState, location, true);
    if (result.success) {
      res.json({ status: 'success', message: `Automation test (${targetState.toUpperCase()}) triggered successfully` });
    } else {
      res.status(500).json({ error: result.error, details: 'details' in result ? (result as any).details : undefined });
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Keep legacy endpoints as fallback wrappers for backward compatibility
app.post('/api/locations/:id/automation', async (req, res) => {
  const locationId = req.params.id;
  const { enabled, type, target, headers } = req.body;

  if (typeof enabled !== 'boolean' || !type || target === undefined) {
    return res.status(400).json({ error: 'enabled (boolean), type, and target are required' });
  }

  try {
    const existing = await getAutomationsByLocationId(locationId);
    if (existing.length > 0 && existing[0].id !== undefined) {
      await updateAutomation(existing[0].id, enabled, type, target, headers || '');
    } else {
      await createAutomation(locationId, enabled, type, target, headers || '');
    }
    res.json({ status: 'success', message: 'EV charging automation settings updated successfully (compat)' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update EV charging automation settings' });
  }
});

// Trigger a manual EV charging automation test (ON or OFF)
app.post('/api/locations/:id/automation/test', async (req, res) => {
  const locationId = req.params.id;
  const { state } = req.body;
  const targetState = (state === 'off') ? 'off' : 'on';
  try {
    const result = await triggerEvAutomation(locationId, targetState, true);
    if (result.success) {
      res.json({ status: 'success', message: `EV charging automation test (${targetState.toUpperCase()}) triggered successfully` });
    } else {
      res.status(500).json({ error: result.error, details: 'details' in result ? (result as any).details : undefined });
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/locations/:id/wakeup', async (req, res) => {
  const locationId = req.params.id;
  const { enabled, type, target, headers } = req.body;

  if (typeof enabled !== 'boolean' || !type || target === undefined) {
    return res.status(400).json({ error: 'enabled (boolean), type, and target are required' });
  }

  try {
    const existing = await getAutomationsByLocationId(locationId);
    if (existing.length > 0 && existing[0].id !== undefined) {
      await updateAutomation(existing[0].id, enabled, type, target, headers || '');
    } else {
      await createAutomation(locationId, enabled, type, target, headers || '');
    }
    res.json({ status: 'success', message: 'EV settings updated successfully (compat)' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update EV settings' });
  }
});

app.post('/api/locations/:id/wakeup/test', async (req, res) => {
  const locationId = req.params.id;
  const { state } = req.body;
  const targetState = (state === 'off') ? 'off' : 'on';
  try {
    const result = await triggerEvAutomation(locationId, targetState, true);
    if (result.success) {
      res.json({ status: 'success', message: `EV test (${targetState.toUpperCase()}) triggered successfully` });
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

// Update device friendly name
app.patch('/api/devices/:id/friendly-name', async (req, res) => {
  const id = req.params.id;
  const { friendlyName } = req.body;
  if (friendlyName === undefined) {
    return res.status(400).json({ error: 'friendlyName is required' });
  }
  try {
    const device = await getDeviceById(id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    await updateDeviceFriendlyName(id, friendlyName);
    res.json({ status: 'success', message: `Device ${id} friendly name updated to ${friendlyName}.` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update friendly name' });
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

      const statusText = telemetryCache[deviceId].gridActive ? 'B-Tariff ON' : 'B-Tariff OFF';
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
