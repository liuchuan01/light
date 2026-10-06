"""Send one allowlisted preset-list query and save every raw BLE event as JSONL."""

import argparse
import asyncio
import json
import math
import uuid
from datetime import datetime
from pathlib import Path

from bleak import BleakClient


SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb"
WRITE_UUID = "0000fff3-0000-1000-8000-00805f9b34fb"
NOTIFY_UUID = "0000fff4-0000-1000-8000-00805f9b34fb"
REQUESTS = {
    "40": bytes.fromhex("BC 40 00 00 55"),
    "30": bytes.fromhex("BC 30 00 00 55"),
    "50": bytes.fromhex("BC 50 00 00 55"),
}


def hex_bytes(data: bytes | bytearray) -> str:
    return bytes(data).hex(" ").upper()


def wait_seconds(value: str) -> float:
    try:
        seconds = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--wait must be a number of seconds") from exc
    if not math.isfinite(seconds) or not 1 <= seconds <= 60:
        raise argparse.ArgumentTypeError("--wait must be between 1 and 60 seconds")
    return seconds


def check_gatt(services: object) -> None:
    service = services.get_service(SERVICE_UUID)
    if service is None:
        raise RuntimeError("FFF0 service missing; no request sent")
    writer = service.get_characteristic(WRITE_UUID)
    receiver = service.get_characteristic(NOTIFY_UUID)
    if writer is None or "write-without-response" not in writer.properties:
        raise RuntimeError("FFF3 write-without-response characteristic missing; no request sent")
    if receiver is None or "notify" not in receiver.properties:
        raise RuntimeError("FFF4 notify characteristic missing; no request sent")


class EventLog:
    def __init__(self, path: Path, identifier: str, command: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.file = path.open("x", encoding="utf-8")
        self.session_id = str(uuid.uuid4())
        self.common = {
            "session_id": self.session_id,
            "device_id": identifier,
            "command": command,
            "service_uuid": SERVICE_UUID,
            "write_uuid": WRITE_UUID,
            "notify_uuid": NOTIFY_UUID,
        }

    def __enter__(self) -> "EventLog":
        return self

    def __exit__(self, *_: object) -> None:
        self.file.close()

    def write(self, event: str, **details: object) -> None:
        record = {
            "time": datetime.now().astimezone().isoformat(timespec="milliseconds"),
            **self.common,
            "event": event,
            **details,
        }
        self.file.write(json.dumps(record, ensure_ascii=False) + "\n")
        self.file.flush()
        summary = f"{record['time']} {event}"
        if "hex" in details:
            summary += f" {details['hex']}"
        print(summary, flush=True)


async def query(
    identifier: str,
    command: str,
    wait: float,
    log_path: Path,
    client_factory=BleakClient,
) -> None:
    if command not in REQUESTS:
        raise ValueError("command must be 30, 40, or 50")
    if not identifier.strip():
        raise ValueError("device identifier must not be empty")
    if not math.isfinite(wait) or not 1 <= wait <= 60:
        raise ValueError("wait must be between 1 and 60 seconds")

    request = REQUESTS[command]
    with EventLog(log_path, identifier, command) as log:
        log.write("start", wait_seconds=wait)

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
    parser.add_argument("command", choices=REQUESTS, help="one preset-list query: 40=full, 30=local, 50=advanced")
    parser.add_argument("--wait", type=wait_seconds, default=5.0, help="notification window in seconds (1-60)")
    parser.add_argument("--log", type=Path, help="new JSONL file; existing files are never overwritten")
    args = parser.parse_args()
    suffix = datetime.now().astimezone().strftime("%Y%m%dT%H%M%S%z")
    log_path = args.log or Path("logs") / f"list-{args.command}-{suffix}-{uuid.uuid4().hex[:8]}.jsonl"
    print(f"Raw event log: {log_path}", flush=True)
    asyncio.run(query(args.identifier, args.command, args.wait, log_path))


if __name__ == "__main__":
    main()
