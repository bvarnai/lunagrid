# Project Lunagrid

[![Lunagrid CI](https://github.com/bvarnai/lunagrid/actions/workflows/ci.yml/badge.svg)](https://github.com/bvarnai/lunagrid/actions)

A low-cost, safety-first, end-user IoT device designed to monitor grid power status and log the active windows of the switched controlled tariff ("éjszakai áram") in Hungary.

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
- **[Project Plan & Specification](file:///c:/Users/bvarnai/workspace/lunagrid/docs/lunagrid_project_plan.md):** Complete specifications including the hardware contactor wiring and cloud architecture.
- **[Firmware Development Guide](file:///c:/Users/bvarnai/workspace/lunagrid/docs/firmware_development.md):** Environment setups, WSL2 port authorization, and PlatformIO flashing commands.
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
