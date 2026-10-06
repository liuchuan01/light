"""Offline checks for batch limits, speech ordering, and the BLE send boundary."""

import json
import tempfile
import unittest
from pathlib import Path

from scripts import preview_point_batch as batch
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
    def __init__(self, events: list[tuple], writable: bool = True) -> None:
        self.services = FakeServices(writable)
        self.events = events
        self.writes: list[bytes] = []
        self.callback = None

    async def __aenter__(self) -> "FakeClient":
        self.events.append(("connect",))
        return self

    async def __aexit__(self, *_: object) -> None:
        self.events.append(("disconnect",))

    async def start_notify(self, _uuid: str, callback: object) -> None:
        self.callback = callback

    async def stop_notify(self, _uuid: str) -> None:
        self.callback = None

    async def write_gatt_char(self, uuid: str, data: bytes, response: bool) -> None:
        assert uuid == common.WRITE_UUID and response is False
        self.writes.append(data)
        self.events.append(("write", data[6]))
        self.callback(common.NOTIFY_UUID, bytearray.fromhex("CC 33 01"))


def fake_executable(directory: str) -> Path:
    path = Path(directory) / "say"
    path.write_text("#!/bin/sh\necho 'Tingting zh_CN # test voice'\nexit 0\n")
    path.chmod(0o755)
    return path


class BatchTests(unittest.IsolatedAsyncioTestCase):
    def test_eight_point_limit_and_bounds(self) -> None:
        batch.validate_range(0, 7)
        batch.validate_range(32, 39)
        for start, end in ((0, 8), (-1, 0), (39, 40), (2, 1)):
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                batch.validate_range(start, end)

    async def test_order_count_bytes_and_raw_log(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            events: list[tuple] = []
            client = FakeClient(events)
            speech_path = fake_executable(tmp)
            log_path = Path(tmp) / "events.jsonl"

            async def speaker(index: int, _path: Path) -> None:
                events.append(("say", index))

            async def pause(seconds: float) -> None:
                self.assertEqual(seconds, 4.0)
                events.append(("pause",))

            await batch.preview_batch(
                "test-id", 0, 7, log_path, say_path=speech_path,
                client_factory=lambda *_args, **_kwargs: client,
                speaker=speaker, pause=pause,
            )
            records = [json.loads(line) for line in log_path.read_text().splitlines()]

        self.assertEqual(client.writes, [point.build_preview(i) for i in range(8)])
        self.assertEqual(events, [("connect",)] + [item for i in range(8)
                         for item in (("say", i), ("write", i), ("pause",))] + [("disconnect",)])
        self.assertEqual([record["point_index"] for record in records if record["event"] == "tx_attempt"], list(range(8)))
        self.assertEqual([record["point_index"] for record in records if record["event"] == "rx"], list(range(8)))
        self.assertEqual([record["hex"] for record in records if record["event"] == "rx"], ["CC 33 01"] * 8)
        self.assertTrue(all("time" in record for record in records))

    async def test_bad_gatt_and_missing_say_prevent_write(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "events.jsonl"
            client = FakeClient([], writable=False)
            missing_say = Path(tmp) / "missing-say"
            with self.assertRaisesRegex(RuntimeError, "speech command unavailable"):
                await batch.preview_batch("test-id", 0, 0, log_path, say_path=missing_say,
                                          client_factory=lambda *_args, **_kwargs: client)
            self.assertFalse(log_path.exists())
            wrong_voice = Path(tmp) / "wrong-voice"
            wrong_voice.write_text("#!/bin/sh\necho 'Alex en_US # test voice'\n")
            wrong_voice.chmod(0o755)
            with self.assertRaisesRegex(RuntimeError, "Tingting Chinese voice unavailable"):
                await batch.preview_batch("test-id", 0, 0, log_path, say_path=wrong_voice,
                                          client_factory=lambda *_args, **_kwargs: client)
            self.assertFalse(log_path.exists())

            async def speaker(_index: int, _path: Path) -> None:
                pass

            with self.assertRaisesRegex(RuntimeError, "FFF3"):
                await batch.preview_batch("test-id", 0, 0, log_path, say_path=fake_executable(tmp),
                                          client_factory=lambda *_args, **_kwargs: client, speaker=speaker)
            self.assertEqual(client.writes, [])

    async def test_speech_failure_stops_before_next_point(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient([])

            async def speaker(index: int, _path: Path) -> None:
                if index == 1:
                    raise RuntimeError("speech failed")

            async def pause(_seconds: float) -> None:
                pass

            with self.assertRaisesRegex(RuntimeError, "speech failed"):
                await batch.preview_batch("test-id", 0, 2, Path(tmp) / "events.jsonl",
                                          say_path=fake_executable(tmp),
                                          client_factory=lambda *_args, **_kwargs: client,
                                          speaker=speaker, pause=pause)
            self.assertEqual(client.writes, [point.build_preview(0)])


if __name__ == "__main__":
    unittest.main()
