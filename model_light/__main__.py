"""Scan and send one restricted temporary lamp command per invocation."""

import argparse
import asyncio
import re
import uuid
from datetime import datetime
from pathlib import Path

from bleak import BleakClient, BleakScanner

from scripts.query_light_list import (
    EventLog,
    NOTIFY_UUID,
    WRITE_UUID,
    check_gatt,
    hex_bytes,
)
from .protocol import LIST_FRAMES, build_request


DEVICE_NAME = "极梦匠"
SCAN_SECONDS = 8.0
NOTIFY_SECONDS = 5.0


def parse_identifier(value: str) -> str:
    try:
        return str(uuid.UUID(value)).upper()
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--id must be a CoreBluetooth UUID") from exc


def parse_rgb(value: str) -> tuple[int, int, int]:
    if not re.fullmatch(r"[0-9A-Fa-f]{6}", value):
        raise argparse.ArgumentTypeError("--rgb must be six hexadecimal digits, for example FF0000")
    return tuple(bytes.fromhex(value))


def parse_brightness(value: str) -> int:
    try:
        brightness = int(value, 10)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--brightness must be a decimal integer from 1 to 10") from exc
    if not 1 <= brightness <= 10:
        raise argparse.ArgumentTypeError("--brightness must be from 1 to 10")
    return brightness


def parse_speed(value: str) -> int:
    try:
        speed = int(value, 10)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--speed must be a decimal integer from 0 to 100") from exc
    if not 0 <= speed <= 100:
        raise argparse.ArgumentTypeError("--speed must be from 0 to 100")
    return speed


def parse_target(value: str) -> str | int | tuple[int, ...]:
    if value == "all":
        return value
    labels = value.split(",")
    if not labels or any(not re.fullmatch(r"D([1-9]|1[0-9]|2[0-3])", label) for label in labels):
        raise argparse.ArgumentTypeError("--target must be all or comma-separated distinct D1 through D23 labels")
    points = tuple(int(label[1:]) - 1 for label in labels)
    if len(set(points)) != len(points):
        raise argparse.ArgumentTypeError("--target labels must be distinct")
    return points[0] if len(points) == 1 else points


async def discover_target(identifier: str, *, discoverer=BleakScanner.discover):
    found = await discoverer(timeout=SCAN_SECONDS, return_adv=True)
    for _key, (device, advertisement) in found.items():
        try:
            discovered_id = str(uuid.UUID(device.address)).upper()
        except ValueError:
            continue
        if discovered_id != identifier:
            continue
        if advertisement.local_name == DEVICE_NAME or device.name == DEVICE_NAME:
            return device
        raise RuntimeError("device ID matched, but name was not 极梦匠; no connection made")
    raise RuntimeError("device with exact name 极梦匠 and supplied CoreBluetooth ID not found")


async def run(
    identifier: str,
    kind: str,
    log_path: Path,
    *,
    list_kind: str | None = None,
    target: str | int | tuple[int, ...] | None = None,
    rgb: tuple[int, int, int] | None = None,
    brightness: int = 10,
    effect_mode: int = 0,
    direction: int = 0,
    speed: int = 0,
    discoverer=BleakScanner.discover,
    client_factory=BleakClient,
    pause=asyncio.sleep,
) -> None:
    identifier = parse_identifier(identifier)
    request = None if kind == "scan" else build_request(
        kind, list_kind=list_kind, target=target, rgb=rgb, brightness=brightness,
        effect_mode=effect_mode, direction=direction,
        speed=speed,
    )
    command = "scan" if request is None else f"{request[1]:02X}"
    with EventLog(log_path, identifier, command) as log:
        log.write("start", device_name=DEVICE_NAME, target=target, rgb=rgb,
                  brightness=brightness if kind == "preview" else None,
                  effect_mode=effect_mode if kind == "preview" else None,
                  direction=direction if kind == "preview" else None,
                  speed=speed if kind == "preview" else None)
        try:
            device = await discover_target(identifier, discoverer=discoverer)
            log.write("device_matched", device_name=DEVICE_NAME)
            if kind == "scan":
                log.write("scan_completed", device_name=DEVICE_NAME)
                return

            def on_notification(sender: object, data: bytearray) -> None:
                log.write("rx", characteristic_uuid=str(getattr(sender, "uuid", NOTIFY_UUID)), hex=hex_bytes(data))

            client = client_factory(device, timeout=15.0)
            entered = False
            try:
                async with client:
                    entered = True
                    log.write("connected")
                    check_gatt(client.services)
                    log.write("gatt_verified")
                    subscribed = False
                    try:
                        await asyncio.wait_for(client.start_notify(NOTIFY_UUID, on_notification), 10)
                        subscribed = True
                        log.write("subscribed")
                        log.write("tx_attempt", hex=hex_bytes(request), write_type="without-response")
                        await asyncio.wait_for(client.write_gatt_char(WRITE_UUID, request, response=False), 10)
                        log.write("write_api_completed", device_acknowledged=False)
                        await pause(NOTIFY_SECONDS)
                    finally:
                        if subscribed:
                            await asyncio.wait_for(client.stop_notify(NOTIFY_UUID), 10)
                            log.write("unsubscribed")
            except Exception:
                if not entered:
                    try:
                        await asyncio.wait_for(client.disconnect(), 10)
                        log.write("connect_failure_cleanup_completed")
                    except Exception as cleanup_error:
                        log.write("connect_failure_cleanup_failed", error_type=type(cleanup_error).__name__)
                raise
            log.write("disconnected")
        except Exception as exc:
            log.write("error", error_type=type(exc).__name__, message=str(exc))
            raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="operation", required=True)
    scan = subparsers.add_parser("scan", help="find the exact named device; do not connect")
    listing = subparsers.add_parser("list", help="send one preset-list query")
    preview = subparsers.add_parser("preview", help="send one temporary RGB preview")
    for subparser in (scan, listing, preview):
        subparser.add_argument("--id", required=True, type=parse_identifier, help="this Mac's CoreBluetooth UUID")
        subparser.add_argument("--log", type=Path, help="new JSONL log file; existing files are not overwritten")
    listing.add_argument("--kind", dest="list_kind", required=True, choices=LIST_FRAMES.keys(), help="40 full, 30 local, 50 advanced")
    preview.add_argument("--target", required=True, type=parse_target,
                         help="all, D1, or comma-separated labels such as D1,D2")
    preview.add_argument("--rgb", required=True, type=parse_rgb, help="six hex digits, such as FF0000")
    preview.add_argument("--brightness", type=parse_brightness, default=10, help="integer 1-10; default 10")
    preview.add_argument("--effect-mode", type=int, choices=(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10), default=0,
                         help="0: default; 1: breathing; 2: color breathing; 3: single-direction; 4: return; 5: ring; 6: flowing; 7: rainbow flowing; 8: rainbow cycle; 9: rainbow gradient; 10: wave")
    preview.add_argument("--direction", type=int, choices=(0, 1), default=0,
                         help="0: forward; 1: reverse, only valid with full-body effect mode 3 through 10")
    preview.add_argument("--speed", type=parse_speed, default=0,
                         help="0: baseline; 1-100: experimental, only valid with full-body effect mode 3 through 10")
    args = parser.parse_args()
    suffix = datetime.now().astimezone().strftime("%Y%m%dT%H%M%S%z")
    log_path = args.log or Path("logs") / f"demo-{args.operation}-{suffix}-{uuid.uuid4().hex[:8]}.jsonl"
    print(f"Raw event log: {log_path}", flush=True)
    asyncio.run(run(
        args.id, args.operation, log_path,
        list_kind=getattr(args, "list_kind", None),
        target=getattr(args, "target", None),
        rgb=getattr(args, "rgb", None),
        brightness=getattr(args, "brightness", 10),
        effect_mode=getattr(args, "effect_mode", 0),
        direction=getattr(args, "direction", 0),
        speed=getattr(args, "speed", 0),
    ))


if __name__ == "__main__":
    main()
