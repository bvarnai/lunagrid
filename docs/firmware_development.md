# Firmware Development Guide - Project Lunagrid

This document details the development environment setup, project toolchain configuration, compilation, flashing, and monitoring procedures for the ESP32-C3-SuperMini development board used in Project Lunagrid.

Development is performed within a **Windows 11/10 host** running a **WSL2 (Windows Subsystem for Linux)** Linux distribution, using **PlatformIO Core (CLI)** for build management.

---

## 1. System Architecture Overview

Because WSL2 runs inside an isolated lightweight virtual machine, physical USB devices connected to the Windows host are not visible to Linux by default. We use `usbipd-win` to share and attach physical USB serial buses directly to WSL2.

```
 +-----------------------------+                    +-----------------------------+
 |        Windows Host         |                    |         WSL2 Linux          |
 |                             |                    |                             |
 |   +---------------------+   |                    |   +---------------------+   |
 |   |     usbipd-win      | --|-- (IP Protocol) -> |   |   /dev/ttyACM0      |   |
 |   +----------+----------+   |                    |   +----------+----------+   |
 |              |              |                    |              |                  |
 +--------------|--------------+                    |              v                  |
                | USB Passthrough                   |   +---------------------+   |
                v                                   |   |     PlatformIO      |   |
     [ ESP32-C3 SuperMini ]                         |   +---------------------+   |
     (Native USB CDC Port)                          +-----------------------------+
```

---

## 2. Prerequisites

Ensure you have the following before continuing:
- **Hardware:**
  - ESP32-C3-SuperMini development board.
  - USB-C data cable (ensure it supports data transfer, not power-only).
  - Windows host PC.
- **Software:**
  - Windows 10/11 with WSL2 enabled and a Linux distribution (e.g., Ubuntu) installed.
  - Python 3 and `pip` installed inside your WSL2 distribution.

---

## 3. Windows Host Setup (USB Passthrough)

Run the following setup on your Windows host from a PowerShell window launched with **Administrator** privileges:

1. **Install USBIPD-Win:**
   ```powershell
   winget install usbipd-win
   ```
   *Note: Close and reopen your terminal to update the system environment paths.*

2. **List Connected USB Devices:**
   Connect the ESP32-C3-SuperMini board via USB. Find the device's Bus ID (look for `USB Serial Device` or matching vendor descriptions):
   ```powershell
   usbipd list
   ```

3. **Bind the USB Device:**
   Bind the device's Bus ID (e.g., `2-3`) to allow sharing:
   ```powershell
   usbipd bind --busid 2-3
   ```

4. **Attach the Device to WSL:**
   Attach the device to your active WSL2 instance. Using the `--auto-attach` flag keeps the connection active even if the ESP32-C3 undergoes software resets during compilation or flashing:
   ```powershell
   usbipd attach --wsl --busid 2-3 --auto-attach
   ```

---

## 4. WSL2 Environment & Toolchain Setup

Perform the following steps inside your WSL2 bash terminal:

### 4.1 USB Port Validation & Permissions
1. **Locate the Virtual Serial Interface:**
   The native USB CDC hardware controller of the ESP32-C3 should register as an ACM device:
   ```bash
   ls -la /dev/ttyACM*
   ```
   *Output Example: `/dev/ttyACM0`*

2. **Grant Serial Port Permissions:**
   Grant read and write access to the virtual serial interface:
   ```bash
   sudo chmod 666 /dev/ttyACM0
   ```

### 4.2 PlatformIO Core Installation
We use PlatformIO CLI for efficient compiler toolchain isolation inside WSL2:

1. **Install PlatformIO Core:**
   ```bash
   # Update package index and install required packages
   sudo apt-get update && sudo apt-get install -y python3-pip python3-venv

   # Install PlatformIO via standard pip package
   pip3 install -U platformio
   ```

2. **Validate Installation:**
   Verify PlatformIO is added to your shell path:
   ```bash
   pio --version
   ```

---

## 5. Project Configuration

Create a [platformio.ini](file:///c:/Users/bvarnai/workspace/lunagrid/platformio.ini) configuration file in the project's root folder. This directs PlatformIO to use the correct Arduino core compiler settings, partitions, and libraries for the ESP32-C3-SuperMini.

```ini
[env:esp32-c3-supermini]
platform = espressif32
board = esp32-c3-devkitm-1
framework = arduino
monitor_speed = 115200
upload_speed = 460800
upload_port = /dev/ttyACM0
monitor_port = /dev/ttyACM0

; Force compilation flags to route serial logging output over native USB CDC
build_flags =
    -D ARDUINO_USB_MODE=1
    -D ARDUINO_USB_CDC_ON_BOOT=1

; Required libraries for Project Lunagrid features
lib_deps =
    knolleary/PubSubClient @ ^2.8
```

---

## 6. Build, Flashing & Monitoring Workflow

### 6.1 Basic Workflow Commands
Use these commands inside your project root to manage compilation and deployment:

- **Compile Code:**
  ```bash
  pio run
  ```

- **Upload/Flash Binary:**
  ```bash
  pio run --target upload
  ```

- **Open Serial Monitor:**
  ```bash
  pio device monitor
  ```

- **Build and Flash in one step:**
  ```bash
  pio run --target upload --target monitor
  ```

### 6.2 Manual Bootloader Mode (Flashing Failures)
If the upload process times out or fails to synchronise with the board (`esptool.py` packet errors):
1. **Press and hold** the physical **BOOT** button on the SuperMini board.
2. **Press and release** the physical **RST** button.
3. **Release** the **BOOT** button.
4. Execute the upload command again: `pio run --target upload`.
5. Once the upload finishes, press **RST** to boot into the application mode.

---

## 7. Additional References

- **Firmware Release & Rollout Guide:** [firmware_release_guide.md](file:///home/bvarnai/workspace/lunagrid/docs/firmware_release_guide.md)
- **Standalone ESPHome Prototyping Quickstart:** [usb_serial_quickstart.md](file:///c:/Users/bvarnai/workspace/lunagrid/docs/usb_serial_quickstart.md)
- **Project Abstract & Architecture Specs:** [lunagrid_project_plan.md](file:///c:/Users/bvarnai/workspace/lunagrid/docs/lunagrid_project_plan.md)
