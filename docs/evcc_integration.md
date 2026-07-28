# EVCC Integration & Setup Guide

This guide explains how to integrate **EVCC (Electric Vehicle Charge Controller)** with Project Lunagrid. 

In this setup, EVCC acts as the energy management and smart charging controller for a switchless/passive charger (represented in EVCC as `my_charger` with a 3.6 kW charging limit) and a **Škoda Enyaq** (60 kWh battery, configured as `my_vehicle`). 

There are two supported integration approaches:
1. **MQTT-Based Push Integration (Recommended)**: Lunagrid automatically publishes charger status to the MQTT broker on state transitions, and EVCC reacts instantly.
2. **HTTP-Polling-Based Pull Integration (Legacy)**: EVCC polls the Lunagrid backend REST API endpoint periodically to check the state.

---

## 1. MQTT-Based Push Integration (Recommended)

In this flow, EVCC acts as a smart controller following the state of the physical socket/contactor managed by the User/App (B-tariff grid state).

### Flow Diagram
```
[ Contactor Power ]
       │ (B-tariff ON/OFF state transition)
       ▼
 ┌───────────┐      MQTT (State Change)      ┌──────────────┐                 ┌────────┘    MySkoda API    ┌─────────────┐
 │ ESP32 Node│ ────────────────────────────> │ Lunagrid API │ ──────────────> │  EVCC  │ ────────────────> │ Skoda Cloud │
 └───────────┘                               └──────────────┘                 └────────┘                   └─────────────┘
                                                                                  │                               │
                                                                                  ▼ (AC Pilot)                    ▼ (Wake Command)
                                                                             ┌──────────┐                    ┌───────────┐
                                                                             │  Charger │ ────────────────── │   EV      │
                                                                             │(my_charger) (Plugged in)      │ (Enyaq)   │
                                                                             └──────────┘                    └───────────┘
```

### How it Works
1. **Status Update:** The **User/App** decides when charging is allowed based on the B-tariff state. When B-tariff goes ON/OFF, the backend publishes the state (typically `"C"` for ON, `"A"` for OFF) to the MQTT topic `evcc/charger/status`.
2. **State Emulation via JavaScript:**
   - **Offline/Standby:** If `mqttStatus` is `'A'`, `'off'`, `'OFF'`, or `'0'`, the charger returns status `'A'` (disconnected / standby).
   - **Connected & Ready:** If `mqttStatus` is active (e.g. `'C'` or `'on'`) but charging is not yet enabled by EVCC (`enabledState` is false), the charger returns status `'B'` (connected).
   - **Delayed Charging State Transition:** Once EVCC enables the loadpoint (`enable: true`), the charger transitions from `'B'` (connected) to `'C'` (charging) after a **45-second delay** (tracked via `enableTime` inside the JS VM `my_charger`). This delay emulates the physical vehicle preparation/negotiation time, allowing the vehicle to wake up smoothly and preventing immediate charging faults.
3. **Power Calculation:** Since the dumb charger has no physical power meter, EVCC calculates power draw in JavaScript using the emulated state. It returns `3680 W` (16A at 230V) when charging (status is `'C'`), and `0 W` otherwise.

### EVCC Configuration (`evcc.yaml`)
```yaml
# EVCC Configuration File
# Documentation: https://docs.evcc.io/en/

network:
  schema: http
  host: 0.0.0.0
  port: 7070
  externalUrl: https://nas48.vbl.hu/evcc

mqtt:
  broker: lunagrid-mosquitto:1883

chargers:
  - name: my_charger
    type: custom
    status:
      source: js
      vm: my_charger
      script: |
        if (mqttStatus === 'A' || mqttStatus === 'off' || mqttStatus === 'OFF' || mqttStatus === '0') {
          'A';
        } else if (typeof enabledState !== 'undefined' && enabledState) {
          var elapsed = (new Date().getTime() - (typeof enableTime !== 'undefined' ? enableTime : 0)) / 1000;
          elapsed < 45 ? 'B' : 'C';
        } else {
          'B';
        }
      in:
        - name: mqttStatus
          type: string
          config:
            source: mqtt
            topic: evcc/charger/status
            timeout: 24h
    enabled:
      source: js
      vm: my_charger
      script: "typeof enabledState === 'undefined' ? false : enabledState"
    enable:
      source: js
      vm: my_charger
      script: |
        enabledState = enable;
        if (enable) {
          enableTime = new Date().getTime();
        }
    maxcurrent:
      source: js
      script:
    power:
      source: js
      script: "status === 'C' ? 3680 : 0"
      in:
        - name: status
          type: string
          config:
            source: js
            vm: my_charger
            script: |
              if (typeof enabledState !== 'undefined' && enabledState) {
                var elapsed = (new Date().getTime() - (typeof enableTime !== 'undefined' ? enableTime : 0)) / 1000;
                elapsed < 45 ? 'B' : 'C';
              } else {
                'B';
              }

# Define your vehicle connection
vehicles:
  - name: my_vehicle
    type: skoda
    title: Skoda Enyaq
    user: "bvarnai@gmail.com"
    password: "pkg_nyk3ZNH3uwk*dgk"
    vin: "TMBJB7NY8NF024802"
    capacity: 60

site:
  title: Home

loadpoints:
  - name: my_carport
    title: EV Charging Socket
    charger: my_charger
    vehicle: my_vehicle
    mode: now
```

---

## 2. HTTP-Polling-Based Pull Integration (Legacy)

In this legacy setup, EVCC queries the Lunagrid backend REST API directly.

### How it Works
1. **Contactor state -> EVCC Status:** Lunagrid publishes the grid contactor state to MQTT. The backend caches this telemetry.
2. **HTTP Polling:** EVCC polls the Lunagrid backend REST API endpoint `/api/locations/<location-id>/telemetry`.
3. **Charger State Mapping:** 
   - When B-tariff is OFF, status is `A` (disconnected).
   - When B-tariff turns ON, status transitions to `B` (connected/ready).
4. **Native Vehicle Wakeup:** Upon status transition to `B`, EVCC starts the loadpoint charge session and automatically triggers its native wakeup routine using the Škoda Cloud API to wake the vehicle.

### EVCC Configuration (`evcc.yaml`)
```yaml
chargers:
  - name: my_charger
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
```

---

## 3. Running EVCC in Docker Compose

The `infrastructure/docker-compose.yml` file includes the `evcc` service. Spin up the entire infrastructure using:

```bash
cd infrastructure
docker compose up -d
```

The EVCC web dashboard will be available at `http://<your-server-ip>:7070`.
