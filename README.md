# Project Lunagrid

[![Lunagrid CI](https://github.com/bvarnai/lunagrid/actions/workflows/ci.yml/badge.svg)](https://github.com/bvarnai/lunagrid/actions)

A low-cost, end-user IoT device designed to monitor grid power status and log the active windows of the switched controlled tariff ("éjszakai áram" or "B-tarifa") in Hungary.

---

## ⚠️ DANGER: HIGH VOLTAGE WARNING & DISCLAIMER

> [!CAUTION]
> **RISK OF ELECTROCUTION, ELECTRICAL BURNS, AND FIRE**
>
> This project involves interfacing with **230V AC mains voltage**. Physical contact with mains electricity can cause severe injury, permanent disability, or **death**.
>
> * **Professional Installation Required:** All connections to mains lines (both the switched B-tariff grid line and the always-on A-tariff supply) and installation of physical components within an electrical panel board **must be performed by a qualified, licensed electrician** (e.g., *regisztrált villanyszerelő* in Hungary). Do not attempt to wire or install these components yourself.
> * **Galvanic Isolation Failure Risk:** Although this design utilizes a contactor (Iskra IKA20-11) for galvanic isolation, isolation can fail due to surges, component defects, or thermal breakdown. Always verify isolation and treat all parts of the device as potentially live.
> * **Overcurrent & Fire Hazard:** A short circuit or coil fault in the contactor can cause overheating or fire. A low-amperage, fast-acting in-line fuse (e.g., 500mA or 1A) **must** be wired in series with the contactor coil to protect the circuit.
> * **No Liability:** The creators and maintainers of this project accept no responsibility or liability for any personal injury, loss of life, or property damage resulting from building, testing, or deploying this hardware.
>
> **For a detailed assessment of all electrical failure modes, wiring mitigations, and firmware bugs, refer to the [Electrical Safety & Technical Risk Review](file:///home/bvarnai/workspace/lunagrid/docs/electrical_safety_review.md).**

---

## 1. Monorepo Directory Index

This project is structured as a monorepo containing all software layers, physical models, configurations, and deployment tooling:

- **[firmware/](file:///c:/Users/bvarnai/workspace/lunagrid/firmware/):** C++ PlatformIO core codebase for the ESP32-C3-SuperMini edge sensor node.
- **[backend/](file:///c:/Users/bvarnai/workspace/lunagrid/backend/):** Telemetry ingestion engine and Express-based Web APIs.
- **[frontend/](file:///c:/Users/bvarnai/workspace/lunagrid/frontend/):** Single-page React web dashboard built with Vite for viewing real-time telemetry.
- **[infrastructure/](file:///c:/Users/bvarnai/workspace/lunagrid/infrastructure/):** Docker Compose environment configs (Mosquitto MQTT, InfluxDB, Telegraf, Grafana).
- **[shared/](file:///c:/Users/bvarnai/workspace/lunagrid/shared/):** JSON schemas and type definitions shared across software layers.
- **[docs/](file:///c:/Users/bvarnai/workspace/lunagrid/docs/):** System plans, setup guides, and quickstart documentation.

---

## 2. Documentation Index

Explore our design and guide files:
- **[Electrical Safety & Risk Review](file:///home/bvarnai/workspace/lunagrid/docs/electrical_safety_review.md):** Critical engineering review of mains hazards, galvanic isolation failures, overcurrent protection, and code compliance.
- **[Project Plan & Specification](file:///home/bvarnai/workspace/lunagrid/docs/lunagrid_project_plan.md):** Complete specifications including the hardware contactor wiring and cloud architecture.
- **[Firmware Development Guide](file:///c:/Users/bvarnai/workspace/lunagrid/docs/firmware_development.md):** Environment setups, WSL2 port authorization, and PlatformIO flashing commands.
- **[Firmware Release & Rollout Guide](file:///c:/Users/bvarnai/workspace/lunagrid/docs/firmware_release_guide.md):** Step-by-step firmware build, Nginx hosting, portal registration, and remote update commands.
- **[EV Wake-up Integration Guide](file:///c:/Users/bvarnai/workspace/lunagrid/docs/ev_wakeup_integration.md):** Configuration steps for local scripts or Home Assistant webhooks to wake sleeping EVs.
- **[EVCC Integration & Setup Guide](file:///c:/Users/bvarnai/workspace/lunagrid/docs/evcc_integration.md):** Configuration templates for EVCC smart charging controller and dummy charger wallbox bindings.
- **[ESPHome USB Serial Quickstart](file:///c:/Users/bvarnai/workspace/lunagrid/docs/usb_serial_quickstart.md):** Standalone reference file for basic USB binding and ESPHome setup.

---

## 3. Quick Start Guide

### 3.1 Spin up the Infrastructure
Start Mosquitto MQTT, InfluxDB, Telegraf, Grafana, and the backend service container locally:
```bash
cd infrastructure
docker compose up -d
```

### 3.2 Run the Web Dashboard
Launch the Vite React development server locally on your host machine:
```bash
cd frontend
npm install
npm run dev
```

### 3.3 Compile and Upload Firmware
Refer to the [Firmware Development Guide](file:///c:/Users/bvarnai/workspace/lunagrid/docs/firmware_development.md) for setting up WSL2 USB passthrough, then compile and flash the firmware:
```bash
cd firmware
pio run --target upload
```

### 3.4 Simulate a Hardware Device
For testing without physical hardware, run the Node-based CLI simulator to publish mock telemetry and state transitions to the broker:
```bash
cd backend
npm run simulate -- --id lunagrid_c3_simulated --interval 5
```
You can customize the parameters (e.g., changing `--id` or setting `--active false`). Check `tools/simulate_device.js` for all available options.


## 🤖 AI Disclosure

![AI Assisted](https://img.shields.io/badge/AI-Assisted-blue?style=flat-square)

This project was developed with the assistance of AI tools (Gemini). All AI-generated code has been reviewed, tested, and manually refined.
