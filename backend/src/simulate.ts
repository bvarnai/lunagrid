import mqtt from 'mqtt';

/**
 * Project Lunagrid - Hardware Device Simulator CLI
 * 
 * This tool connects to the MQTT broker and publishes simulated grid status events
 * and periodic system telemetry as if it were a physical ESP32-C3 device.
 * 
 * Usage (from backend folder):
 *   npm run simulate -- [options]
 * 
 * Options:
 *   --id, -d        Device UUID (default: lunagrid_c3_simulated)
 *   --active, -a    Grid active state: "true" or "false" (default: true)
 *   --interval, -i  Send updates every X seconds (if omitted, sends once and exits)
 *   --broker, -b    MQTT Broker URL (default: mqtt://broker.hivemq.com:1883)
 */

// Minimal CLI arguments parser
const args = process.argv.slice(2);
const getArgValue = (flag: string, alias: string, defaultValue: string): string => {
  const index = args.findIndex(arg => arg === flag || arg === alias);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return defaultValue;
};

// Config parameters
const deviceId = getArgValue('--id', '-d', 'lunagrid_c3_simulated');
const gridActiveArg = getArgValue('--active', '-a', 'true');
let gridActive = gridActiveArg === 'true';
const intervalSeconds = parseInt(getArgValue('--interval', '-i', '0'), 10);
const brokerUrl = getArgValue('--broker', '-b', 'mqtt://broker.hivemq.com:1883');

console.log(`\n=================================================`);
console.log(`   LUNAGRID ESP32-C3 DEVICE SIMULATOR`);
console.log(`=================================================`);
console.log(`[SIMULATOR] Device UUID : ${deviceId}`);
console.log(`[SIMULATOR] Broker URL  : ${brokerUrl}`);
console.log(`[SIMULATOR] Grid Active : ${gridActive}`);
if (intervalSeconds > 0) {
  console.log(`[SIMULATOR] Mode        : Continuous (every ${intervalSeconds}s)`);
} else {
  console.log(`[SIMULATOR] Mode        : One-shot (single publish & exit)`);
}
console.log(`=================================================\n`);

// Helper to make mock metrics
let uptime = 0;
const getMockTelemetry = () => {
  uptime += intervalSeconds > 0 ? intervalSeconds : 10;
  return {
    timestamp: Math.floor(Date.now() / 1000),
    device_id: deviceId,
    metrics: {
      grid_active: gridActive,
      uptime_seconds: uptime,
      free_heap_bytes: Math.floor(180000 + Math.random() * 8000)
    },
    status: {
      wifi_rssi: Math.floor(-70 + Math.random() * 15),
      error_code: 0
    }
  };
};

const getMockStateEvent = () => {
  return {
    timestamp: Math.floor(Date.now() / 1000),
    device_id: deviceId,
    event: 'GRID_STATE_CHANGED',
    grid_active: gridActive
  };
};

// Connect to broker
console.log(`[CONNECTING] Connecting to MQTT broker...`);
const client = mqtt.connect(brokerUrl);

client.on('connect', () => {
  console.log(`[CONNECTED] Connected to MQTT broker.`);

  const telemetryTopic = `lunagrid/devices/${deviceId}/telemetry`;
  const stateTopic = `lunagrid/devices/${deviceId}/state`;

  // Helper to publish messages
  const publishPayloads = () => {
    const statePayload = getMockStateEvent();
    const telemetryPayload = getMockTelemetry();

    // Publish state event
    client.publish(stateTopic, JSON.stringify(statePayload), { qos: 1 }, (err) => {
      if (err) console.error(`[ERROR] State publish failed:`, err);
      else console.log(`[PUBLISHED] State -> ${stateTopic} | active: ${gridActive}`);
    });

    // Publish telemetry
    client.publish(telemetryTopic, JSON.stringify(telemetryPayload), { qos: 0 }, (err) => {
      if (err) console.error(`[ERROR] Telemetry publish failed:`, err);
      else {
        console.log(`[PUBLISHED] Telemetry -> ${telemetryTopic}`);
        console.log(`            Heap: ${telemetryPayload.metrics.free_heap_bytes} B | RSSI: ${telemetryPayload.status.wifi_rssi} dBm`);
      }
    });
  };

  // Perform initial publish
  publishPayloads();

  if (intervalSeconds > 0) {
    // Run interval
    const timer = setInterval(() => {
      // Small chance (10%) to toggle grid status randomly during continuous execution
      if (Math.random() < 0.1) {
        gridActive = !gridActive;
        console.log(`\n[EVENT] Simulated Grid switch toggled state dynamically to: ${gridActive ? 'B-Tariff ON' : 'B-Tariff OFF'}\n`);
      }
      publishPayloads();
    }, intervalSeconds * 1000);

    // Clean exit handlers
    process.on('SIGINT', () => {
      clearInterval(timer);
      console.log(`\n[SHUTDOWN] Stopping simulation. Disconnecting...`);
      client.end(() => {
        console.log(`[SHUTDOWN] Exited cleanly.`);
        process.exit(0);
      });
    });
  } else {
    // One shot: disconnect after short delay to ensure packets flushed
    setTimeout(() => {
      client.end(() => {
        console.log(`\n[SHUTDOWN] Completed one-shot transmission.`);
        process.exit(0);
      });
    }, 1000);
  }
});

client.on('error', (err) => {
  console.error(`[MQTT ERROR] Connection failed:`, err);
  process.exit(1);
});
