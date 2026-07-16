import express from 'express';
import mqtt from 'mqtt';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const mqttBrokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://broker.hivemq.com:1883';

app.use(express.json());

// Basic API check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Start API Server
app.listen(port, () => {
  console.log(`[BACKEND] Server running on port ${port}`);
});

// MQTT Client ingestion listener
console.log(`[MQTT] Connecting to broker at ${mqttBrokerUrl}`);
const mqttClient = mqtt.connect(mqttBrokerUrl);

mqttClient.on('connect', () => {
  console.log('[MQTT] Connected successfully to broker');
  // Subscribe to all device states wildcard
  mqttClient.subscribe('lunagrid/devices/+/state', (err) => {
    if (err) {
      console.error('[MQTT] Subscription failed:', err);
    } else {
      console.log('[MQTT] Subscribed to telemetry state topics');
    }
  });
});

mqttClient.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    console.log(`[INGEST] Topic: ${topic} | Payload:`, payload);
    // Ingest data path: push payload to database (e.g. InfluxDB)
  } catch (error) {
    console.error(`[INGEST] Failed to parse message from topic ${topic}:`, error);
  }
});
