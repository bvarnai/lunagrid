import express from 'express';
import mqtt from 'mqtt';
import * as dotenv from 'dotenv';
import cors from 'cors';
import { 
  initDb, 
  getAllLocations, 
  createLocation, 
  getAllDevices, 
  getDeviceById, 
  autoRegisterDevice, 
  enrollDevice 
} from './db.js'; // Note the .js extension for ES Module compatibility

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const mqttBrokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://broker.hivemq.com:1883';

app.use(express.json());
app.use(cors()); // Allow requests from our React frontend

// --- REST API Endpoints ---

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
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
  if (!id || !locationId || !friendlyName) {
    return res.status(400).json({ error: 'id, locationId, and friendlyName are required' });
  }
  try {
    await enrollDevice(id, locationId, friendlyName);
    res.json({ status: 'success', message: `Device ${id} enrolled to location ${locationId}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to enroll device' });
  }
});

// --- Boot Server and Ingest ---
const startServer = async () => {
  // 1. Initialize SQLite Database
  try {
    await initDb();
    console.log('[DATABASE] SQLite database initialized successfully.');
  } catch (err) {
    console.error('[DATABASE] Failed to initialize SQLite database:', err);
    process.exit(1);
  }

  // 2. Start HTTP API Server
  app.listen(port, () => {
    console.log(`[BACKEND] Server running on http://localhost:${port}`);
  });

  // 3. Connect to MQTT Broker and Setup Ingest
  console.log(`[MQTT] Connecting to broker at ${mqttBrokerUrl}`);
  const mqttClient = mqtt.connect(mqttBrokerUrl);

  mqttClient.on('connect', () => {
    console.log('[MQTT] Connected successfully to broker');
    // Subscribe to all device telemetry and state topics
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
    // Topic formats:
    // - lunagrid/devices/{device_id}/state
    // - lunagrid/devices/{device_id}/telemetry
    const topicParts = topic.split('/');
    if (topicParts.length < 4) return;

    const deviceId = topicParts[2];
    const messageType = topicParts[3]; // 'state' or 'telemetry'

    try {
      const payload = JSON.parse(message.toString());
      
      // Auto-discover / register unknown devices as PENDING
      await autoRegisterDevice(deviceId);

      // Lookup device metadata
      const device = await getDeviceById(deviceId);
      
      const enrichedPayload = {
        ...payload,
        device_id: deviceId,
        friendly_name: device?.friendly_name || null,
        location_id: device?.location_id || null,
        status: device?.status || 'PENDING'
      };

      console.log(`[INGEST] Type: ${messageType.toUpperCase()} | Device: ${deviceId} | Location: ${enrichedPayload.location_id || 'UNASSIGNED'} | Status: ${enrichedPayload.status}`);
      
      // Here you would forward to InfluxDB with:
      // - tag: device_id
      // - tag: location_id (if not null)
      // - fields: values from payload
      
    } catch (error) {
      console.error(`[INGEST] Failed to process message on ${topic}:`, error);
    }
  });
};

startServer();
