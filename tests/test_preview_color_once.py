"""Offline checks for the constrained color preview."""

import json
import tempfile
import unittest
from pathlib import Path

from scripts import preview_color_once as color
from scripts import query_light_list as common


class FakeCharacteristic:
    def __init__(self, properties: list[str]) -> None:
        self.properties = properties


class FakeService:
    def get_characteristic(self, uuid: str) -> FakeCharacteristic | None:
        if uuid == common.WRITE_UUID:
            return FakeCharacteristic(["write-without-response"])
        if uuid == common.NOTIFY_UUID:
            return FakeCharacteristic(["notify"])
        return None


class FakeServices:
    def get_service(self, uuid: str) -> FakeService | None:
        return FakeService() if uuid == common.SERVICE_UUID else None


class FakeClient:
    def __init__(self, *_args: object, **_kwargs: object) -> None:
        self.services = FakeServices()
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
        self.callback(common.NOTIFY_UUID, bytearray.fromhex("CC 43 01"))


class PreviewTests(unittest.IsolatedAsyncioTestCase):
    def test_red_differs_from_verified_white_only_in_g_and_b(self) -> None:
        white = color.PREVIEWS["white"]
        red = color.PREVIEWS["red"]
        self.assertEqual(len(white), 15)
        self.assertEqual(len(red), 15)
        self.assertEqual([(i, white[i], red[i]) for i in range(15) if white[i] != red[i]],
                         [(8, 255, 0), (9, 255, 0)])
        self.assertEqual(red[10], 0x0A)

    async def test_one_red_write_and_raw_short_notification(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            client = FakeClient()
            await color.preview("test-id", "red", 1, path, lambda *_args, **_kwargs: client)
            records = [json.loads(line) for line in path.read_text().splitlines()]

        self.assertEqual(client.writes, [(common.WRITE_UUID, color.PREVIEWS["red"], False)])
        self.assertEqual([record["hex"] for record in records if record["event"] == "rx"], ["CC 43 01"])
        self.assertEqual(len([record for record in records if record["event"] == "write_api_completed"]), 1)

    async def test_unknown_color_rejected_before_log_or_connection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            with self.assertRaises(ValueError):
                await color.preview("test-id", "green", 1, path)
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
