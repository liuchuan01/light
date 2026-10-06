"""Send one low-brightness full-body preview; never save a preset."""

import asyncio
from datetime import datetime

from bleak import BleakClient


DEVICE_ID = "1BAA3B72-5D5A-32C5-0FD6-4B579EE6566C"
SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb"
WRITE_UUID = "0000fff3-0000-1000-8000-00805f9b34fb"
NOTIFY_UUID = "0000fff4-0000-1000-8000-00805f9b34fb"
# APK preview command 0x43: slot 0, enabled, single white, brightness 10,
# effect mode 0, forward, speed 0. Only brightness differs from the document's
# white test vector (100).
PREVIEW = bytes.fromhex("BC 43 01 0A 00 01 00 FF FF FF 0A 00 00 00 55")


async def main() -> None:
    def on_notification(_sender: object, data: bytearray) -> None:
        now = datetime.now().astimezone().isoformat(timespec="milliseconds")
        print(f"{now} RX {bytes(data).hex(' ').upper()}", flush=True)

    async with BleakClient(DEVICE_ID, timeout=15.0) as client:
        service = client.services.get_service(SERVICE_UUID)
        if service is None:
            raise RuntimeError("Expected FFF0 service not found; no command sent")
        if service.get_characteristic(WRITE_UUID) is None or service.get_characteristic(NOTIFY_UUID) is None:
            raise RuntimeError("Expected FFF3/FFF4 characteristics not found; no command sent")
        print("Connected; expected FFF0/FFF3/FFF4 found", flush=True)
        await client.start_notify(NOTIFY_UUID, on_notification)
        print(f"TX {PREVIEW.hex(' ').upper()}", flush=True)
        await client.write_gatt_char(WRITE_UUID, PREVIEW, response=False)
        print("Write API completed", flush=True)
        await asyncio.sleep(5)
        await client.stop_notify(NOTIFY_UUID)
    print("Disconnected", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
