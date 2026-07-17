# EVCC Integration & Setup Guide

This guide explains how to integrate **EVCC (Electric Vehicle Charge Controller)** with Project Lunagrid. EVCC acts as the primary coordinator between your local charging station (wallbox) and your electric vehicle (e.g. Skoda Enyaq), while Lunagrid provides the real-time grid B-tariff (off-peak) status triggers to coordinate charging windows.

---

## 1. Overview of the Setup

```
[ Contactor Power ]
       │ (B-tariff ON/OFF)
       ▼
 ┌───────────┐      MQTT      ┌──────────────┐    Webhook     ┌────────┐    MySkoda API    ┌─────────────┐
 │ ESP32 Node│ ─────────────> │ Lunagrid API │ ─────────────> │  EVCC  │ ────────────────> │ Skoda Cloud │
 └───────────┘                └──────────────┘                └────────┘                   └─────────────┘
                                                                  │                               │
                                                                  ▼ (AC Pilot)                    ▼ (Wake Command)
                                                             ┌──────────┐                    ┌───────────┐
                                                             │ Dumb/HV  │ ────────────────── │   EV      │
                                                             │ Charger  │ (Plugged in)       │ (Enyaq)   │
                                                             └──────────┘                    └───────────┘
```

When B-tariff switches to ON, Lunagrid detects the transition and dispatches a webhook to EVCC's API. EVCC receives this, authenticates with the Skoda servers, and sends a wake-up command over the cellular e-SIM, closing the car's high-voltage contactor to begin charging.

---

## 2. EVCC Configuration (`evcc.yaml`)

To support a permanently connected non-smart ("dumb") charger alongside your Skoda Enyaq, configure a **`dummy` charger** and a Skoda vehicle template in your EVCC configuration.

### Example `evcc.yaml`:
```yaml
# EVCC Configuration File

network:
  schema: http
  host: 0.0.0.0
  port: 7070

# Define your charger station
chargers:
  - name: my_dumb_charger
    type: dummy # <-- Essential for chargers without built-in smart control API

# Define your vehicle connection
vehicles:
  - name: my_enyaq
    type: skoda
    title: Skoda Enyaq
    # Email and password used for the MySkoda mobile app
    user: "your_skoda_account_email@gmail.com"
    password: "your_skoda_password"
    vin: "TMBJB7NY8NF024802" # Replace with your actual VIN
    capacity: 82             # Battery pack size in kWh
    phases: 3

# Define the charging loadpoint (binds vehicle and charger together)
loadpoints:
  - title: Garage Charging Station
    charger: my_dumb_charger
    vehicle: my_enyaq
    mode: off # Modes: off, pv (solar surplus), minpv, now (full speed)
    phases: 3
    mincurrent: 6
    maxcurrent: 16
```

### Explanation of the Dummy Charger:
* When `type: dummy` is selected, EVCC does not communicate with the physical charger station.
* Instead, it reads the charging status (connected, charging, battery SoC) directly from your vehicle's cloud API.
* This is a highly robust solution for dumb chargers because the car remains in control.

---

## 3. Lunagrid Portal Webhook Setup

Once EVCC is running on your local network (e.g. at `http://192.168.1.50:7070`), configure the webhook in the Lunagrid portal to trigger EVCC's wake endpoint.

1. Open the Lunagrid portal and navigate to the **Locations & Devices** tab.
2. Under your location card, locate the **EV Wake-up Integration** panel.
3. Check the **Enabled** box.
4. Set the **Wake-up Type** to `Webhook (HTTP POST)`.
5. In the **Webhook Endpoint URL** field, enter:
   ```http
   http://evcc:7070/api/charge/1/wake
   ```
   *(Note: Since both `lunagrid-backend` and `evcc` are running in the same Docker Compose network bridge on your NAS, you can use the container name `evcc` directly. If you are running them on different machines, replace `evcc` with your server's local IP address).*
6. Click **Test Wake-up** to verify the webhook dispatch. The Activity Console logs should register a `200 OK` response.

---

## 4. Advanced & Future Improvements: Deep Integration

As a future expansion, Lunagrid can establish a bidirectional integration with EVCC to serve as your primary home charging coordinator:

### 1. Automated Charging Mode Scheduling
Instead of just sending a wake-up command, the Lunagrid backend can dynamically toggle EVCC's operational mode via webhooks when tariff periods shift:
* **B-Tariff ON (Off-Peak)**: Set EVCC mode to `now` (charges at full speed using cheap grid electricity) by posting to `/api/charge/1/mode/now`.
* **B-Tariff OFF (On-Peak)**: Set EVCC mode to `off` (suspends grid charging) or `pv` (charges only from solar surplus) by posting to `/api/charge/1/mode/off`.

### 2. Consolidated Telemetry & Cost Dashboards
By polling EVCC's state endpoint (`GET http://<evcc-ip>:7070/api/state`), Lunagrid can extract charge session statistics (such as energy added in kWh, current SoC, and solar/grid share) and store them in InfluxDB. This allows you to generate advanced Grafana dashboards detailing your exact electricity cost savings.
