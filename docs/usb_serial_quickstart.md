## ESP32-C3-SuperMini: WSL2 to ESPHome Quickstart

The ESP32-C3-SuperMini uses a native USB CDC controller. Because WSL2 runs in an isolated virtual machine, physical USB devices must be piped into Linux manually using `usbipd-win`.

---

### 1. Windows Host Setup (PowerShell as Admin)

Install the USB bridge, authorize the device for sharing, and link it to your active WSL2 instance:

```powershell
# Install the USB network sharing tool (Restart terminal after install)
winget install usbipd-win

# Step 1: Bind the specific hardware bus (Find via 'usbipd list' if different)
usbipd bind --busid 2-3

# Step 2: Route the interface to WSL with persistent auto-recovery
usbipd attach --wsl --busid 2-3 --auto-attach

```

---

### 2. ESPHome Configuration File

Create a project directory in WSL and save the following as `supermini-blink.yaml`. This uses **GPIO 10** to bypass strapping pin boot warnings.

```yaml
esphome:
  name: supermini-safe-output
  comment: "ESP32-C3-SuperMini Non-Strapping Pin Deployment"

esp32:
  board: esp32-c3-devkitm-1
  framework:
    type: arduino

# Forces logging text to route over the internal USB controller
logger:
  hardware_uart: USB_CDC
  baud_rate: 115200

output:
  - platform: gpio
    pin: GPIO10
    inverted: false
    id: safe_external_output

light:
  - platform: binary
    name: "SuperMini Safe Output"
    output: safe_external_output
    id: external_led

interval:
  - interval: 2s
    then:
      - light.turn_on:
          id: external_led
      - logger.log: "[RUNTIMER] Safe GPIO10 Output State: HIGH"
      - delay: 200ms
      - light.turn_off:
          id: external_led
      - logger.log: "[RUNTIMER] Safe GPIO10 Output State: LOW"

```

---

### 3. Compilation and Flashing (WSL Terminal)

Run these terminal commands within your WSL project folder to authorize the virtual serial port and execute the ESPHome pipeline:

```bash
# Grant execution layer access to the virtual serial interface node
sudo chmod 666 /dev/ttyACM0

# Direct the compilation workspace to build and flash over the explicit path
esphome run supermini-blink.yaml --device /dev/ttyACM0

```

> **Flashing Failures?** If `esptool.py` struggles to capture the chip synchronizations, put the SuperMini into manual bootloader mode: **Hold BOOT**, **Press RST**, then **Release BOOT**, and re-run the `esphome` command.

