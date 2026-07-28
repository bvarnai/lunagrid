# Firmware Development Guide - Project Lunagrid

This document details the development environment setup, project toolchain configuration, compilation, flashing, and monitoring procedures for the ESP32-C3-SuperMini development board used in Project Lunagrid.

Development is performed either within a **Windows 11/10 host** running a **WSL2 (Windows Subsystem for Linux)** Linux distribution, or directly on a **native Linux host (e.g., Ubuntu)**, using **PlatformIO Core (CLI)** for build management.

---

## 1. System Architecture Overview

### Windows WSL2 Development Path
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

### Native Linux Development Path
On a native Linux host, the hardware USB serial controller of the ESP32-C3 is directly exposed to the operating system kernel when plugged in. No network encapsulation or virtualization bridging is necessary.

```
 +--------------------------------------------------------------------------------+
 |                               Native Linux Host                                |
 |                                                                                |
 |   +---------------------+        USB Connection        +---------------------+ |
 |   | ESP32-C3 SuperMini  | <==========================> |    /dev/ttyACM0     | |
 |   +---------------------+                              +----------+----------+ |
 |                                                                   |            |
 |                                                                   v            |
 |                                                        +---------------------+ |
 |                                                        |     PlatformIO      | |
 |                                                        +---------------------+ |
 +--------------------------------------------------------------------------------+
```

---

## 2. Prerequisites

Ensure you have the following before continuing:
- **Hardware:**
  - ESP32-C3-SuperMini development board.
  - USB-C data cable (ensure it supports data transfer, not power-only).
  - A PC running either Windows 10/11 or a native Linux distribution (e.g., Ubuntu).
- **Software:**
  - **For Windows hosts:** Windows 10/11 with WSL2 enabled and a Linux distribution (e.g., Ubuntu) installed.
  - **For Linux/WSL2:** Python 3 and `pip` installed on the Linux system.

---

## 3. Host USB & Permissions Setup

### 3.1 Windows Host Setup (WSL2 USB Passthrough)

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

### 3.2 Native Linux Host Setup (udev & Group Permissions)

On native Linux hosts (like Ubuntu), you must configure permission access to the serial devices so that you can compile, flash, and monitor without needing to run `sudo` or changing permissions on every reconnect.

1. **Install PlatformIO udev Rules:**
   PlatformIO provides a set of udev rules for various development boards, including ESP32 devices. Install them by running:
   ```bash
   sudo mkdir -p /etc/udev/rules.d
   curl -fsSL https://raw.githubusercontent.com/platformio/platformio-core/develop/platformio/assets/system/99-platformio-udev.rules | sudo tee /etc/udev/rules.d/99-platformio-udev.rules
   ```

2. **Reload udev Rules:**
   Apply the newly installed rules:
   ```bash
   sudo udevadm control --reload-rules
   sudo udevadm trigger
   ```

3. **Add User to Dialout/Plugdev Groups:**
   Add your current user to the `dialout` and `plugdev` groups to grant permission to access the serial interface:
   ```bash
   sudo usermod -a -G dialout $USER
   sudo usermod -a -G plugdev $USER
   ```
   *Note: For these group settings to take effect, you must log out of your Linux session and log back in, or restart your terminal/system.*

---

## 4. Linux Environment & Toolchain Setup

Perform the following steps inside your Linux terminal (WSL2 or Native Linux):

### 4.1 USB Port Validation & Permissions
1. **Locate the Virtual Serial Interface:**
   The native USB CDC hardware controller of the ESP32-C3 should register as an ACM device:
   ```bash
   ls -la /dev/ttyACM*
   ```
   *Output Example: `/dev/ttyACM0`*

2. **Verify/Grant Serial Port Permissions:**
   - **For Native Linux (if udev rules were set up in Section 3.2):** You should already have read/write access. Verify permissions with `ls -l /dev/ttyACM0`.
   - **For WSL2 (or as a quick workaround):** Grant read and write access to the virtual serial interface:
     ```bash
     sudo chmod 666 /dev/ttyACM0
     ```

### 4.2 PlatformIO Core Installation
We use PlatformIO CLI for efficient compiler toolchain isolation:

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

Create a [platformio.ini](file:///home/bvarnai/workspace/lunagrid/platformio.ini) configuration file in the project's root folder. This directs PlatformIO to use the correct Arduino core compiler settings, partitions, and libraries for the ESP32-C3-SuperMini.

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
    bblanchon/ArduinoJson @ ^7.0.4
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
- **Standalone ESPHome Prototyping Quickstart:** [usb_serial_quickstart.md](file:///home/bvarnai/workspace/lunagrid/docs/usb_serial_quickstart.md)
- **Project Abstract & Architecture Specs:** [system_architecture.md](file:///home/bvarnai/workspace/lunagrid/docs/system_architecture.md)
