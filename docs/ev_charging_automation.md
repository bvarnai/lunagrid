# EV Charging Automation Guide

This guide explains how to configure and use the **EV Charging Automation** in Project Lunagrid. This feature allows you to automate charging state changes and wake up your electric vehicle (e.g., a Skoda Enyaq) when the B-tariff switches to ON, and gracefully suspend charging when B-tariff switches to OFF.

---

## 1. How It Works

1. The Lunagrid ESP32-C3 node detects B-tariff power status and publishes a `state` message containing `grid_active: true` (or `false`) to the MQTT broker.
2. The Lunagrid backend server ingests this state message.
3. If the **EV Charging Automation** is enabled for the associated location, the backend automatically triggers the configured action for both transitions:
   - **ON Transition (B-tariff ON)**: Triggers charging active actions (wakeups/active status notifications).
   - **OFF Transition (B-tariff OFF)**: Triggers charging inactive actions (shutdowns/standby status notifications).
4. The backend supports multiple integration types:
   - **Webhook (HTTP POST)**: Dispatches HTTP POST requests with state status details to remote systems (e.g. Home Assistant or EVCC).
   - **ntfy Notification Service**: Dispatches push notifications to ntfy channels with status updates.
   - **Local Script / CLI Command**: Runs shell commands on the server with state placeholders and environment variables.
   - **MQTT Message Broker**: Publishes custom state payloads directly to MQTT topics (e.g. informing EVCC of charger state).

---

## 2. Configuration Options in the Web Portal

Under the **Locations & Devices** tab, each location card exposes an **EV Charging Automation** panel:

1. **Enabled** (Checkbox): Toggles the automation on or off.
2. **Automation Type**:
   - **Webhook (HTTP POST)**: Sends a HTTP POST on both transitions.
   - **ntfy Notification Service**: Sends push notifications on both transitions.
   - **Local Shell Script / CLI**: Runs local CLI commands on both transitions.
   - **MQTT Message Broker**: Publishes state payloads to broker topics.
3. **MQTT Status Topic or Endpoint URL or Script Command**:
   - For webhooks and ntfy, enter the target URL.
   - For MQTT, enter the topic name (e.g. `evcc/charger/status`).
   - For scripts, enter the shell command. Use the `{state}` placeholder which will be replaced with `"on"` or `"off"` dynamically.
4. **Car Away Toggle, Graceful Session Teardown & Daily Automatic Schedule**:
   - Located in the **Car Away** panel on the **Dashboard**.
   - Supports both **Manual Override** toggle and a **Daily Automatic Schedule** (`From` - `To` time window, e.g. `08:00` - `17:00`).
   - **Semantic Meaning**: "Car Away" implicitly indicates that the EV is absent from the location (EV charging is OFF / B-tariff is inactive for the vehicle).
   - **Graceful Termination on Activation**: If Car Away is enabled (manually or when entering the scheduled window) while B-tariff is actively ON and charging is underway, the backend automatically issues a graceful teardown (`state: "off"`) to all configured integrations (e.g. MQTT publishes `"A"` with retain, Webhooks receive `B_TARIFF_OFF`, scripts receive `EV_STATE=off`). This prevents external actors like EVCC or Home Assistant from remaining in an inconsistent "Charging" state while the car is away.
   - **Automatic Resumption on Car Return**: When Car Away is deactivated (manually or schedule window ends), the backend re-evaluates the current B-tariff grid state. If B-tariff is active at that moment, it automatically dispatches an `ON` transition to immediately resume charging without waiting for the next grid toggle cycle.
   - **Continuous Schedule Watcher**: A background evaluator continuously tracks schedule windows and executes graceful teardown and resumption transitions seamlessly.
5. **Custom Payloads / Headers (JSON)**:
   - **Webhooks/ntfy**: Custom headers (e.g. `{"Authorization": "Bearer token"}`).
   - **MQTT**: Custom state payloads mapped as `{"on": "C", "off": "A"}`. If omitted, defaults to `"C"` and `"A"`.
6. **Test Automation (ON)** (Button): Manually triggers the integration instantly from the backend with state `"on"` to verify that it executes successfully. Test logs are printed to the **Activity Console** at the bottom of the main dashboard.

---

## 3. Integration Recipes

### Recipe A: Home Assistant Webhook
This is a reliable way to wake up a Skoda Enyaq because Home Assistant handles session renewal and security checks natively.

1. In Home Assistant, create a new **Automation**:
   - **Trigger**: Webhook (select `GET` or `POST`, and assign a webhook ID, e.g. `ev_charging_tariff`).
   - **Action**: Use a template/choose condition to inspect the incoming trigger body payload `status`:
     - If `status == "on"`:
       1. Call service `climate.turn_on` on your vehicle's climatisation entity.
       2. Delay: `00:00:30` (30 seconds).
       3. Call service `climate.turn_off` on the same entity.
     - If `status == "off"`:
       - (Optional: Stop charging or send notification if needed, though cutting power to the socket contactor physically stops the session).
2. In the Lunagrid portal:
   - Set Type to **Webhook (HTTP POST on both transitions)**.
   - Set Target URL to: `http://<your-homeassistant-ip>:8123/api/webhook/ev_charging_tariff`.
3. Webhook Payloads sent:
   - **ON**: `{"event": "B_TARIFF_ON", "status": "on", "locationId": "...", "locationName": "...", "timestamp": 123456789}`
   - **OFF**: `{"event": "B_TARIFF_OFF", "status": "off", "locationId": "...", "locationName": "...", "timestamp": 123456789}`

---

### Recipe B: Local Shell Script Execution
If you prefer to run a custom local script (Python, Bash, Node.js, etc.) on grid tariff state changes:

1. **Create your script**:
   Write a script that executes the actions you want when the contactor switches. The backend will execute your script on both ON and OFF transitions, setting the environment variable `EV_STATE` to `"on"` or `"off"` dynamically.
   
   Example in Python (`tools/custom_trigger.py`):
   ```python
   import os
   import sys

   # The state is passed either as an environment variable or as a CLI argument
   state = os.environ.get("EV_STATE")  # "on" or "off"
   print(f"Received B-tariff state: {state}")
   
   if state == "on":
       # Put your ON transition logic here (e.g. starting charging/wakeups)
       pass
   elif state == "off":
       # Put your OFF transition logic here (e.g. suspending charging)
       pass
   ```

2. **Configure the Lunagrid Portal**:
   - Navigate to the **Locations & Devices** tab.
   - Under your location's **EV Charging Automation** panel, select Type: **Local Shell Script / CLI**.
   - Set **Script Command** to the shell command required to run your script, using the optional `{state}` placeholder if you want to pass it as an argument:
     ```bash
     python3 tools/custom_trigger.py {state}
     ```
     *Note: The backend replaces any `{state}` placeholder in the command string with `"on"` or `"off"` dynamically, and sets `EV_STATE` and `LUNAGRID_STATE` environment variables in the execution context.*

---

### Recipe C: EVCC (Electric Vehicle Charge Controller) Integration
If you manage vehicle charging using EVCC, you can configure it to follow the grid contactor status automatically using the MQTT status monitoring flow.

1. **Configure the Lunagrid Portal**:
   - Navigate to the **Locations & Devices** tab.
   - Under your location card's **EV Charging Automation** panel, select Type: **MQTT Message Broker**.
   - Set **MQTT Status Topic** to: `evcc/charger/status`.
   - Optional: Set **Custom MQTT Payloads** to custom JSON mapping (e.g., `{"on": "C", "off": "A"}`). Defaults to `"C"` and `"A"`.

2. **How it works**:
   - **Contactor State Monitoring**: When B-tariff grid power turns ON/OFF, Lunagrid publishes the observed state (typically `"C"` for ON, `"A"` for OFF) to the MQTT topic `evcc/charger/status`.
   - **State Emulation & Control**: EVCC subscribes to this topic. Using the custom Javascript state machine configured on `my_charger` in [evcc.yaml](../infrastructure/evcc/evcc.yaml), it translates the contactor state into the passive charger status:
     - If B-tariff is OFF (contactor de-energized), the status is mapped to `'A'` (disconnected / standby).
     - If B-tariff turns ON, the status transitions to `'B'` (connected / waiting).
     - When EVCC enables charging (`enable: true`), the charger waits for **90 seconds** before transitioning from `'B'` to `'C'` (charging). This delay allows EVCC's `wakeUpTimer` to expire and trigger an API-based wake-up call to the vehicle (e.g. Skoda Enyaq) and prevents premature charging state transitions.
   - For complete configuration details, refer to the [EVCC Integration & Setup Guide](evcc_integration.md).
