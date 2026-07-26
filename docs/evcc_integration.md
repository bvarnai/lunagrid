# EVCC Integration & Setup Guide

This guide explains how to integrate **EVCC (Electric Vehicle Charge Controller)** with Project Lunagrid. 

In this setup, EVCC acts as the energy management and smart charging controller for a switchless/passive charger (e.g., a **Rheidon PC200-3K6** single-phase charger) and a **Škoda Enyaq** (60 kWh battery). 

There are two supported integration approaches:
1. **MQTT-Based Push Integration (Recommended)**: Lunagrid automatically publishes charger status (`"C"` or `"A"`) to the MQTT broker on state transitions, and EVCC reacts instantly.
2. **HTTP-Polling-Based Pull Integration (Legacy)**: EVCC polls the Lunagrid backend REST API endpoint periodically to check the state.

---

## 1. MQTT-Based Push Integration (Recommended)

In this flow, EVCC acts as a passive monitor following the state of the physical socket/contactor managed by the User/App (B-tariff grid state).

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
                                                                             │ Rheidon  │ ────────────────── │   EV      │
                                                                             │ Charger  │ (Plugged in)       │ (Enyaq)   │
                                                                             └──────────┘                    └───────────┘
```

### How it Works
1. **Status Update:** The **User/App** decides when charging is allowed based on B-tariff. When B-tariff goes ON/OFF, the backend publishes the observed state (`"C"` or `"A"`) to the MQTT topic configured under EV Wake-up settings.
2. **EVCC Status Monitor:** EVCC reads the status, automatically registers the vehicle connection/disconnection, and starts/stops the charging session.
3. **Power Calculation:** Since the dumb charger has no physical power meter, EVCC calculates power draw in Javascript based on the status: returning `3680 W` (16A at 230V) when charging (status `"C"`), and `0 W` when standby (status `"A"`).

### EVCC Configuration (`evcc.yaml`)
```yaml
mqtt:
  broker: lunagrid-mosquitto:1883

chargers:
  - name: rheidon_pc200_3k6
    type: custom
    status:
      source: mqtt
      topic: evcc/charger/status
    enabled:
      source: const
      value: "true"
    enable:
      source: js
      script:
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
            source: mqtt
            topic: evcc/charger/status
```

---

## 2. HTTP-Polling-Based Pull Integration (Legacy)

In this legacy setup, EVCC queries the Lunagrid backend REST API directly.

### How it Works
1. **contactor state -> EVCC Status:** Lunagrid publishes the grid contactor state to MQTT. The backend caches this telemetry.
2. **HTTP Polling:** EVCC polls the Lunagrid backend REST API endpoint `/api/locations/<location-id>/telemetry`.
3. **Charger State Mapping:** 
   - When B-tariff is OFF, status is `A` (disconnected).
   - When B-tariff turns ON, status transitions to `B` (connected/ready).
4. **Native Vehicle Wakeup:** Upon status transition to `B`, EVCC starts the loadpoint charge session and automatically triggers its native wakeup routine using the Škoda Cloud API to wake the vehicle.

### EVCC Configuration (`evcc.yaml`)
```yaml
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
```

---

## 3. Running EVCC in Docker Compose

The `infrastructure/docker-compose.yml` file includes the `evcc` service. Spin up the entire infrastructure using:

```bash
cd infrastructure
docker compose up -d
```

The EVCC web dashboard will be available at `http://<your-server-ip>:7070`.
