# EV Wake-up Integration Guide

This guide explains how to configure and use the **EV Wake-up Integration** in Project Lunagrid. This feature allows you to automatically wake up your electric vehicle (e.g., a Skoda Enyaq) when the B-tariff switches to ON (Active/Off-Peak), ensuring the vehicle charges during cheap tariff hours even if it has gone into a deep sleep.

---

## 1. How It Works

1. The Lunagrid ESP32-C3 node detects that B-tariff power is active and publishes a `state` message containing `grid_active: true` to the MQTT broker.
2. The Lunagrid backend server ingests this state message.
3. If the **EV Wake-up Integration** is enabled for the associated location, the backend automatically triggers the configured action:
   * **Webhook (HTTP POST)**: Sends a POST request to a remote home automation platform (like Home Assistant or EVCC) to trigger the wake-up.
   * **Local Script / CLI Command**: Executes a shell script directly on the backend server (e.g. running the provided Python script `tools/wake_enyaq.py`).
4. Once triggered, the target service sends a command to the vehicle (e.g., starting climatisation for 30 seconds), which closes the vehicle's high-voltage contactor, wakes up its charging module, and allows it to detect the AC pilot signal from your charger.

---

## 2. Configuration Options in the Web Portal

Under the **Locations & Devices** tab, each location card exposes an **EV Wake-up Integration** panel:

1. **Enabled** (Checkbox): Toggles the integration on or off.
2. **Wake-up Type**:
   * **Webhook (HTTP POST)**: Dispatches a HTTP POST request.
   * **Local Shell Script / CLI**: Runs a local CLI command or script on the server.
3. **Target URL or Command**:
   * For Webhooks, enter the endpoint URL.
   * For scripts, enter the executable command path (e.g., `tools/.venv/bin/python tools/wake_enyaq.py`).
4. **Custom HTTP Headers (JSON)**:
   * (Webhook type only) Allows you to pass authorization headers, for example:
     ```json
     {
       "Authorization": "Bearer YOUR_LONG_LIVED_ACCESS_TOKEN"
     }
     ```
5. **Test Wake-up** (Button): Manually triggers the integration instantly from the backend to verify that it executes successfully. Test logs are printed to the **Activity Console** at the bottom of the main dashboard.

---

## 3. Integration Recipes

### Recipe A: Home Assistant Webhook (Recommended)
This is the most reliable way to wake up a Skoda Enyaq because Home Assistant handles session renewal and security checks natively.

1. In Home Assistant, create a new **Automation**:
   * **Trigger**: Webhook (select `GET` or `POST`, and assign a webhook ID, e.g. `wake_enyaq_tariff`).
   * **Action**:
     1. Call service `climate.turn_on` on your vehicle's climatisation entity.
     2. Delay: `00:00:30` (30 seconds).
     3. Call service `climate.turn_off` on the same entity.
2. In the Lunagrid portal:
   * Set Type to **Webhook (HTTP POST)**.
   * Set Target URL to: `http://<your-homeassistant-ip>:8123/api/webhook/wake_enyaq_tariff`.

---

### Recipe B: Local Python script (`tools/wake_enyaq.py`)
If you prefer a standalone script that connects directly to the Skoda Connect API without Home Assistant:

1. **Setup the Virtual Environment** in the project directory to isolate dependencies:
   ```bash
   python3 -m venv tools/.venv
   source tools/.venv/bin/activate
   pip install --upgrade pip
   pip install myskoda aiohttp
   ```
2. **Configure your credentials**:
   Open `tools/wake_enyaq.py` and input your email, password, and vehicle VIN, or set them as environment variables:
   ```bash
   export SKODA_EMAIL="your_account_email"
   export SKODA_PASSWORD="your_password"
   export VEHICLE_VIN="your_vin"
   ```
3. **Configure the Lunagrid Portal**:
   * Set Type to **Local Shell Script / CLI**.
   * Set Target Command to:
     ```bash
     tools/.venv/bin/python tools/wake_enyaq.py
     ```
     *(This runs the script using the virtual environment's Python interpreter directly, avoiding any global package conflicts).*

---

## 4. Troubleshooting & CSRF Errors

If your manual test or automation fails with `myskoda.auth.authorization.CSRFError`:
* **Incorrect Password**: Double-check your login credentials. If you run the Python script from the terminal, make sure to wrap passwords containing special characters (like wildcards `*` or `$`) in **single quotes** (`'your_password*'`) to prevent shell expansion.
* **MFA/2FA or CAPTCHA**: Skoda's identity portal (VW Group ID) blocks automated logins if it flags your server's IP address or if you have 2FA enabled. Try logging in via an incognito browser window on the same machine to see if you get a CAPTCHA. If so, using the **Home Assistant Webhook** option is recommended.
* **Pending Agreements**: Log in to the official MySkoda mobile app on your phone and accept any new Terms of Service or marketing consent popups.
