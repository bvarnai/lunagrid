# Firmware Release & Rollout Guide - Project Lunagrid

This document provides a step-by-step workflow for compiling, hosting, registering, and rolling out new firmware versions to your Project Lunagrid ESP32-C3 edge devices.

---

## 1. Prepare and Compile the Firmware

1. **Set the Firmware Version**:
   Open `firmware/src/main.cpp` and update the static version string near the top:
   ```cpp
   const char* FIRMWARE_VERSION = "1.1.0"; // Increment this version (e.g. 1.0.1 -> 1.1.0)
   ```
   *Note: The target version string registered in the web portal release manager must exactly match this string.*

2. **Compile the release binary with injected credentials**:
   Run the PlatformIO compiler from the `firmware/` directory with production network credentials:
   ```bash
   PLATFORMIO_BUILD_FLAGS='-DWIFI_SSID=\"YourProductionSSID\" -DWIFI_PASSWORD=\"YourProductionPassword\" -DMQTT_SERVER=\"nas48.vbl.hu\"' pio run
   ```

3. **Locate the compiled binary**:
   Once compilation completes, the binary is located at:
   `firmware/.pio/build/esp32-c3-supermini/firmware.bin`


---

## 2. Host the Firmware Binary

The ESP32-C3 devices need to download the binary over HTTP or HTTPS. You can host this file on your Nginx server on the NAS.

1. **Deploy folder structure**:
   On your NAS deployment (`nas48`), Nginx serves files from `/etc/nginx/htdocs/lunagrid/`. We recommend creating a `releases/` directory there to isolate binaries:
   ```bash
   mkdir -p /etc/nginx/htdocs/lunagrid/releases/
   ```

2. **Copy the binary**:
   Transfer the compiled `firmware.bin` to the releases folder, naming it with the version suffix:
   ```bash
   cp firmware.bin /etc/nginx/htdocs/lunagrid/releases/firmware_v1.1.0.bin
   ```

3. **Verify web accessibility**:
   Ensure the binary is downloadable from your local network/device network:
   `http://nas48.vbl.hu/lunagrid/releases/firmware_v1.1.0.bin` (or matching HTTPS url).

---

## 3. Register the Release in the Portal

Once hosted, register the new release in the database registry using the web portal:

1. Open the Lunagrid Web Portal (`https://nas48.vbl.hu/lunagrid`).
2. Go to the **Management** tab.
3. Scroll down to the **Firmware Release Manager** panel.
4. Fill in the **Register New Release** form:
   * **Version Number**: `1.1.0` (must match the `FIRMWARE_VERSION` constant compiled into the binary).
   * **Firmware Binary URL**: `http://nas48.vbl.hu/lunagrid/releases/firmware_v1.1.0.bin`
   * **Release Notes**: Describe the changes (e.g. "Reduced telemetry interval to 5 min").
5. Click **Register Version**. The new release will appear in the **Registered Releases** list.

---

## 4. Trigger & Monitor the Rollout

You can now roll out the update to your active devices:

1. Locate the version you want to distribute in the **Registered Releases** list.
2. Click **Rollout**. A confirmation dialog will appear.
3. Once approved, the backend queries InfluxDB/SQLite for active devices and publishes an MQTT OTA trigger command to `lunagrid/devices/{deviceId}/cmd`.
4. **Firmware Verification Check**:
   * Devices running `v1.1.0` or newer will automatically **reject** the update command.
   * Devices running older versions (e.g., `v1.0.0`) will accept it, turn their status LED on solid, download the binary, flash the standby partition, and reboot.
5. **Monitor Progress**:
   * The portal displays the **Active Rollout Status** panel.
   * Check the progress bar to see the percentage of updated devices.
   * Review the device list matrix to verify each device updates its running version and transitions to "Up to Date".
