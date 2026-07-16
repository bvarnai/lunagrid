# Lunagrid Synology NAS Deployment Plan

This document outlines the step-by-step strategy for integrating the Lunagrid monitoring stack into the existing Synology NAS environment. The goal is to deploy the backend services using Docker Compose under the existing `backend` network, serve the compiled React frontend statically via the host Nginx server under the `/lunagrid` context path, and route API requests securely.

---

## 1. Architecture Overview

The target architecture utilizes the existing NAS services (Nginx, Grafana) to minimize resource consumption and integrate seamlessly with the existing domain layout (`https://nas48.vbl.hu`).

```mermaid
graph TD
    subgraph ESP32-C3 Node
        ESP[ESP32-C3 Node]
    end

    subgraph "Synology NAS (nas48.vbl.hu)"
        Nginx["Nginx (Host Network)]"
        MQTT["Mosquitto Broker (1883/9001)"]
        Influx["InfluxDB 2.7 (8086)"]
        Tele["Telegraf Ingestion"]
        Backend["Node.js Backend (3002)"]
        Grafana["Grafana (Existing, 3000)"]
    end

    %% Client/Browser Connections
    Browser[Web Browser] -->|HTTPS: /lunagrid/| Nginx
    Browser -->|HTTPS: /lunagrid/api/| Nginx
    
    %% Nginx Routing
    Nginx -->|Static File Read| Static[htdocs/lunagrid/]
    Nginx -->|Proxy Pass 127.0.0.1:3002| Backend
    
    %% ESP32 Telemetry
    ESP -->|MQTT: Port 1883| MQTT
    
    %% Telemetry pipeline
    MQTT -->|Subscribe| Tele
    Tele -->|Write| Influx
    
    %% Backend & Database
    Backend -->|Subscribe| MQTT
    Backend -->|Query Flux| Influx
    Backend -->|Read/Write| SQLite[(SQLite: lunagrid.db)]
    
    %% Existing Grafana Integration
    Grafana -->|Query Flux| Influx
```

---

## 2. Docker Compose Integration

We will append the Lunagrid services to your existing `~/infra/nodes/nas48/docker-compose.yml` file. All persistent data will be stored under `/volume1/storage/lunagrid/` to align with your storage scheme.

### 2.1 Node.js Dependency on NAS
**Important:** You do **not** need to install Node.js on the Synology NAS host system. The backend container compiles and runs Node.js internally inside an isolated environment using the `node:20-alpine` Docker base image. Only the Docker service itself needs to be running.

### 2.2 Service Definitions to Append

```yaml
  # MQTT Broker - Central message queue for device telemetry
  lunagrid-mosquitto:
    image: eclipse-mosquitto:2.0
    container_name: lunagrid-mosquitto
    ports:
      - "1883:1883"   # Exposed to local network for ESP32 connectivity
      - "9001:9001"   # Exposed to local network for WebSockets (optional)
    volumes:
      - ./etc/lunagrid/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
      - /volume1/storage/lunagrid/mosquitto/data:/mosquitto/data:rw
      - /volume1/storage/lunagrid/mosquitto/log:/mosquitto/log:rw
    networks:
      - backend
    restart: unless-stopped

  # Time-Series Database - Storing telemetry and grid transition logs
  influxdb:
    image: influxdb:2.7
    container_name: lunagrid-influxdb
    environment:
      - DOCKER_INFLUXDB_INIT_MODE=setup
      - DOCKER_INFLUXDB_INIT_USERNAME=admin
      - DOCKER_INFLUXDB_INIT_PASSWORD=lunagrid_secure_pass123
      - DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=lunagrid_secure_pass123
      - DOCKER_INFLUXDB_INIT_ORG=lunagrid-org
      - DOCKER_INFLUXDB_INIT_BUCKET=lunagrid-telemetry
      - DOCKER_INFLUXDB_INIT_RETENTION=30d
    volumes:
      - /volume1/storage/lunagrid/influxdb:/var/lib/influxdb2:rw
    networks:
      - backend
    restart: unless-stopped

  # Ingestion Agent - Routes raw MQTT messages to InfluxDB buckets
  lunagrid-telegraf:
    image: telegraf:1.30
    container_name: lunagrid-telegraf
    depends_on:
      - lunagrid-mosquitto
      - influxdb
    volumes:
      - ./etc/lunagrid/telegraf.conf:/etc/telegraf/telegraf.conf:ro
    networks:
      - backend
    restart: unless-stopped

  # Backend Engine - Houses custom APIs and SQLite registries
  lunagrid-backend:
    build:
      context: ../../../workspace/lunagrid/backend
      dockerfile: Dockerfile
    container_name: lunagrid-backend
    ports:
      - "127.0.0.1:3002:3000"   # Exposed to local loopback; Nginx reverse proxies this
    environment:
      - PORT=3000
      - MQTT_BROKER_URL=mqtt://lunagrid-mosquitto:1883
      - DATABASE_PATH=/data/lunagrid.db
    volumes:
      - /volume1/storage/lunagrid/backend:/data:rw
    depends_on:
      - lunagrid-mosquitto
      - influxdb
    networks:
      - backend
    restart: unless-stopped
```

---

## 3. Configuration & Data Preparation

### 3.1 Folder Permissions
Because Docker containers run under different system users (often with unique UIDs), we need to ensure the host directories have the correct ownership and permissions:

| Mapped Host Path | Target Service | Required Permissions | Setup Command |
| :--- | :--- | :--- | :--- |
| `/volume1/storage/lunagrid/mosquitto/data` & `log` | Mosquitto | Writable by UID `1883` (Mosquitto user) | `sudo chown -R 1883:1883 /volume1/storage/lunagrid/mosquitto` |
| `/volume1/storage/lunagrid/influxdb` | InfluxDB | Writable by UID `1000` (InfluxDB default user) | `sudo chown -R 1000:1000 /volume1/storage/lunagrid/influxdb` |
| `/volume1/storage/lunagrid/backend` | Node.js API | Writable by container root/user | `sudo chmod -R 775 /volume1/storage/lunagrid/backend` |
| `etc/nginx/htdocs/lunagrid/` | Nginx Static | Readable by Nginx worker (`nginx` user) | `sudo chmod -R 755 etc/nginx/htdocs/lunagrid` |

---

## 4. Firmware Configuration Update

**Yes, you must update the firmware configuration** to connect to the new MQTT broker instance running on your Synology NAS:

1.  Open the firmware file: [main.cpp](file:///home/bvarnai/workspace/lunagrid/firmware/src/main.cpp#L10)
2.  Change the `mqtt_server` variable from your development PC's IP (`192.168.48.220`) to the **IP address or local domain of your Synology NAS** (e.g., `"nas48.vbl.hu"` or `"192.168.48.x"`):
    ```cpp
    const char* mqtt_server = "nas48.vbl.hu"; // Replace with your NAS local IP or DNS
    ```
3.  Recompile and flash the firmware onto the ESP32-C3 Super Mini.

---

## 5. Frontend Compilation & Base Path

To serve the frontend correctly under the subpath `/lunagrid/`, we must configure Vite to prefix all asset paths.

1.  **Vite Configuration:** Modify `frontend/vite.config.ts` to include `base: '/lunagrid/'`.
2.  **Compilation:** Build the static assets:
    ```bash
    cd /home/bvarnai/workspace/lunagrid/frontend
    npm install
    npm run build
    ```
3.  **Deploy Static Files:** Copy the output `/home/bvarnai/workspace/lunagrid/frontend/dist/*` to `/home/bvarnai/infra/nodes/nas48/etc/nginx/htdocs/lunagrid/`.
4.  **Dashboard Configuration:** Once loaded in the browser, go to the **Settings** tab and set the API Base URL to `/lunagrid` (enabling relative fetching).

---

## 6. Nginx Configuration Additions

We will add two new blocks inside the `nas48.vbl.hu` SSL server configuration in `/home/bvarnai/infra/nodes/nas48/etc/nginx/nginx.conf`:

```nginx
    # Redirect base context path
    location = /lunagrid
    {
      return 301 /lunagrid/;
    }

    # Serve Lunagrid compiled static frontend
    location /lunagrid/
    {
      root /etc/nginx/htdocs;
      index index.html;
      try_files $uri $uri/ /lunagrid/index.html;
    }

    # Proxy REST API requests to the Node.js backend
    location /lunagrid/api/
    {
      # Strip /lunagrid prefix so backend receives standard /api/ paths
      rewrite ^/lunagrid/(.*) /$1 break;
      
      proxy_pass http://127.0.0.1:3002;
      proxy_redirect off;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
    }
```

---

## 7. Verification and Deployment Steps

1.  **Generate Frontend Build:** Build and deploy static assets to the Nginx root directory.
2.  **Configure Config Files:** Write configuration files into `/home/bvarnai/infra/nodes/nas48/etc/lunagrid/`.
3.  **Update Nginx Conf:** Apply the reverse-proxy routes and reload Nginx:
    ```bash
    docker exec nginx nginx -s reload
    ```
4.  **Append to Compose & Launch:** Merge the new service definitions into the NAS `docker-compose.yml` and run:
    ```bash
    cd ~/infra/nodes/nas48
    docker compose up -d
    ```
5.  **Verify UI & API Connectivity:** Access `https://nas48.vbl.hu/lunagrid/` in a browser. Open Settings, set API URL to `/lunagrid`, test backend connectivity, and confirm active state.
6.  **Grafana Integration:** Log into the existing Grafana (`https://nas48.vbl.hu/grafana/`), add the InfluxDB 2.0 datasource pointing to `http://influxdb:8086`, and import `/home/bvarnai/workspace/lunagrid/infrastructure/grafana/provisioning/dashboards/lunagrid.json`.
