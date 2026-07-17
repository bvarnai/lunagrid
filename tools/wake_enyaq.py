#!/usr/bin/env python3
import sys
import asyncio
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
    # Initialize connection via MySkoda context manager
    async with MySkoda(SKODA_EMAIL, SKODA_PASSWORD) as myskoda:
        # Fetch vehicles
        vehicles = await myskoda.get_vehicles()
        
        # Locate target vehicle
        enyaq = None
        for v in vehicles:
            if v.vin == VEHICLE_VIN:
                enyaq = v
                break
                
        if not enyaq:
            print(f"Error: Enyaq with VIN {VEHICLE_VIN} not found in account.")
            sys.exit(1)

        print(f"Found: Skoda Enyaq (VIN: {enyaq.vin})")
        
        # Waking up a Skoda Enyaq:
        # The most reliable method to wake the charger module and HV contactor is by triggering 
        # the remote climatisation (heating/ventilation) for a target temperature.
        print("Triggering climatisation to wake up vehicle HV charging circuit...")
        
        # Send start climatisation command
        # Target temperature is usually required by MySkoda API (e.g. 21.0 C)
        await myskoda.start_climatisation(VEHICLE_VIN, target_temperature=21.0)
        print("SUCCESS: MySkoda climatisation command sent successfully! Enyaq is waking up.")

if __name__ == "__main__":
    asyncio.run(main())
