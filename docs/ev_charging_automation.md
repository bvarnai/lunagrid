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
3. **Car Away Toggle & Daily Automatic Schedule**:
   - Located in the **Car Away** panel on the **Dashboard**.
   - Supports both **Manual Override** toggle and a **Daily Automatic Schedule** (`From` - `To` time window, e.g. `08:00` - `17:00`).
   - When active (via manual toggle or automatically during the scheduled window), B-tariff state transition notifications and wakeups are silenced. Turning it OFF resumes notifications. Manual test triggers remain available anytime.
4. **Custom Payloads / Headers (JSON)**:
   - **Webhooks/ntfy**: Custom headers (e.g. `{"Authorization": "Bearer token"}`).
   - **MQTT**: Custom state payloads mapped as `{"on": "C", "off": "A"}`. If omitted, defaults to `"C"` and `"A"`.
5. **Test Automation (ON)** (Button): Manually triggers the integration instantly from the backend with state `"on"` to verify that it executes successfully. Test logs are printed to the **Activity Console** at the bottom of the main dashboard.

---

## 3. Integration Recipes

### Recipe A: Home Assistant Webhook (Recommended)
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

### Recipe C: EVCC (Electric Vehicle Charge Controller) HTTP Polling (Alternative)
If you use EVCC to manage charging, you can configure it to query the Lunagrid backend REST API directly. This provides a pull-based integration.

1. **How EVCC handles status**:
   EVCC polls the Lunagrid `/telemetry` endpoint. When the B-tariff turns ON, EVCC detects that the charger state has transitioned from `A` (disconnected) to `B` (connected).
2. **How EVCC handles wake-up**:
   Because the loadpoint is configured in `now` mode and the vehicle is connected but asleep, EVCC natively triggers its built-in Škoda API wakeup sequence to wake the Enyaq and begin charging.
3. **No Webhook Required**:
   In this unified HTTP polling configuration, you do not need to configure any webhooks or local wakeup scripts in the Lunagrid web portal. EVCC manages the entire state machine on its own.

---

### Recipe D: EVCC (Electric Vehicle Charge Controller) Webhook Trigger (Alternative)
If you prefer a push-based wakeup trigger and configure EVCC's charger with static values, you can use the Lunagrid portal's webhook to hit EVCC's wake endpoint.

1. **How EVCC is configured:** In `/etc/evcc.yaml`, the custom charger uses static values (status `B`, enabled `true`). EVCC assumes the charger is permanently connected.
2. **Configure the Lunagrid portal:**
   - Navigate to the **Locations & Devices** tab.
   - Under your location card's **EV Charging Automation** panel, select Type: **Webhook (HTTP POST)**.
   - Set Target URL to: `http://evcc:7070/api/charge/1/wake` (or use the host IP).
3. **How it works:** When B-tariff turns ON, Lunagrid dispatches a webhook POST to EVCC's `/wake` endpoint. EVCC receives this and triggers the vehicle wakeup call via the Škoda API, starting the charge session since B-tariff grid power is now physically present.

---

### Recipe E: EVCC (Electric Vehicle Charge Controller) MQTT Integration (Highly Recommended)
If you run EVCC with the MQTT status monitoring flow, you can configure Lunagrid to push the charger state changes directly to your broker.

1. **Configure the Lunagrid portal:**
   - Navigate to the **Locations & Devices** tab.
   - Under your location card's **EV Charging Automation** panel, select Type: **MQTT Message Broker**.
   - Set **MQTT Status Topic** to: `evcc/charger/status` (or your custom topic).
   - Optional: Set **Custom MQTT Payloads** to custom JSON (e.g. `{"on": "C", "off": "A"}`). Defaults to `"C"` and `"A"`.
2. **How it works:**
   - When B-tariff turns ON, Lunagrid publishes `"C"` (or your custom `"on"` payload) to the topic.
   - When B-tariff turns OFF, Lunagrid publishes `"A"` (or your custom `"off"` payload) to the topic.
   - EVCC subscribes to this topic. If you use the JS-based charger configuration (described in the [EVCC Integration & Setup Guide](evcc_integration.md)), EVCC transitions the charger status to `"A"` (standby) when B-tariff is OFF, and to `"B"` (connected) when B-tariff is ON. When EVCC enables charging, it simulates a 45-second delay before transitioning to `"C"` (charging) to wake up the vehicle and avoid immediate charging faults.

---

## 4. Troubleshooting & CSRF Errors

If your manual test or automation fails with `myskoda.auth.authorization.CSRFError`:
- **Incorrect Password**: Double-check your login credentials. If you run the Python script from the terminal, make sure to wrap passwords containing special characters (like wildcards `*` or `$`) in **single quotes** (`'your_password*'`) to prevent shell expansion.
- **MFA/2FA or CAPTCHA**: Skoda's identity portal (VW Group ID) blocks automated logins if it flags your server's IP address or if you have 2FA enabled. Try logging in via an incognito browser window on the same machine to see if you get a CAPTCHA. If so, using the **Home Assistant Webhook** option is recommended.
- **Pending Agreements**: Log in to the official MySkoda mobile app on your phone and accept any new Terms of Service or marketing consent popups.
