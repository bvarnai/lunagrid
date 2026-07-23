# Electrical Safety & Technical Risk Review

This document provides a comprehensive safety analysis, electrical risk review, and software architectural assessment for **Project Lunagrid**.

---

## 1. Electrical Safety & Mains Voltage Hazards (230V AC)

Interfacing with **230V AC mains electricity** carries extreme risk. Standard grid power can cause severe electrical shock, cardiovascular failure (fibrillation), internal/external burns, and electrical fires. 

### 1.1 Galvanic Isolation Failure Modes
The Lunagrid hardware design relies on an **Iskra IKA20-11/230V** installation contactor to separate the high-voltage mains from the low-voltage (3.3V/5V DC) ESP32-C3 microcontroller.
*   **The Hazard:** If the contactor experiences an internal insulation breakdown (dielectric breakdown due to aging, high temperature, transients, or inductive surges from switching), the 230V AC grid voltage can bridge onto the low-voltage auxiliary contacts (Normally Open terminals 1 and 2).
*   **The Impact:** Direct exposure of 230V AC to the ESP32-C3 will immediately destroy the microcontroller and energize all connected low-voltage circuits, including the USB power supply, programming cables, and potentially any connected host PC or physical enclosure, posing a lethal shock hazard to users.
*   **Mitigation Strategies:**
    1.  **Use Certified Equipment:** Always use certified contactors (CE, VDE, UL rated) with high dielectric insulation strength (at least 4.0 kV between coil and contacts).
    2.  **Optoisolation (Highly Recommended):** Add a secondary isolation barrier using an optocoupler (e.g., PC817) on the dry contact loop. Instead of connecting the contactor contacts directly to the ESP32 GPIO, use them to switch an isolated LED circuit that triggers the optocoupler's phototransistor, keeping the microcontroller completely isolated.
    3.  **Proper Grounding & Housing:** Mount the ESP32 node in an insulated, non-conductive IP54/IP67 plastic enclosure. Never use metal enclosures unless they are securely bonded to Protective Earth (PE).

### 1.2 Overcurrent Protection & Fire Hazards
The contactor coil is connected to the switched B-tariff line. Mains circuits in domestic distribution boards are typically protected by 10A, 16A, or 25A circuit breakers (MCBs).
*   **The Hazard:** A internal short circuit or insulation degradation in the contactor coil will draw excess current. However, a small contactor coil can melt, catch fire, or generate toxic smoke under a partial short circuit *before* drawing enough current to trip a standard 16A mains breaker.
*   **The Impact:** Significant fire hazard inside the main household distribution panel.
*   **Mitigation Strategies:**
    1.  **Dedicated In-Line Fusing:** Install a low-amperage, fast-acting fuse (e.g., 500mA or 1A, glass or ceramic) in series with the contactor coil's line connection (A1 terminal) using a DIN-rail mounted fuse holder.
    2.  **Surge Protection:** Place a Metal Oxide Varistor (MOV) or transient-voltage-suppression (TVS) diode across the contactor coil terminal (A1/A2) to clamp inductive spikes during switching.

### 1.3 Physical Creepage, Clearance, and Cable Routing
*   **The Hazard:** Running low-voltage (GPIO/GND) and high-voltage (230V AC) cables in close proximity or within the same duct can lead to cross-talk, signal noise, or physical insulation chafing, leading to high-voltage leakage.
*   **Mitigation Strategies:**
    1.  Maintain a minimum creepage (surface distance) and clearance (air gap) of at least **8 mm** between high-voltage terminals and low-voltage signal lines.
    2.  Never bundle, tape, or run high-voltage mains wiring alongside the low-voltage sensor cables.
    3.  Keep the low-voltage ESP32 enclosure and power adapter physically partitioned from the high-voltage sections of the distribution board.

### 1.4 Regulatory & Code Compliance
In most jurisdictions (including Hungary and across the EU), working inside electrical distribution boards or connecting equipment directly to mains lines is restricted by law.
*   **The Requirement:** All high-voltage electrical work **MUST** be performed by a certified, licensed electrician (*regisztrált villanyszerelő*).
*   **The Risk:** Unprofessional installation can void home insurance coverage, breach building safety codes, and lead to criminal liability in the event of an electrical fire or accident.

---

## 2. Technical Gaps & Firmware Analysis

A code audit of the current firmware ([main.cpp](file:///home/bvarnai/workspace/lunagrid/firmware/src/main.cpp)) reveals several critical bugs and differences from the project specifications:

### 2.1 GPIO Configuration Discrepancy
*   **The Issue:** The project plan ([lunagrid_project_plan.md](file:///home/bvarnai/workspace/lunagrid/docs/lunagrid_project_plan.md)) contains conflicting references to the sensor pin:
    *   Section 2.2 and Section 8.1 specify **GPIO 3**.
    *   Section 4.1 specifies **GPIO 2** (for internal pull-ups, monitoring, and state debouncing).
*   **The Resolution:** The firmware source code ([main.cpp](file:///home/bvarnai/workspace/lunagrid/firmware/src/main.cpp)) uses `#define SEN_GRID_B_CONTACTOR 3`. The project plan must be updated to consistently reference GPIO 3 to avoid wiring errors during physical assembly.

### 2.2 Blocking Network Routines (Loss of State Detection)
*   **The Issue:** In [main.cpp](file:///home/bvarnai/workspace/lunagrid/firmware/src/main.cpp), the network connection routines `setupWifi()` and `reconnectMqtt()` are completely blocking:
    ```cpp
    while (WiFi.status() != WL_CONNECTED) {
       // Loop blocks execution ...
    }
    while (!mqttClient.connected()) {
       // Loop blocks execution ...
    }
    ```
*   **The Impact:** If the Wi-Fi router loses power or the MQTT broker goes offline, the microcontroller becomes trapped inside these loops. Because the sensor pin polling is done in `loop()`, **the device will completely fail to detect contactor state transitions while attempting to reconnect.** If a grid state transition occurs during a network outage, it is permanently missed.
*   **Mitigation:** Refactor the network connection code to be non-blocking using a simple state machine, or utilize hardware interrupts (`attachInterrupt()`) on GPIO 3 to log events to a queue regardless of whether the main loop is waiting on network tasks.

### 2.3 Missing Offline Buffering and Captive Portal
*   **The Issue:** The project plan specifies that if the network is disconnected, the device will switch to `OFFLINE_BUFFERING` and save events with NTP timestamps to a 1MB partition in the internal LittleFS flash. It also specifies launching a local Captive Portal for Wi-Fi provisioning after 30 seconds of failure.
*   **The Reality:** The current firmware ([main.cpp](file:///home/bvarnai/workspace/lunagrid/firmware/src/main.cpp)) does not implement LittleFS, contains no flash writing logic, lacks a Captive Portal, and simply resets the board via `ESP.restart()` if Wi-Fi cannot connect within 15 seconds.
*   **Mitigation:** The firmware needs to be extended to mount LittleFS, track time using NTP/RTC offset buffers, and cache events locally during offline phases rather than rebooting.

### 2.4 Firmware Security & Unsigned OTA Updates
*   **The Issue:** The OTA process in the firmware does not sign or verify the binary image files before flashing. The ESP32-C3 fetches the binary from any arbitrary URL received via MQTT command topics and flashes it.
*   **The Impact:** If an attacker intercepts the local network or compromises the MQTT broker credentials, they can push malicious firmware updates to all active devices. This allows arbitrary code execution, device hijacking, or using the ESP32 node as an entry point into the local network.
*   **Mitigation:** Implement cryptographic signature verification on the ESP32 (using ESP-IDF secure boot features or checking a digital signature embedded in the binary file header against a public key stored on the ESP32).

---

## 3. Risk Matrix Summary

| Hazard / Issue | Severity | Probability | Recommended Mitigation |
| :--- | :--- | :--- | :--- |
| **Direct Shock (230V AC)** | **Lethal** | Low | Isolation contactor, optocoupler isolation, non-conductive enclosure, licensed electrician install. |
| **Electrical Fire** | **High** | Low | Series inline fuse (0.5A/1A fast-acting) on contactor coil, certified components. |
| **Cable Insulation Breakdown** | **High** | Medium | Maintain >8mm creepage/clearance, physically separate high and low-voltage routes. |
| **Missed State Transitions** | **Medium** | High | Rewrite network connection code to be non-blocking; use hardware interrupts instead of polling. |
| **Data Loss During Outages** | **Medium** | High | Implement LittleFS caching and NTP local offset queue as described in the project plan. |
| **Unsigned OTA Hijack** | **High** | Low | Implement binary signature verification on the ESP32 before writing to flash. |

