#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <time.h>
#include <HTTPUpdate.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>

// --- Configuration ---
// Default placeholders: Override at build-time using -D compiler flags or PLATFORMIO_BUILD_FLAGS
#ifndef WIFI_SSID
#define WIFI_SSID "YOUR_WIFI_SSID"
#endif

#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#endif

#ifndef MQTT_SERVER
#define MQTT_SERVER "YOUR_MQTT_BROKER_IP"
#endif

#ifndef MQTT_PORT
#define MQTT_PORT 1883
#endif

const char* ssid = WIFI_SSID;
const char* password = WIFI_PASSWORD;
const char* mqtt_server = MQTT_SERVER;
const int mqtt_port = MQTT_PORT;

// Static firmware version identifier
const char* FIRMWARE_VERSION = "1.0.1";



// Hardware Watchdog Timeout (seconds)
const uint32_t WDT_TIMEOUT_SECONDS = 30;

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

// Non-blocking WiFi recovery timers
unsigned long lastWifiRetry = 0;
const unsigned long wifiRetryInterval = 10000; // 10s between reconnect attempts
unsigned long lastWifiDisconnectTime = 0;
const unsigned long wifiRebootTimeout = 300000; // Reboot if disconnected for > 5 minutes (300s)

// Non-blocking MQTT recovery timers
unsigned long lastMqttRetry = 0;
const unsigned long mqttRetryInterval = 5000; // 5s between MQTT retries

// LED status flashing
unsigned long lastLedFlashTime = 0;
bool ledState = false;

// --- Helper Functions ---

// Get unique device ID based on MAC address
void getUniqueDeviceId() {
  // Ensure the Wi-Fi stack is initialized in Station mode so the MAC address can be read correctly
  WiFi.mode(WIFI_STA);
  uint8_t mac[6] = {0};
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

// Setup and initial WiFi configuration
void setupWifi() {
  Serial.println();
  Serial.print("[WIFI] Initializing WiFi for SSID: ");
  Serial.println(ssid);

  // Configure Wi-Fi station parameters
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);

  // Disable 802.11 modem sleep to maintain solid beacon lock on low/fair signal
  WiFi.setSleep(false);

  // Maximize TX power for weak signal environments
  WiFi.setTxPower(WIFI_POWER_19_5dBm);

  // Register asynchronous WiFi event handlers for diagnostics and clean state management
  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    Serial.printf("[WIFI EVENT] Disconnected! Reason code: %d\n", info.wifi_sta_disconnected.reason);
  }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);

  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    Serial.println("[WIFI EVENT] Connected to Access Point.");
  }, ARDUINO_EVENT_WIFI_STA_CONNECTED);

  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    Serial.print("[WIFI EVENT] Obtained IP address: ");
    Serial.println(IPAddress(info.got_ip.ip_info.ip.addr));
  }, ARDUINO_EVENT_WIFI_STA_GOT_IP);

  WiFi.begin(ssid, password);

  // Initial connection attempt with timeout
  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED && attempt < 40) { // Up to 10s wait during boot
    esp_task_wdt_reset();
    digitalWrite(LED_STATUS_BOARD, ledState ? HIGH : LOW);
    ledState = !ledState;
    delay(250);
    Serial.print(".");
    attempt++;
  }

  digitalWrite(LED_STATUS_BOARD, LOW);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("");
    Serial.println("[WIFI] Initial connection established!");
    Serial.print("[WIFI] IP Address: ");
    Serial.println(WiFi.localIP());

    // Configure NTP for time synchronization
    Serial.println("[TIME] Configuring SNTP...");
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  } else {
    Serial.println("\n[WIFI] Initial connection attempt timed out; background recovery active.");
  }
}

// Non-blocking WiFi health check and recovery
void maintainWifi() {
  unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (lastWifiDisconnectTime == 0) {
      lastWifiDisconnectTime = now;
      Serial.println("[WIFI] Link down detected.");
    } else if (now - lastWifiDisconnectTime > wifiRebootTimeout) {
      Serial.println("[WIFI CRITICAL] Offline for > 5 minutes. Rebooting ESP to restore stack...");
      ESP.restart();
    }

    if (now - lastWifiRetry > wifiRetryInterval) {
      lastWifiRetry = now;
      Serial.println("[WIFI] Re-triggering connection...");
      WiFi.disconnect();
      WiFi.reconnect();
    }
  } else {
    if (lastWifiDisconnectTime != 0) {
      Serial.println("[WIFI] Link restored!");
      lastWifiDisconnectTime = 0;
    }
  }
}

// Non-blocking MQTT connection manager
void maintainMqtt() {
  if (WiFi.status() != WL_CONNECTED) {
    return; // Wait until WiFi is established
  }

  if (!mqttClient.connected()) {
    unsigned long now = millis();
    if (now - lastMqttRetry > mqttRetryInterval) {
      lastMqttRetry = now;
      Serial.print("[MQTT] Connecting to broker: ");
      Serial.print(mqtt_server);
      Serial.print(":");
      Serial.println(mqtt_port);

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
        Serial.println(". Will retry in background.");
      }
    }
  } else {
    mqttClient.loop();
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

  // Initialize Hardware Task Watchdog Timer (WDT)
  Serial.printf("[WDT] Initializing Task Watchdog (%u seconds)...\n", WDT_TIMEOUT_SECONDS);
  esp_task_wdt_init(WDT_TIMEOUT_SECONDS, true);
  esp_task_wdt_add(NULL); // Subscribe Arduino loop thread to WDT

  // Load identity
  getUniqueDeviceId();
  Serial.print("[DEVICE] Unique ID: ");
  Serial.println(deviceId);

  // Setup WiFi
  setupWifi();

  // Configure MQTT
  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(512); // Increase buffer size to handle larger telemetry payloads

  // Read initial contactor state (LOW = active B-tariff due to pull-up shorted to GND)
  debouncedGridActive = (digitalRead(SEN_GRID_B_CONTACTOR) == LOW);
  lastGridActive = debouncedGridActive;
}

// --- Arduino loop() ---
void loop() {
  // 0. Reset Task Watchdog Timer on every loop cycle
  esp_task_wdt_reset();

  // 1. Maintain Wi-Fi connectivity (Non-blocking)
  maintainWifi();

  // 2. Maintain MQTT connectivity (Non-blocking)
  maintainMqtt();

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
