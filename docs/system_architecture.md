# System Architecture & Specifications - Project Lunagrid

This document outlines the system architecture, hardware requirements, communication protocols, firmware behavior, and cloud ingestion pipeline for **Project Lunagrid**, a low-cost, safety-first IoT device designed to monitor grid power status and log the active windows of the switched controlled tariff ("éjszakai áram") in Hungary.

---

## 1. Project Overview & Architecture

### 1.1 Executive Abstract
In Hungary, Distribution System Operators (utility providers) offer a reduced-rate controlled tariff known as "B tarifa" or "éjszakai áram" (night electricity). Instead of active timing, the utility provider switches this grid line on and off dynamically using ripple control (hangfrekvenciás vezérlés) for a cumulative duration of at least 8 hours per 24-hour period. Because these active windows shift depending on seasonal loads and grid stabilization needs, consumers cannot predict when their appliances (mostly storage water heaters) will receive power.

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
                                        v                           | GPIO 3 (Internal Pull-Up) / GND
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
                                                                    | MQTT (Port 1883)
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
| **RAM/Flash** | 400KB SRAM, 4MB External Flash | Fits FreeRTOS, Wi-Fi stacks, and provides enough flash capacity for firmware features. |
| **Operating System** | ESP-IDF / Arduino Core | Offers robust RTOS multitasking, Wi-Fi driver stability, and easy OTA implementations. |

### 2.2 Sensor & Actuator Interface Matrix
| Sensor/Actuator ID | Interface Type | Pin Allocation | Sampling Frequency | Operating Voltage |
| :--- | :--- | :--- | :--- | :--- |
| `SEN_GRID_B_CONTACTOR` | Digital Input (Dry Contact) | GPIO 3 (RX) -> NO Terminal 1<br>GND -> NO Terminal 2 | Interrupt-driven (State changes) | 3.3V (Internal pull-up on MCU) |
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
*   **Protocol:** MQTT over standard TCP on port 1883 (unencrypted).
*   **MQTT Topic Hierarchy Structure:**
    *   Telemetry: `lunagrid/devices/{device_uuid}/telemetry` (Periodic system health: RSSI, uptime, heap, firmware version).
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
    "error_code": 0,
    "firmware_version": "1.0.1"
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
> For step-by-step instructions on setting up the local build environment, configuring WSL2/usbipd, and compiling/flashing the firmware, refer to the [Firmware Development Guide](firmware_development.md).

### 4.1 State Machine Architecture
*   `BOOT` -> Initialize GPIOs, configure internal pull-up on GPIO 3, initialize Hardware Task Watchdog Timer (30s timeout), read initial contactor state.
*   `CONNECTING_WIFI` -> Configure Wi-Fi station parameters (modem sleep disabled, max 19.5 dBm TX power, asynchronous event handlers). Attempt connection for up to 10 seconds during boot. If connection is pending, boot sequence proceeds and background recovery maintains the link.
*   `CONNECTING_MQTT` -> Non-blocking connection attempts to the MQTT Broker on Port 1883 every 5 seconds. Subscribe to command topic upon connection.
*   `MONITORING` -> Continuous loop monitoring state transitions on GPIO 3 with 100 ms debounce filter while feeding the hardware watchdog.
*   `TRANSMITTING` -> Send MQTT state transitions (immediate) or telemetry health metrics (every 5 minutes).

### 4.2 Edge Processing, Resiliency & Recovery
*   **Software Debouncing:** Mechanical contactors can experience contact bounce for 10–20 ms upon closure or release. The firmware implements a 100 ms software debounce window. The state of GPIO 3 must remain constant for at least 100 ms to qualify as a valid grid status transition, preventing duplicate logging.
*   **Time Synchronization:** The device synchronizes its internal RTC using Network Time Protocol (NTP) pools (`pool.ntp.org`) immediately upon Wi-Fi connection. Timestamps are written in UNIX Epoch format.
*   **Low/Fair Wi-Fi Signal Optimization:**
    *   **Modem Sleep Disabled (`WiFi.setSleep(false)`):** Prevents the ESP32 RF frontend from entering low-power sleep states, eliminating missed AP DTIM/beacon frames, jitter, and intermittent AP de-authentications in weak signal environments (-75 to -85 dBm).
    *   **Maximum TX Power (`WiFi.setTxPower(WIFI_POWER_19_5dBm)`):** Boosts transmit power to the hardware maximum for reliable communication with distant access points.
*   **Non-Blocking Network Recovery:**
    *   **Wi-Fi Recovery:** If the link drops, non-blocking reconnection attempts occur every 10 seconds without stalling contactor monitoring or loop execution.
    *   **MQTT Recovery:** Reconnection attempts are scheduled every 5 seconds without blocking loops. MQTT `PINGREQ` keep-alive packets maintain the TCP session between the 5-minute periodic telemetry transmissions.
    *   **Prolonged Outage Fallback:** If Wi-Fi remains continuously disconnected for longer than 5 minutes (300 seconds), the node performs a clean software restart (`ESP.restart()`) to reset the Wi-Fi radio stack.
*   **Hardware Task Watchdog Timer (WDT):**
    *   Configured with a **30-second timeout** (`esp_task_wdt_init(30, true)`).
    *   Fed on every cycle of `loop()`. If a low-level driver deadlock or hardware freeze occurs, the WDT triggers an automatic hardware panic reboot.


---

## 5. Cloud Architecture & Data Pipeline

### 5.1 Ingestion & Message Broker
*   **Ingestion Broker:** Self-hosted Eclipse Mosquitto broker or HiveMQ broker running on a local server.
*   **Authentication:** Currently configured with basic MQTT client identification without TLS.

### 5.2 Data Routing & Storage Layers
*   **Ingestion Routing:** Telegraf agent subscribing to topic `lunagrid/devices/+/state` and writing raw fields directly to InfluxDB.
*   **Secure API Database Bridge:** To shield InfluxDB access tokens from the web browser, the Node.js Express server acts as a secure bridge. The frontend client queries standard endpoints like `GET /api/locations/:id/history` and `/api/locations/:id/compliance`, which are translated securely into Flux queries and forwarded to InfluxDB.
*   **Relational Metadata Registry:** An SQLite database handles the 1-to-1 mappings of physical devices to locations. This database path is configurable via `DATABASE_PATH` and persisted across container rebuilds via a Docker named volume (`backend-db` mapped to `/data`).
*   **InfluxDB Retention Policy:** The `lunagrid-telemetry` bucket has an initial retention policy set to **30 days (`30d`)** in `docker-compose.yml` to automatically purge high-frequency raw 2s telemetry signals and prevent disk space exhaustion.

### 5.3 Visualization & User Interface
*   **Single-Page React Portal:** Built as a tabbed web interface optimized for modern desktop layouts:
    1.  **Dashboard Tab:**
        *   **Grid State Hero:** Real-time B-tariff status reading either `B-Tariff ON` (Green) or `B-Tariff OFF` (Red).
        *   **Today's Availability Strip:** A 24-segment timeline strip visualizing B-tariff active hours for the current calendar day (from 00:00 to 23:00).
        *   **Contractual Compliance (7-Day Overview):** 7 calendar blocks calculating B-tariff hours per day relative to the location's configurable Provider Contract Target (defaulting to 8.0h/day). Marks days **`🟢 COMPLIANT`** (hours >= target) or **`🔴 FAIL`** (hours < target). Renders as **`⚫ N/A`** for days with missing telemetry.
        *   **Car Away Panel:** Supports manual toggle override and a daily automatic schedule (`From` - `To` in strict 24h format) with stateful lifecycle management: triggers graceful teardown (`OFF` / standby) for active charging sessions upon activation, and automatically resumes charging (`ON`) upon deactivation when B-tariff is live.
        *   **Diagnostic Parameters:** Real-time RSSI signal quality badges, heap size, and formatted uptime.
        *   **Stretched Activity Console Logs:** Displays rolling logs with client-side local timezone formatting.
    2.  **Locations & Devices Tab:** Create locations, map device registrations, and unregister devices manually.
    3.  **Source Settings Tab:** Configure API endpoints, test backend health (visualizing API versioning), and toggle diagnostic logging.
*   **Traffic & Bandwidth Optimizations:**
    *   **Tab Inactivity Detection:** All API polling loops automatically pause when the browser tab is hidden (`document.hidden`).
    *   **Conditional Log Polling:** Activity logs are only fetched from the backend when the diagnostics toggle is checked in Settings, reducing REST endpoint overhead.

---

## 6. Security, Governance, and Lifecycle Management

### 6.1 Hardware-to-Cloud Security Matrix
*   **Device Identity:** Unique client ID generated from the ESP32-C3 MAC address.
*   **Encryption in Transit:** In this version, communication over MQTT is unencrypted (Port 1883). Users are encouraged to run their broker inside a private VPN (such as Tailscale) or a local VLAN to protect data and credentials from interception.
*   **Isolation:** The high voltage (230V AC) is isolated entirely inside the mains panel by the IKA20-11 contactor. Only low voltage dry contact wires leave the panel to connect to the ESP32-C3 enclosure, keeping the user interface completely safe. *Note: Galvanic isolation carries significant risk of breakdown under surge conditions or component failure. Please consult the [Electrical Safety & Technical Risk Review](electrical_safety_review.md) for critical warning guidelines and circuit protection recommendations.*

### 6.2 Over-The-Air (OTA) Firmware Updates
*   **Update Mechanism:** Standard ESP32 OTA update over HTTP.
*   **Validation:** Firmware updates are executed through PlatformIO's standard `httpUpdate` client. Cryptographic signature verification is not active in this release; binaries are pulled directly from the registered rollout URL.

---

## 7. Bill of Materials (BOM) & Cost Analysis

| Component Category | Item Description | Supplier | Part Number | Est. Unit Cost |
| :--- | :--- | :--- | :--- | :--- |
| **MCU Board** | ESP32-C3 Super Mini Development Board | AliExpress / Local IoT shop | ESP32-C3 Super Mini | $3.00 |
| **Isolation / Sensor**| Installation Contactor 230V AC Coil (1 NO + 1 NC) | Iskra / Electrical Supplier | IKA20-11/230V | $12.00 |
| **Power Supply** | USB Wall Power Supply (5V, 1A) | General Electronics | 5V 1A USB-A Charger | $5.00 |
| **Cable** | USB-A to USB-C Cable (1m) | General Electronics | USB-C Cable | $1.00 |
| **Enclosure** | Small ABS Plastic Enclosure IP54 | Enclosure supplier | ABS Box 80x50x26mm | $4.00 |
| **Wiring** | Dupont / Hookup wire for contacts | General Electronics | Solid Core Wire | $1.00 |
| **Total Hardware Cost**| | | | **$26.00** |

---

## 8. Verification, Testing & Deployment Roadmap

### 8.1 Test Plan Matrix
*   **Dry Contact Logic Test:** Verify that shorting GPIO 3 to GND manually triggers a state change log to serial console and publishes an MQTT payload.
*   **Contactor Operation Test:** Connect the IKA20-11 coil to a switched 230V AC test bench. Verify the contactor clicks on/off and the dry contacts open/close reliably without overheating.
*   **Debounce Test:** Introduce synthetic contact bouncing on the input pin to ensure the 100 ms software debounce logic successfully logs only one event.
*   **Network Reconnect Test:** Power off the Wi-Fi router. Verify the device attempts to reconnect. Turn the router back on and verify that real-time status logging resumes automatically.

### 8.2 Future Improvements
*   **Battery/Supercapacitor Backup:** Integrate a power path charger IC (e.g., TP4056) and a small LiPo battery to allow the device to sense and log general blackouts on the "A tarifa" line.
*   **DIN-Rail Enclosure Integration:** Mount the ESP32-C3 and its USB power supply inside a dedicated 1-module or 2-module DIN-rail plastic enclosure, placing the entire system side-by-side with the IKA20-11 contactor in the fuse box.

---

## 9. Implemented Capabilities vs. Known Gaps

To help users understand the current maturity of Project Lunagrid, this section outlines the features currently active in the codebase versus the planned security and reliability features that are not yet implemented.

### 9.1 Implemented Capabilities
*   **Edge Grid Monitoring**: Interrupt-driven status sensing of the physical contactor (B-tariff grid line status) on GPIO 3 with a 100ms software debounce filter.
*   **Network Telemetry**: Periodic status reports (every 5 minutes) containing Wi-Fi RSSI signal quality, system uptime, and heap size metrics.
*   **Secure Backend Bridge**: A Node.js middleware wrapper that maps physical devices to locations in SQLite, queries historical availability and daily B-tariff compliance targets from InfluxDB, and caches local console logs.
*   **EV Charging Automation**: A multi-channel automated dispatcher triggering third-party endpoints (Webhooks, MQTT topics, ntfy push notifications, or local shell scripts) on grid tariff transitions with graceful session termination on Car Away.
*   **Responsive User Portal**: Renders daily availability timelines, compliance indicators, a diagnostic activity logger, and a manual/scheduled Car Away state controller.
*   **Remote OTA Manager**: Handles registrations of firmware versions and triggers remote HTTP OTA rollouts to edge devices via command topics.

### 9.2 Known Gaps & Planned Enhancements
*   **Wi-Fi Captive Portal**: Currently, Wi-Fi credentials (SSID/Password) are statically hardcoded in the C++ firmware. A local Captive Portal for on-the-fly Wi-Fi provisioning is not yet implemented.
*   **Offline Telemetry Caching**: The device lacks offline storage capability. In the event of a Wi-Fi or MQTT broker disconnection, grid state transitions that occur during the outage are not buffered on-board and are permanently lost.
*   **Transport Layer Security (TLS/MQTTS)**: All MQTT broker communication (Port 1883) and OTA firmware updates are conducted over unencrypted TCP. Implementing secure TLS (Port 8883) with root certificate pinning is planned.
*   **OTA Cryptographic Verification**: The firmware does not verify binary signatures. The ESP32-C3 flashes any compiled binary received from the rollout URL, which poses a security risk if the MQTT command broker is compromised.
