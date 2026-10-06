"""Scan nearby BLE advertisements without connecting to a device."""

import argparse
import asyncio

from bleak import BleakScanner


async def main(duration: float) -> None:
    print(f"Scanning BLE advertisements for {duration:g} seconds...", flush=True)
    found = await BleakScanner.discover(timeout=duration, return_adv=True)
    print(f"Found {len(found)} device(s).")
    for identifier, (device, advertisement) in sorted(
        found.items(), key=lambda item: item[1][1].rssi, reverse=True
    ):
        name = advertisement.local_name or device.name or "(no name)"
        services = ", ".join(advertisement.service_uuids) or "(none advertised)"
        print(f"{name} | ID={identifier} | RSSI={advertisement.rssi} dBm")
        print(f"  services: {services}")
        if advertisement.manufacturer_data:
            companies = ", ".join(
                f"0x{company:04X}" for company in advertisement.manufacturer_data
            )
            print(f"  manufacturer IDs: {companies}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duration", type=float, default=30.0)
    args = parser.parse_args()
    asyncio.run(main(args.duration))
