# EVCC Integration & Setup Guide

This guide explains how to integrate **EVCC (Electric Vehicle Charge Controller)** with Project Lunagrid. 

In this setup, EVCC acts as the smart charging controller for a switchless/passive charger (e.g., a **Rheidon PC200-3K6** single-phase charger) and a **Škoda Enyaq** (60 kWh battery). Instead of complex scripts or manual webhooks, EVCC queries the Lunagrid Backend REST API directly via HTTP polling to monitor B-tariff grid status and natively wake up the vehicle.

---

## 1. Overview of the Setup

```
[ Contactor Power ]
       │ (B-tariff ON/OFF)
       ▼
 ┌───────────┐      MQTT      ┌──────────────┐                 ┌────────┐    MySkoda API    ┌─────────────┐
 │ ESP32 Node│ ─────────────> │ Lunagrid API │ <────────────── │  EVCC  │ ────────────────> │ Skoda Cloud │
 └───────────┘                └──────────────┘ (HTTP Polling)  └────────┘                   └─────────────┘
                                                                   │                               │
                                                                   ▼ (AC Pilot)                    ▼ (Wake Command)
                                                              ┌──────────┐                    ┌───────────┐
                                                              │ Rheidon  │ ────────────────── │   EV      │
                                                              │ Charger  │ (Plugged in)       │ (Enyaq)   │
                                                              └──────────┘                    └───────────┘
```

1. **contactor state -> EVCC Status:** Lunagrid publishes the grid contactor state to MQTT. The backend caches this telemetry.
2. **HTTP Polling:** EVCC polls the Lunagrid backend REST API endpoint `/api/locations/<location-id>/telemetry`.
3. **Charger State Mapping:** 
   - When B-tariff is OFF, status is `A` (disconnected).
   - When B-tariff turns ON, status transitions to `B` (connected/ready).
4. **Native Vehicle Wakeup:** Upon status transition to `B`, EVCC starts the loadpoint charge session and automatically triggers its native wakeup routine using the Škoda Cloud API to wake the vehicle.

---

## 2. EVCC Configuration (`evcc.yaml`)

Configure your custom charger to poll the Lunagrid backend and set up the Škoda vehicle template in `/etc/evcc.yaml`:

```yaml
# /etc/evcc.yaml
network:
  schema: http
  host: 0.0.0.0
  port: 7070

chargers:
  - name: rheidon_pc200_3k6
    type: custom
    features:
      - switchdevice # Tells EVCC that this is an on/off switchless charger
    status:
      source: http
      uri: http://lunagrid-backend:3000/api/locations/budapest-home-1/telemetry # Replace with your location ID
      jq: if .gridActive then "B" else "A" end
    enabled:
      source: http
      uri: http://lunagrid-backend:3000/api/locations/budapest-home-1/telemetry
      jq: .gridActive
    enable:
      source: script
      cmd: /bin/true # No-op command required by EVCC for custom chargers
    maxcurrent:
      source: const
      value: 16 # Fixed hardware limit of the Rheidon charger

vehicles:
  - name: my_enyaq
    type: template
    template: skoda
    title: Skoda Enyaq
    user: "your_skoda_email@gmail.com"
    password: "your_skoda_password"
    vin: "TMBJB7NY8NFXXXXXX" # Replace with your vehicle's VIN
    capacity: 60             # 60 kWh battery pack
    phases: 1                # Single phase charging

loadpoints:
  - title: Garage Socket (B-Tariff)
    charger: rheidon_pc200_3k6
    vehicle: my_enyaq
    mode: now # Set to now so EVCC charges whenever B-tariff is active
    phases: 1
    mincurrent: 6
    maxcurrent: 16
```

### Explanation of Configuration:
* **`type: custom`**: Since there is no native "dummy" charger type in official EVCC, we define a user-defined custom charger.
* **`enabled` & `status`**: We poll the Lunagrid telemetry API. When B-tariff is active (`.gridActive` is true), the charger status becomes `B` (connected) and enabled is `true`, prompting EVCC to start charging. When B-tariff is OFF, the charger transitions to `A` (disconnected) and `enabled: false`, completing the session cleanly.
* **`enable: /bin/true`**: A mandatory no-op script because EVCC requires a write command for `enable` in custom chargers, though physical control is dictated by B-tariff grid contactors.
* **Automatic Cutoff:** Since the Skoda Enyaq has its battery balance mode permanently enabled, it will stop charging at 80% automatically by default, eliminating any safety concerns from the switchless charger.

---

## 3. Running EVCC in Docker Compose

The `infrastructure/docker-compose.yml` file includes the `evcc` service. Spin up the entire infrastructure using:

```bash
cd infrastructure
docker compose up -d
```

The EVCC web dashboard will be available at `http://<your-server-ip>:7070`.
