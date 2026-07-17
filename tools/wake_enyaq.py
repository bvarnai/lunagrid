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
  python tools/wake_enyaq.py --help
  python tools/wake_enyaq.py --email email@domain.com --password mypass --vin TMBJJ7N...
"""
import argparse
import asyncio
import os
import sys
from aiohttp import ClientSession
from myskoda import MySkoda

async def main():
    # Setup Argument Parser
    parser = argparse.ArgumentParser(
        description="Wake up Skoda Enyaq EV charging loop by triggering air conditioning temporarily."
    )
    parser.add_argument(
        "--email", 
        type=str, 
        help="MySkoda account email address (can also be set via SKODA_EMAIL env var)",
        default=os.environ.get("SKODA_EMAIL")
    )
    parser.add_argument(
        "--password", 
        type=str, 
        help="MySkoda account password (can also be set via SKODA_PASSWORD env var)",
        default=os.environ.get("SKODA_PASSWORD")
    )
    parser.add_argument(
        "--vin", 
        type=str, 
        help="Vehicle VIN (can also be set via VEHICLE_VIN env var)",
        default=os.environ.get("VEHICLE_VIN")
    )
    parser.add_argument(
        "--temp", 
        type=int, 
        help="Target temperature in Celsius (default: 21)",
        default=21
    )
    parser.add_argument(
        "--wait", 
        type=int, 
        help="Seconds to wait before turning off air conditioning (default: 30)",
        default=30
    )

    args = parser.parse_args()

    # Validate Arguments
    if not args.email:
        parser.error("Email is required. Set --email or SKODA_EMAIL environment variable.")
    if not args.password:
        parser.error("Password is required. Set --password or SKODA_PASSWORD environment variable.")
    if not args.vin:
        parser.error("VIN is required. Set --vin or VEHICLE_VIN environment variable.")

    print("Connecting to MySkoda API...")
    async with ClientSession() as session:
        # Initialize MySkoda client with the HTTP session
        myskoda = MySkoda(session)
        
        # Connect to MySkoda API
        try:
            await myskoda.connect(args.email, args.password)
        except Exception as e:
            print(f"\nAUTHENTICATION ERROR: Failed to log in to MySkoda API ({type(e).__name__}).")
            print("This typically happens when:")
            print("  1. The email or password provided is incorrect.")
            print("  2. There are new Terms of Service or marketing consents you must accept first in your official MySkoda mobile app.")
            print("  3. Skoda's identity authorization servers are undergoing maintenance or are temporarily down.")
            sys.exit(1)
        
        # Retrieve registered VINs
        vins = await myskoda.list_vehicle_vins()
        if args.vin not in vins:
            print(f"Error: Enyaq with VIN {args.vin} not found in account (registered VINs: {vins}).")
            await myskoda.disconnect()
            sys.exit(1)

        print(f"Found Enyaq with VIN: {args.vin}")
        
        # Waking up a Skoda Enyaq:
        # The most reliable method to wake the charger module and HV contactor is by triggering 
        # the remote air conditioning for a target temperature.
        # To avoid wasting battery power, we let it run for 30 seconds to wake the charging gateway,
        # and then send the stop command immediately.
        print("Triggering air conditioning to wake up vehicle HV charging circuit...")
        await myskoda.start_air_conditioning(args.vin, temperature=args.temp)
        print(f"Air conditioning started. Waiting {args.wait} seconds for vehicle gateway to wake up...")
        
        await asyncio.sleep(args.wait)
        
        print("Stopping air conditioning to prevent energy waste...")
        await myskoda.stop_air_conditioning(args.vin)
        print("SUCCESS: Air conditioning stopped. Enyaq is awake and charging should continue.")
        
        # Gracefully disconnect session
        await myskoda.disconnect()

if __name__ == "__main__":
    # Ensure correct event loop execution for script run
    asyncio.run(main())
