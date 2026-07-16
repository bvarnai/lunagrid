# IoT Project Proposal & Specification - Project Lunagrid

This document outlines the system architecture, hardware requirements, communication protocols, firmware behavior, and cloud ingestion pipeline for **Project Lunagrid**, a low-cost, safety-first, end-user IoT device designed to monitor grid power status and log the active windows of the switched controlled tariff ("éjszakai áram") in Hungary.

---

## 1. Project Overview & Architecture

### 1.1 Executive Abstract
In Hungary, Distribution System Operators (DSOs) offer a reduced-rate controlled tariff known as "B tarifa" or "éjszakai áram" (night electricity). Instead of active timing, the DSO switches this grid line on and off dynamically using ripple control (hangfrekvenciás vezérlés) for a cumulative duration of at least 8 hours per 24-hour period. Because these active windows shift depending on seasonal loads and grid stabilization needs, consumers cannot predict when their appliances (mostly storage water heaters) will receive power.

**Project Lunagrid** solves this by providing a non-intrusive, safe, and low-cost IoT monitor. Using a dedicated physical contactor (Iskra IKA20-11/230V) to isolate the high-voltage 230V AC B-tariff line, the system uses an ESP32-C3 Super Mini development board to sense the line status. Real-time telemetry is uploaded via Wi-Fi to a cloud broker, enabling time-series tracking, historical availability analysis, and push notifications.

### 1.2 System Architecture Diagram
```
+------------------------------------+          +--------------------------------------+
|        Mains Power Panel           |          |         Project Lunagrid Node        |
|                                    |          |                                      |
|  [B Tarifa (230V AC)] (Switched)   | -------- |  IKA20-11 Contactor Coil (A1/A2)     |
|                                    |          |  (Complete Galvanic Isolation)       |
|                                    |          |                                      |
|  [A Tarifa (230V AC)] (Always-On)  | -+       |  NO Contacts (1/2)                   |
+------------------------------------+  |       +-------------------+------------------+
                                        |                           |
                                        v                           | GPIO 2 (Internal Pull-Up) / GND
                              +------------------+                  v
                              | USB Power Adapt. | -------> [ ESP32-C3 Super Mini ]
                              | (5V DC USB-C)    |          [ (RISC-V, 4MB Flash) ]
                              +------------------+                  |
                                                                    | 2.4 GHz Wi-Fi
                                                                    v
                                                       +--------------------------+
                                                       | Home Wi-Fi Router        |
                                                       +------------+-------------+
                                                                    |
                                                                    | MQTT over TLS (Port 8883)
                                                                    v
                                                       +--------------------------+
                                                       | Cloud Ingestion          |
                                                       | (Mosquitto/HiveMQ Broker)|
                                                       +------------+-------------+
                                                                    |
                                                                    v
                                                       +--------------------------+
                                                       | InfluxDB Time-Series DB  |
                                                       +------------+-------------+
                                                                    |
                                                                    v
                                                       +--------------------------+
                                                       | Grafana Dashboard        |
                                                       +--------------------------+
```

---

## 2. Hardware Architecture & Edge Layer

### 2.1 Microcontroller Specification
| Component | Specification | Selection Justification |
| :--- | :--- | :--- |
| **Core MCU/MPU** | ESP32-C3 Super Mini | RISC-V 32-bit single-core CPU (160MHz). Compact format, low cost, built-in cryptography and low-power modes. |
| **RAM/Flash** | 400KB SRAM, 4MB External Flash | Fits FreeRTOS, Wi-Fi/TLS stacks, and holds enough LittleFS storage for weeks of offline buffering. |
| **Operating System** | ESP-IDF / Arduino Core | Offers robust RTOS multitasking, Wi-Fi driver stability, and easy OTA implementations. |

### 2.2 Sensor & Actuator Interface Matrix
| Sensor/Actuator ID | Interface Type | Pin Allocation | Sampling Frequency | Operating Voltage |
| :--- | :--- | :--- | :--- | :--- |
| `SEN_GRID_B_CONTACTOR` | Digital Input (Dry Contact) | GPIO 2 (SDA) -> NO Terminal 1<br>GND -> NO Terminal 2 | Interrupt-driven (State changes) | 3.3V (Internal pull-up on MCU) |
| `LED_STATUS_BOARD` | Digital Output | GPIO 8 | Event-driven (Wi-Fi, MQTT state) | 3.3V (On-board blue LED) |

### 2.3 Power Management Profile
*   **Power Source:** Continuous power derived from the "A tarifa" (always-on mains) line via a standard 5V/1A USB power adapter connected via USB-C to the ESP32-C3 Super Mini.
*   **Power States & Current Consumption:**
    *   *Active Mode (Wi-Fi Tx/Rx):* 80–120 mA (during telemetry transmissions).
    *   *Idle Mode:* ~25–35 mA (Wi-Fi connected, waiting for state changes).
    *   *Deep Sleep Mode:* N/A (Not used, since the device is mains-powered and needs to listen to state interrupts in real time).

---

## 3. Communication & Network Protocols

### 3.1 Network Topology
*   **Physical/Link Layer:** Wi-Fi 802.11 b/g/n (2.4 GHz).
*   **Network Topology Type:** Star topology connecting to the local household Wi-Fi router.

### 3.2 Application Layer Protocol & Payload Design
*   **Protocol:** MQTT over TLS v1.3 (MQTTS) on port 8883 for encrypted, low-overhead communication.
*   **MQTT Topic Hierarchy Structure:**
    *   Telemetry: `lunagrid/devices/{device_uuid}/telemetry` (Periodic system health: RSSI, uptime, heap).
    *   State Events: `lunagrid/devices/{device_uuid}/state` (Instant updates on grid state transitions).
    *   Commands: `lunagrid/devices/{device_uuid}/cmd` (For remote reboots or OTA trigger commands).

#### Telemetry JSON Payload Schema
```json
{
  "timestamp": 1784185200,
  "device_id": "lunagrid_c3_001a",
  "metrics": {
    "grid_active": true,
    "uptime_seconds": 3600,
    "free_heap_bytes": 184520
  },
  "status": {
    "wifi_rssi": -62,
    "error_code": 0
  }
}
```

#### State Event JSON Payload Schema
```json
{
  "timestamp": 1784185200,
  "device_id": "lunagrid_c3_001a",
  "event": "GRID_STATE_CHANGED",
  "grid_active": true
}
```

---

## 4. Firmware Engine & Edge Computing

> [!NOTE]
> For step-by-step instructions on setting up the local build environment, configuring WSL2/usbipd, and compiling/flashing the firmware, refer to the [Firmware Development Guide](file:///c:/Users/bvarnai/workspace/lunagrid/docs/firmware_development.md).

### 4.1 State Machine Architecture
*   `BOOT` -> Initialize GPIOs, configure internal pull-up on GPIO 2, mount LittleFS file system, read last known state.
*   `CONNECTING_WIFI` -> Turn on Wi-Fi, attempt connection to configured SSID. If connection fails after 30 seconds, boot local Captive Portal for Wi-Fi provisioning.
*   `CONNECTING_MQTT` -> Establish TLS connection to MQTT Broker. Subscribe to commands topic.
*   `MONITORING` -> Listen to interrupts on GPIO 2. Upon state change, apply debounce filter.
*   `TRANSMITTING` -> Send MQTT event payload. If successful, confirm delivery.
*   `OFFLINE_BUFFERING` -> If Wi-Fi/MQTT is disconnected, write state change events with NTP timestamps to LittleFS internal flash.
*   `ERROR_HANDLING` -> Log diagnostics. Re-trigger hardware watchdog if system stalls.

### 4.2 Edge Processing & Analytics
*   **Software Debouncing:** Mechanical contactors can experience contact bounce for 10–20 ms upon closure or release. The firmware implements a 100 ms software debounce window. The state of GPIO 2 must remain constant for at least 100 ms to qualify as a valid grid status transition, preventing duplicate logging.
*   **Time Synchronization:** The device synchronizes its internal RTC using Network Time Protocol (NTP) pools (`pool.ntp.org`) immediately upon Wi-Fi connection. Timestamps are written in UNIX Epoch format.
*   **Local Storage/Buffering Strategy:** If the home router loses power or Internet connection, telemetry events are buffered in a FIFO queue within the LittleFS partition. The flash layout reserves 1MB for buffering, which is sufficient to record thousands of transition logs. Once connection is restored, the buffered events are pushed before real-time logging resumes.

---

## 5. Cloud Architecture & Data Pipeline

### 5.1 Ingestion & Message Broker
*   **Ingestion Broker:** HiveMQ Cloud (Free Tier) or a self-hosted Eclipse Mosquitto broker running on a local server (e.g., Raspberry Pi/Home Assistant).
*   **Authentication:** TLS certificate authority verification + MQTT Username & Password authentication.

### 5.2 Data Routing & Storage Layers
*   **Ingestion Routing:** Telegraf agent or Node-RED workflow subscribing to topic `lunagrid/devices/+/state`.
*   **Time-Series Storage:** InfluxDB v2 or TimescaleDB. Each entry logs:
    *   Measurement: `grid_status`
    *   Tag: `device_id`
    *   Fields: `active` (boolean), `rssi` (integer)
*   **Cold Path Archival:** Weekly backups of InfluxDB buckets exported to CSV or Parquet files for long-term historical grid behavior profiling.

### 5.3 Visualization & End-User Interface
*   **Grafana Dashboard panels:**
    1.  **State Indicator:** A large SingleStat panel showing "ONLINE / ON-PEAK" (Green) or "OFF-PEAK" (Red) representing "éjszakai áram" availability.
    2.  **State Timeline:** Visual representation of ON/OFF state transitions throughout the day, showing the exact times B-tariff was active.
    3.  **Accumulated Usage:** Bar chart tracking daily total active hours (verifying compliance with the 8-hour DSO minimum requirement).
    4.  **Health Monitor:** Line chart tracking Wi-Fi RSSI and device free heap over time.

---

## 6. Security, Governance, and Lifecycle Management

### 6.1 Hardware-to-Cloud Security Matrix
*   **Device Identity:** Unique client ID generated from the ESP32-C3 MAC address.
*   **Encryption in Transit:** Mandatory TLS 1.3 encryption on Port 8883.
*   **Isolation:** The high voltage (230V AC) is isolated entirely inside the mains panel by the IKA20-11 contactor. Only low voltage dry contact wires leave the panel to connect to the ESP32-C3 enclosure, keeping the user interface completely safe.

### 6.2 Over-The-Air (OTA) Firmware Updates
*   **Update Mechanism:** Standard ESP32 OTA update over HTTPS.
*   **Rollback Strategy:** Dual partition scheme (OTA_0 and OTA_1) is managed by the ESP32-C3 bootloader. If the newly flashed firmware fails to connect to Wi-Fi within 120 seconds, the bootloader automatically rolls back to the previous stable partition.

---

## 7. Bill of Materials (BOM) & Cost Analysis

| Component Category | Item Description | Supplier | Part Number | Est. Unit Cost |
| :--- | :--- | :--- | :--- | :--- |
| **MCU Board** | ESP32-C3 Super Mini Development Board | AliExpress / Local IoT shop | ESP32-C3 Super Mini | $3.00 |
| **Isolation / Sensor**| Installation Contactor 230V AC Coil (1 NO + 1 NC) | Iskra / Electrical Supplier | IKA20-11/230V | $12.00 |
| **Power Supply** | USB Wall Power Supply (5V, 1A) | General Electronics | 5V 1A USB-A Charger | $5.00 |
| **Cable** | USB-A to USB-C Cable (1m) | General Electronics | USB-C Cable | $1.00 |
| **Enclosure** | Small ABS Plastic Enclosure IP54 | Enclosure supplier | ABS Box 80x50x26mm | $4.00 |
| **Wiring** | Dupoint / Hookup wire for contacts | General Electronics | Solid Core Wire | $1.00 |
| **Total Hardware Cost**| | | | **$26.00** |

---

## 8. Verification, Testing & Deployment Roadmap

### 8.1 Test Plan Matrix
*   **Dry Contact Logic Test:** Verify that shorting GPIO 2 to GND manually triggers a state change log to serial console and publishes an MQTT payload.
*   **Contactor Operation Test:** Connect the IKA20-11 coil to a switched 230V AC test bench. Verify the contactor clicks on/off and the dry contacts open/close reliably without overheating.
*   **Debounce Test:** Introduce synthetic contact bouncing on the input pin to ensure the 100 ms software debounce logic successfully logs only one event.
*   **Network Interruption Test:** Power off the Wi-Fi router. Verify the device switches to LittleFS local buffering. Turn the router back on and verify that buffered events are published with their original NTP-synchronized timestamps.

### 8.2 Future Improvements
*   **Battery/Supercapacitor Backup:** Integrate a power path charger IC (e.g., TP4056) and a small LiPo battery to allow the device to sense and log general blackouts on the "A tarifa" line.
*   **DIN-Rail Enclosure Integration:** Mount the ESP32-C3 and its USB power supply inside a dedicated 1-module or 2-module DIN-rail plastic enclosure, placing the entire system side-by-side with the IKA20-11 contactor in the fuse box.
