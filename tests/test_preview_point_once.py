"""Offline checks for the single-point send boundary."""

import argparse
import json
import tempfile
import unittest
from pathlib import Path

from scripts import preview_point_once as point
from scripts import query_light_list as common


class FakeCharacteristic:
    def __init__(self, properties: list[str]) -> None:
        self.properties = properties


class FakeService:
    def __init__(self, writable: bool) -> None:
        self.writable = writable

    def get_characteristic(self, uuid: str) -> FakeCharacteristic | None:
        if uuid == common.WRITE_UUID:
            return FakeCharacteristic(["write-without-response"] if self.writable else ["read"])
        if uuid == common.NOTIFY_UUID:
            return FakeCharacteristic(["notify"])
        return None


class FakeServices:
    def __init__(self, writable: bool) -> None:
        self.writable = writable

    def get_service(self, uuid: str) -> FakeService | None:
        return FakeService(self.writable) if uuid == common.SERVICE_UUID else None


class FakeClient:
    def __init__(self, writable: bool = True) -> None:
        self.services = FakeServices(writable)
        self.writes: list[tuple[str, bytes, bool]] = []
        self.callback = None

    async def __aenter__(self) -> "FakeClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        pass

    async def start_notify(self, _uuid: str, callback: object) -> None:
        self.callback = callback

    async def stop_notify(self, _uuid: str) -> None:
        self.callback = None

    async def write_gatt_char(self, uuid: str, data: bytes, response: bool) -> None:
        self.writes.append((uuid, data, response))
        self.callback(common.NOTIFY_UUID, bytearray.fromhex("CC 33 01"))


class PointTests(unittest.IsolatedAsyncioTestCase):
    def test_point_zero_exact_frame_and_length(self) -> None:
        frame = point.build_preview(0)
        self.assertEqual(len(frame), 14)
        self.assertEqual(common.hex_bytes(frame), "BC 33 01 09 00 01 00 00 FF 00 00 0A 00 55")

    def test_point_index_boundaries(self) -> None:
        self.assertEqual(point.build_preview(39)[6], 39)
        self.assertEqual(point.point_index("0"), 0)
        self.assertEqual(point.point_index("39"), 39)
        for invalid in (-1, 40, True, 1.5):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                point.build_preview(invalid)
        for invalid in ("-1", "40", "abc"):
            with self.subTest(invalid=invalid), self.assertRaises(argparse.ArgumentTypeError):
                point.point_index(invalid)

    async def test_one_write_and_raw_notification(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            client = FakeClient()
            await point.preview("test-id", 0, 1, path, lambda *_args, **_kwargs: client)
            records = [json.loads(line) for line in path.read_text().splitlines()]

        self.assertEqual(client.writes, [(common.WRITE_UUID, point.build_preview(0), False)])
        self.assertEqual([record["hex"] for record in records if record["event"] == "rx"], ["CC 33 01"])
        self.assertEqual(len([record for record in records if record["event"] == "write_api_completed"]), 1)

    async def test_wrong_gatt_prevents_write(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            client = FakeClient(writable=False)
            with self.assertRaisesRegex(RuntimeError, "FFF3"):
                await point.preview("test-id", 0, 1, path, lambda *_args, **_kwargs: client)
            records = [json.loads(line) for line in path.read_text().splitlines()]

        self.assertEqual(client.writes, [])
        self.assertEqual(records[-1]["event"], "error")
        self.assertFalse(any(record["event"] == "tx_attempt" for record in records))


if __name__ == "__main__":
    unittest.main()
