#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>

// --- Configuration ---
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* mqtt_server = "broker.hivemq.com"; // Default broker from plan
const int mqtt_port = 8883;

// GPIO configuration
#define SEN_GRID_B_CONTACTOR 2
#define LED_STATUS_BOARD 8

// State Machine definitions
enum DeviceState {
  BOOT,
  CONNECTING_WIFI,
  CONNECTING_MQTT,
  MONITORING,
  ERROR_HANDLING
};

DeviceState currentState = BOOT;

// Client instances
WiFiClientSecure wifiClient;
PubSubClient mqttClient(wifiClient);

// Debouncing variables
volatile bool gridActive = false;
volatile unsigned long lastInterruptTime = 0;
const unsigned long debounceDelay = 100; // 100ms debounce from plan

// --- Interrupt Service Routine (ISR) ---
void IRAM_ATTR handleContactChange() {
  unsigned long interruptTime = millis();
  if (interruptTime - lastInterruptTime > debounceDelay) {
    gridActive = (digitalRead(SEN_GRID_B_CONTACTOR) == HIGH);
    lastInterruptTime = interruptTime;
  }
}

// --- Setup ---
void setup() {
  pinMode(SEN_GRID_B_CONTACTOR, INPUT_PULLUP);
  pinMode(LED_STATUS_BOARD, OUTPUT);

  // Initialize Native USB CDC Serial
  Serial.begin(115200);
  
  // Attach interrupt for contactor state change
  attachInterrupt(digitalPinToInterrupt(SEN_GRID_B_CONTACTOR), handleContactChange, CHANGE);
  
  currentState = CONNECTING_WIFI;
}

// --- Main Loop ---
void loop() {
  switch (currentState) {
    case BOOT:
      // Handled in setup
      break;

    case CONNECTING_WIFI:
      Serial.println("[WIFI] Connecting...");
      // Add Wi-Fi connection logic
      currentState = CONNECTING_MQTT;
      break;

    case CONNECTING_MQTT:
      Serial.println("[MQTT] Connecting to broker...");
      // Add secure TLS/MQTT connection logic
      currentState = MONITORING;
      break;

    case MONITORING:
      // Loop MQTT connection to process incoming packets
      if (!mqttClient.connected()) {
        currentState = CONNECTING_MQTT;
        break;
      }
      mqttClient.loop();
      
      // Heartbeat or event-driven checks
      break;

    case ERROR_HANDLING:
      Serial.println("[SYSTEM] Error state encountered. Restarting...");
      ESP.restart();
      break;
  }
}
