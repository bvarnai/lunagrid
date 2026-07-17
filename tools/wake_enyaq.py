#!/usr/bin/env python3
"""
Skoda Enyaq EV Wake-up Prototyping Script

Dependencies are isolated in a virtual environment to prevent package version collisions (e.g. ESPHome):
Setup:
  python3 -m venv tools/.venv
  source tools/.venv/bin/activate
  pip install --upgrade pip
  pip install myskoda aiohttp

Run:
  python tools/wake_enyaq.py

Backend Integration Command:
  tools/.venv/bin/python tools/wake_enyaq.py
"""
import sys
import asyncio
from aiohttp import ClientSession
from myskoda import MySkoda

# Configuration - customize these variables or set them via env vars
SKODA_EMAIL = "YOUR_SKODA_ACCOUNT_EMAIL"
SKODA_PASSWORD = "YOUR_SKODA_PASSWORD"
VEHICLE_VIN = "YOUR_ENYAQ_VIN"

async def main():
    if SKODA_EMAIL == "YOUR_SKODA_ACCOUNT_EMAIL":
        print("Error: Please set your MySkoda account credentials and VIN in tools/wake_enyaq.py.")
        sys.exit(1)

    print("Connecting to MySkoda API...")
    async with ClientSession() as session:
        # Initialize MySkoda client with the HTTP session
        myskoda = MySkoda(session)
        
        # Connect to MySkoda API
        await myskoda.connect(SKODA_EMAIL, SKODA_PASSWORD)
        
        # Retrieve registered VINs
        vins = await myskoda.list_vehicle_vins()
        if VEHICLE_VIN not in vins:
            print(f"Error: Enyaq with VIN {VEHICLE_VIN} not found in account (registered VINs: {vins}).")
            await myskoda.disconnect()
            sys.exit(1)

        print(f"Found Enyaq with VIN: {VEHICLE_VIN}")
        
        # Waking up a Skoda Enyaq:
        # The most reliable method to wake the charger module and HV contactor is by triggering 
        # the remote air conditioning for a target temperature.
        # To avoid wasting battery power, we let it run for 30 seconds to wake the charging gateway,
        # and then send the stop command immediately.
        print("Triggering air conditioning to wake up vehicle HV charging circuit...")
        await myskoda.start_air_conditioning(VEHICLE_VIN, temperature=21)
        print("Air conditioning started. Waiting 30 seconds for vehicle gateway to wake up...")
        
        await asyncio.sleep(30)
        
        print("Stopping air conditioning to prevent energy waste...")
        await myskoda.stop_air_conditioning(VEHICLE_VIN)
        print("SUCCESS: Air conditioning stopped. Enyaq is awake and charging should continue.")
        
        # Gracefully disconnect session
        await myskoda.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
