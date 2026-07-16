#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>

// --- Configuration ---
// Modify these to match your local WiFi network and host machine IP
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* mqtt_server = "192.168.1.100"; // Host PC's IP running Docker container
const int mqtt_port = 1883;

// GPIO Pins
#define SEN_GRID_B_CONTACTOR 2
#define LED_STATUS_BOARD 8

// Client instances
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

// Device variables
char deviceId[32];
char stateTopic[64];
char telemetryTopic[64];

// State tracking
bool lastGridActive = false;
bool debouncedGridActive = false;
unsigned long lastTransitionTime = 0;
const unsigned long debounceDelay = 100; // 100ms debounce from plan

// Telemetry timer
unsigned long lastTelemetryTime = 0;
const unsigned long telemetryInterval = 10000; // Send telemetry health every 10s

// LED status flashing
unsigned long lastLedFlashTime = 0;
bool ledState = false;

// --- Helper Functions ---

// Get unique device ID based on MAC address
void getUniqueDeviceId() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  snprintf(deviceId, sizeof(deviceId), "lunagrid_c3_%02x%02x%02x%02x%02x%02x", 
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  
  // Format topics matching backend schema: lunagrid/devices/{deviceId}/{type}
  snprintf(stateTopic, sizeof(stateTopic), "lunagrid/devices/%s/state", deviceId);
  snprintf(telemetryTopic, sizeof(telemetryTopic), "lunagrid/devices/%s/telemetry", deviceId);
}

// Connect to WiFi
void setupWifi() {
  delay(10);
  Serial.println();
  Serial.print("[WIFI] Connecting to SSID: ");
  Serial.println(ssid);

  WiFi.begin(ssid, password);

  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED) {
    // Flash status LED quickly while connecting
    digitalWrite(LED_STATUS_BOARD, ledState ? HIGH : LOW);
    ledState = !ledState;
    delay(250);
    Serial.print(".");
    attempt++;
    if (attempt > 60) { // Reset if we can't connect after 15 seconds
      Serial.println("\n[WIFI] Connection failed. Resetting ESP...");
      ESP.restart();
    }
  }

  digitalWrite(LED_STATUS_BOARD, LOW); // Turn off LED
  Serial.println("");
  Serial.println("[WIFI] Connected successfully!");
  Serial.print("[WIFI] IP Address: ");
  Serial.println(WiFi.localIP());
}

// Publish B-tariff Grid State transition to MQTT broker
void publishGridState(bool active) {
  char payload[256];
  // Build State payload matching plan
  snprintf(payload, sizeof(payload), 
           "{\"device_id\":\"%s\",\"event\":\"GRID_STATE_CHANGED\",\"grid_active\":%s}", 
           deviceId, active ? "true" : "false");
  
  Serial.print("[MQTT] Publishing state change to: ");
  Serial.println(stateTopic);
  Serial.print("[MQTT] Payload: ");
  Serial.println(payload);
  
  // Brief flash of LED on transmission
  digitalWrite(LED_STATUS_BOARD, HIGH);
  mqttClient.publish(stateTopic, payload);
  delay(50);
  digitalWrite(LED_STATUS_BOARD, LOW);
}

// Publish Telemetry health metrics to MQTT broker
void publishTelemetry(bool active) {
  char payload[256];
  long rssi = WiFi.RSSI();
  unsigned long uptime = millis() / 1000;
  uint32_t freeHeap = ESP.getFreeHeap();
  
  // Build Telemetry payload matching backend structure
  snprintf(payload, sizeof(payload), 
           "{\"device_id\":\"%s\",\"metrics\":{\"grid_active\":%s,\"uptime_seconds\":%lu,\"free_heap_bytes\":%u},\"status\":{\"wifi_rssi\":%ld,\"error_code\":0}}", 
           deviceId, active ? "true" : "false", uptime, freeHeap, rssi);
  
  Serial.print("[MQTT] Publishing telemetry to: ");
  Serial.println(telemetryTopic);
  Serial.print("[MQTT] Payload: ");
  Serial.println(payload);
  
  // Brief flash of LED on transmission
  digitalWrite(LED_STATUS_BOARD, HIGH);
  mqttClient.publish(telemetryTopic, payload);
  delay(50);
  digitalWrite(LED_STATUS_BOARD, LOW);
}

// Connect to MQTT Broker
void reconnectMqtt() {
  // Loop until we're reconnected
  while (!mqttClient.connected()) {
    Serial.print("[MQTT] Attempting connection to broker: ");
    Serial.print(mqtt_server);
    Serial.print(":");
    Serial.println(mqtt_port);
    
    // Attempt to connect
    if (mqttClient.connect(deviceId)) {
      Serial.println("[MQTT] Connected successfully!");
      
      // Publish initial state upon connection
      publishGridState(debouncedGridActive);
      publishTelemetry(debouncedGridActive);
    } else {
      Serial.print("[MQTT] Connection failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(". Retrying in 5 seconds...");
      
      // Flash status LED slowly while MQTT is retrying
      for (int i = 0; i < 10; i++) {
        digitalWrite(LED_STATUS_BOARD, ledState ? HIGH : LOW);
        ledState = !ledState;
        delay(500);
      }
    }
  }
}

// --- Arduino setup() ---
void setup() {
  pinMode(SEN_GRID_B_CONTACTOR, INPUT_PULLUP);
  pinMode(LED_STATUS_BOARD, OUTPUT);
  digitalWrite(LED_STATUS_BOARD, LOW);

  // Initialize Native USB CDC Serial
  Serial.begin(115200);
  
  // Warmup delay for Native USB CDC serial connection monitoring
  delay(2000); 
  Serial.println("\n--- Project Lunagrid Node Booting ---");

  // Load identity
  getUniqueDeviceId();
  Serial.print("[DEVICE] Unique ID: ");
  Serial.println(deviceId);

  // Connect
  setupWifi();
  mqttClient.setServer(mqtt_server, mqtt_port);
  
  // Read initial contactor state (LOW = active B-tariff due to pull-up shorted to GND)
  debouncedGridActive = (digitalRead(SEN_GRID_B_CONTACTOR) == LOW);
  lastGridActive = debouncedGridActive;
}

// --- Arduino loop() ---
void loop() {
  // 1. Maintain Wi-Fi connectivity
  if (WiFi.status() != WL_CONNECTED) {
    setupWifi();
  }

  // 2. Maintain MQTT connectivity
  if (!mqttClient.connected()) {
    reconnectMqtt();
  }
  mqttClient.loop();

  // 3. Contactor state debouncing & event transmission
  // LOW = contactor closed (B-tariff active), HIGH = contactor open (B-tariff inactive)
  bool currentPinState = (digitalRead(SEN_GRID_B_CONTACTOR) == LOW);
  
  if (currentPinState != lastGridActive) {
    // Reset timer when state changes
    lastTransitionTime = millis();
    lastGridActive = currentPinState;
  }
  
  if ((millis() - lastTransitionTime) > debounceDelay) {
    // If the state has settled and is different from our last debounced state, trigger event
    if (currentPinState != debouncedGridActive) {
      debouncedGridActive = currentPinState;
      Serial.print("[SENSOR] Contactor state transition detected! Active: ");
      Serial.println(debouncedGridActive ? "YES" : "NO");
      
      // Publish event state immediately
      publishGridState(debouncedGridActive);
    }
  }

  // 4. Periodic telemetry updates (Uptime, heap, Wi-Fi RSSI)
  if (millis() - lastTelemetryTime > telemetryInterval) {
    lastTelemetryTime = millis();
    publishTelemetry(debouncedGridActive);
  }
}
