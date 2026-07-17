#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <time.h>
#include <HTTPUpdate.h>
#include <ArduinoJson.h>

// --- Configuration ---
// Modify these to match your local WiFi network and host machine IP
const char* ssid = "VBL";
const char* password = "Mentor19";
const char* mqtt_server = "mqtt.nas48.vbl.hu"; // Replace with your NAS local IP or DNS
const int mqtt_port = 1883;

const char* FIRMWARE_VERSION = "1.0.0";

// GPIO Pins
#define SEN_GRID_B_CONTACTOR 3
#define LED_STATUS_BOARD 8

// Client instances
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

// Device variables
char deviceId[32];
char stateTopic[64];
char telemetryTopic[64];
char cmdTopic[64];

// State tracking
bool lastGridActive = false;
bool debouncedGridActive = false;
unsigned long lastTransitionTime = 0;
const unsigned long debounceDelay = 100; // 100ms debounce from plan

// Telemetry timer
unsigned long lastTelemetryTime = 0;
const unsigned long telemetryInterval = 300000; // Send telemetry health every 5 minutes (300s)

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
  snprintf(cmdTopic, sizeof(cmdTopic), "lunagrid/devices/%s/cmd", deviceId);
}

// Flash Updater Routine
void triggerOtaUpdate(String url) {
  Serial.print("[OTA] Initiating firmware update from: ");
  Serial.println(url);

  // Turn status LED on solid during update
  digitalWrite(LED_STATUS_BOARD, HIGH);

  // Trigger OTA Update over HTTP/HTTPS (using global wifiClient)
  t_httpUpdate_return ret = httpUpdate.update(wifiClient, url);

  // If update fails, turn LED off and log error
  digitalWrite(LED_STATUS_BOARD, LOW);

  switch (ret) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("[OTA ERROR] HTTP_UPDATE_FAILED Error (%d): %s\n", 
                    httpUpdate.getLastError(), 
                    httpUpdate.getLastErrorString().c_str());
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("[OTA] HTTP_UPDATE_NO_UPDATES");
      break;
    case HTTP_UPDATE_OK:
      Serial.println("[OTA] HTTP_UPDATE_OK (rebooting...)");
      break;
  }
}

// Callback for incoming MQTT command messages
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.print("[MQTT] Message arrived on topic [");
  Serial.print(topic);
  Serial.println("]");

  // Verify the topic matches our command topic
  if (strcmp(topic, cmdTopic) != 0) {
    return;
  }

  // Parse command payload using ArduinoJson 7
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload, length);

  if (error) {
    Serial.print("[MQTT ERROR] JSON Deserialization failed: ");
    Serial.println(error.c_str());
    return;
  }

  const char* cmd = doc["cmd"];
  if (cmd && strcmp(cmd, "OTA_UPDATE") == 0) {
    const char* url = doc["url"];
    const char* version = doc["version"];

    if (!url || !version) {
      Serial.println("[MQTT ERROR] OTA command payload is missing 'url' or 'version'");
      return;
    }

    Serial.print("[OTA] Target Version: ");
    Serial.print(version);
    Serial.print(" | Current Version: ");
    Serial.println(FIRMWARE_VERSION);

    // Reject update if version is not newer than current
    if (String(version) <= String(FIRMWARE_VERSION)) {
      Serial.println("[OTA] Update rejected: Target version is not newer than current firmware version.");
      return;
    }

    triggerOtaUpdate(String(url));
  }
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

  // Configure NTP for time synchronization
  Serial.println("[TIME] Configuring SNTP...");
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
}

// Publish B-tariff Grid State transition to MQTT broker
void publishGridState(bool active) {
  char payload[256];
  time_t now = time(nullptr);
  // Build State payload matching plan
  snprintf(payload, sizeof(payload), 
           "{\"timestamp\":%lld,\"device_id\":\"%s\",\"event\":\"GRID_STATE_CHANGED\",\"grid_active\":%s}", 
           (long long)now, deviceId, active ? "true" : "false");
  
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
  char payload[384];
  long rssi = WiFi.RSSI();
  unsigned long uptime = millis() / 1000;
  uint32_t freeHeap = ESP.getFreeHeap();
  time_t now = time(nullptr);
  
  snprintf(payload, sizeof(payload), 
           "{\"timestamp\":%lld,\"device_id\":\"%s\",\"metrics\":{\"grid_active\":%s,\"uptime_seconds\":%lu,\"free_heap_bytes\":%u},\"status\":{\"wifi_rssi\":%ld,\"error_code\":0,\"firmware_version\":\"%s\"}}", 
           (long long)now, deviceId, active ? "true" : "false", uptime, freeHeap, rssi, FIRMWARE_VERSION);
  
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
      
      // Subscribe to remote command topic
      mqttClient.subscribe(cmdTopic);
      Serial.print("[MQTT] Subscribed to topic: ");
      Serial.println(cmdTopic);
      
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
  mqttClient.setCallback(mqttCallback);
  
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
