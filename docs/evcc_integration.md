# EVCC Integration & Setup Guide

This guide explains how to integrate **EVCC (Electric Vehicle Charge Controller)** with Project Lunagrid. 

In this setup, EVCC acts as the energy management and smart charging controller for a switchless/passive charger (represented in EVCC as `my_charger` with a 3.6 kW charging limit) and a **Škoda Enyaq** (60 kWh battery, configured as `my_vehicle`). 

The integration uses an **MQTT-Based Push Integration** where Lunagrid automatically publishes the charger status to the MQTT broker on grid state transitions, and EVCC reacts instantly.

---

## 1. MQTT-Based Push Integration

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
   - **Delayed Charging State Transition:** Once EVCC enables the loadpoint (`enable: true`), the charger transitions from `'B'` (connected) to `'C'` (charging) after a **90-second delay** (tracked via `enableTime` inside the JS VM `my_charger`). This delay keeps the charger in status `'B'` with `0W` long enough for EVCC's internal `wakeUpTimer` to expire and trigger an API-based vehicle wake-up call to the Škoda Connect API, while preventing false-positive early charging states.
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
          elapsed < 90 ? 'B' : 'C';
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
                elapsed < 90 ? 'B' : 'C';
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

## 2. Running EVCC in Docker Compose

The `infrastructure/docker-compose.yml` file includes the `evcc` service. Spin up the entire infrastructure using:

```bash
cd infrastructure
docker compose up -d
```

The EVCC web dashboard will be available at `http://<your-server-ip>:7070`.
