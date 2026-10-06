"""Connect briefly and list GATT metadata; do not read or write values."""

import argparse
import asyncio

from bleak import BleakClient


async def main(identifier: str) -> None:
    async with BleakClient(identifier, timeout=15.0) as client:
        print(f"Connected: {client.is_connected}")
        for service in client.services:
            print(f"Service {service.uuid} ({service.description})")
            for characteristic in service.characteristics:
                properties = ", ".join(characteristic.properties)
                print(f"  Characteristic {characteristic.uuid}: {properties}")
                for descriptor in characteristic.descriptors:
                    print(f"    Descriptor {descriptor.uuid}")
    print("Disconnected")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("identifier", help="Identifier reported by scan_ble.py")
    args = parser.parse_args()
    asyncio.run(main(args.identifier))
