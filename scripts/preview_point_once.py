"""Send one fixed low-brightness red preview for one local point index."""

import argparse
import asyncio
import math
import uuid
from datetime import datetime
from pathlib import Path

from bleak import BleakClient

if __package__:
    from .query_light_list import EventLog, NOTIFY_UUID, WRITE_UUID, check_gatt, hex_bytes, wait_seconds
else:
    from query_light_list import EventLog, NOTIFY_UUID, WRITE_UUID, check_gatt, hex_bytes, wait_seconds


def point_index(value: str) -> int:
    try:
        index = int(value, 10)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("point_index must be a decimal integer from 0 to 39") from exc
    if not 0 <= index <= 39:
        raise argparse.ArgumentTypeError("point_index must be from 0 to 39")
    return index


def build_preview(index: int) -> bytes:
    if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index <= 39:
        raise ValueError("point_index must be an integer from 0 to 39")
    # 33: slot 0, one point, red FF0000, brightness 0A, effect mode 0.
    return bytes.fromhex("BC 33 01 09 00 01") + bytes([index]) + bytes.fromhex("00 FF 00 00 0A 00 55")


async def preview(
    identifier: str,
    index: int,
    wait: float,
    log_path: Path,
    client_factory=BleakClient,
) -> None:
    request = build_preview(index)
    if not identifier.strip():
        raise ValueError("device identifier must not be empty")
    if not math.isfinite(wait) or not 1 <= wait <= 60:
        raise ValueError("wait must be between 1 and 60 seconds")

    with EventLog(log_path, identifier, "33") as log:
        log.write("start", point_index=index, wait_seconds=wait)

        def on_notification(sender: object, data: bytearray) -> None:
            log.write("rx", characteristic_uuid=str(getattr(sender, "uuid", NOTIFY_UUID)), hex=hex_bytes(data))

        try:
            async with client_factory(identifier, timeout=15.0) as client:
                log.write("connected")
                check_gatt(client.services)
                log.write("gatt_verified", write_properties=["write-without-response"], notify_properties=["notify"])
                subscribed = False
                try:
                    await client.start_notify(NOTIFY_UUID, on_notification)
                    subscribed = True
                    log.write("subscribed")
                    log.write("tx_attempt", hex=hex_bytes(request), write_type="without-response")
                    await client.write_gatt_char(WRITE_UUID, request, response=False)
                    log.write("write_api_completed", device_acknowledged=False)
                    await asyncio.sleep(wait)
                finally:
                    if subscribed:
                        await client.stop_notify(NOTIFY_UUID)
                        log.write("unsubscribed")
            log.write("disconnected")
        except Exception as exc:
            log.write("error", error_type=type(exc).__name__, message=str(exc))
            raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("identifier", help="CoreBluetooth identifier reported by scan_ble.py")
    parser.add_argument("point_index", type=point_index, help="one local point, decimal 0-39")
    parser.add_argument("--wait", type=wait_seconds, default=5.0, help="notification window in seconds (1-60)")
    parser.add_argument("--log", type=Path, help="new JSONL file; existing files are never overwritten")
    args = parser.parse_args()
    suffix = datetime.now().astimezone().strftime("%Y%m%dT%H%M%S%z")
    log_path = args.log or Path("logs") / f"point-{args.point_index}-{suffix}-{uuid.uuid4().hex[:8]}.jsonl"
    print(f"Raw event log: {log_path}", flush=True)
    asyncio.run(preview(args.identifier, args.point_index, args.wait, log_path))


if __name__ == "__main__":
    main()
