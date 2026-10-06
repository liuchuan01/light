"""Preview at most eight consecutive local points, announcing each index first."""

import argparse
import asyncio
import os
import subprocess
import uuid
from datetime import datetime
from pathlib import Path

from bleak import BleakClient

if __package__:
    from .preview_point_once import build_preview
    from .query_light_list import EventLog, NOTIFY_UUID, WRITE_UUID, check_gatt, hex_bytes
else:
    from preview_point_once import build_preview
    from query_light_list import EventLog, NOTIFY_UUID, WRITE_UUID, check_gatt, hex_bytes


SAY_PATH = Path("/usr/bin/say")
OBSERVE_SECONDS = 4.0


def validate_range(start: int, end: int) -> None:
    if any(isinstance(value, bool) or not isinstance(value, int) for value in (start, end)):
        raise ValueError("start and end must be decimal integers")
    if not 0 <= start <= end <= 39:
        raise ValueError("start and end must satisfy 0 <= start <= end <= 39")
    if end - start + 1 > 8:
        raise ValueError("one batch can contain at most 8 consecutive points")


def validate_say(path: Path) -> None:
    if not path.is_file() or not os.access(path, os.X_OK):
        raise RuntimeError(f"speech command unavailable: {path}")
    try:
        result = subprocess.run(
            [str(path), "-v", "?"], capture_output=True, text=True, timeout=5, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(f"speech voice check failed: {path}") from exc
    if result.returncode != 0 or not any(
        line.split()[:1] == ["Tingting"] for line in result.stdout.splitlines()
    ):
        raise RuntimeError("Tingting Chinese voice unavailable")


async def say_index(index: int, executable: Path) -> None:
    process = await asyncio.create_subprocess_exec(
        str(executable), "-v", "Tingting", f"点位 {index}",
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await process.communicate()
    if process.returncode != 0:
        raise RuntimeError(f"speech command failed for point {index}: {stderr.decode(errors='replace').strip()}")


async def preview_batch(
    identifier: str,
    start: int,
    end: int,
    log_path: Path,
    *,
    say_path: Path = SAY_PATH,
    client_factory=BleakClient,
    speaker=say_index,
    pause=asyncio.sleep,
) -> None:
    validate_range(start, end)
    if not identifier.strip():
        raise ValueError("device identifier must not be empty")
    validate_say(say_path)

    # Exclusive creation also checks the destination before a BLE connection exists.
    with EventLog(log_path, identifier, "33") as log:
        log.write("start", start_index=start, end_index=end, observe_seconds=OBSERVE_SECONDS)
        active_index: int | None = None

        def on_notification(sender: object, data: bytearray) -> None:
            log.write(
                "rx", point_index=active_index,
                characteristic_uuid=str(getattr(sender, "uuid", NOTIFY_UUID)),
                hex=hex_bytes(data),
            )

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
                    for index in range(start, end + 1):
                        await speaker(index, say_path)
                        log.write("point_announced", point_index=index)
                        request = build_preview(index)
                        active_index = index
                        log.write("tx_attempt", point_index=index, hex=hex_bytes(request), write_type="without-response")
                        await client.write_gatt_char(WRITE_UUID, request, response=False)
                        log.write("write_api_completed", point_index=index, device_acknowledged=False)
                        await pause(OBSERVE_SECONDS)
                        log.write("observation_window_completed", point_index=index)
                finally:
                    if subscribed:
                        await client.stop_notify(NOTIFY_UUID)
                        log.write("unsubscribed")
            log.write("disconnected")
        except Exception as exc:
            log.write("error", error_type=type(exc).__name__, message=str(exc), point_index=active_index)
            raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("identifier", help="CoreBluetooth identifier reported by scan_ble.py")
    parser.add_argument("start", type=int, help="first point index, decimal 0-39")
    parser.add_argument("end", type=int, help="last point index, decimal 0-39; inclusive; at most 8 points")
    parser.add_argument("--log", type=Path, help="new JSONL file; existing files are never overwritten")
    args = parser.parse_args()
    try:
        validate_range(args.start, args.end)
    except (ValueError, RuntimeError) as exc:
        parser.error(str(exc))
    suffix = datetime.now().astimezone().strftime("%Y%m%dT%H%M%S%z")
    log_path = args.log or Path("logs") / f"points-{args.start}-{args.end}-{suffix}-{uuid.uuid4().hex[:8]}.jsonl"
    print(f"Raw event log: {log_path}", flush=True)
    asyncio.run(preview_batch(args.identifier, args.start, args.end, log_path))


if __name__ == "__main__":
    main()
