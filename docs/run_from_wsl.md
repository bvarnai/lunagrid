### Step 1: Start the Infrastructure Services (Docker)

In your WSL2 Ubuntu terminal, spin up the MQTT broker, InfluxDB, Telegraf, Grafana, and backend Express container:

```
  cd infrastructure
  docker compose up -d
```

Verify that all containers are online by running docker ps.
---
### Step 2: Launch the Web Dashboard

Open a new WSL2 terminal (or run in background) to build and launch the Vite development server:

```
  cd frontend
  npm install
  npm run dev -- --host
```

│ [!TIP]
│ The -- --host flag binds Vite to 0.0.0.0, ensuring the dev server routes correctly from WSL to your Windows web browser at
│ http://localhost:5173/.
---
### Step 3: Run the Telemetry Simulator

Open a new WSL2 terminal and start the mock edge sensor node to publish active B-tariff signals to the MQTT broker:

```
  cd backend
  npm install
  npm run simulate -- --id lunagrid_c3_simulated --interval 2 --broker mqtt://localhost:1883
```
---
### Step 4: Verification Check

1. Open http://localhost:5173/ in your browser.
2. In the Source Settings tab, click Test Connection to verify backend visibility (Connection Successful! API Version: 1.0.
0).
3. Return to the Dashboard tab. Click the yellow Configure Device banner to register the lunagrid_c3_simulated node and
assign it to a location.
4. Go to Settings and check Enable Diagnostic Console Logs to verify that telemetry packets are streaming in real time.
5. (Optional) Access the pre-provisioned Grafana portal at http://localhost:3001/ (Login: admin / admin).