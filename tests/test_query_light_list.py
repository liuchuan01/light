"""Offline tests for the list-query send boundary and raw-event record."""

import json
import tempfile
import unittest
from pathlib import Path

from scripts import query_light_list as query


class Characteristic:
    def __init__(self, properties: list[str]) -> None:
        self.properties = properties


class Service:
    def __init__(self, writable: bool = True) -> None:
        self.characteristics = {
            query.WRITE_UUID: Characteristic(["write-without-response"] if writable else ["read"]),
            query.NOTIFY_UUID: Characteristic(["notify"]),
        }

    def get_characteristic(self, uuid: str) -> Characteristic | None:
        return self.characteristics.get(uuid)


class Services:
    def __init__(self, writable: bool = True) -> None:
        self.service = Service(writable)

    def get_service(self, uuid: str) -> Service | None:
        return self.service if uuid == query.SERVICE_UUID else None


class FakeClient:
    def __init__(self, identifier: str, timeout: float, writable: bool = True) -> None:
        self.identifier = identifier
        self.services = Services(writable)
        self.writes: list[tuple[str, bytes, bool]] = []
        self.notification_callback = None

    async def __aenter__(self) -> "FakeClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        pass

    async def start_notify(self, uuid: str, callback: object) -> None:
        self.notification_callback = callback

    async def stop_notify(self, uuid: str) -> None:
        self.notification_callback = None

    async def write_gatt_char(self, uuid: str, data: bytes, response: bool) -> None:
        self.writes.append((uuid, data, response))
        # Preserve one complete and one incomplete notification as distinct RX events.
        self.notification_callback(query.NOTIFY_UUID, bytearray.fromhex("CC 30 00 00 55"))
        self.notification_callback(query.NOTIFY_UUID, bytearray.fromhex("CC 30 00"))


class QueryTests(unittest.IsolatedAsyncioTestCase):
    async def test_single_allowlisted_write_and_unmodified_notifications(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            client = FakeClient("test-id", 15)
            await query.query("test-id", "30", 1, path, lambda *_args, **_kwargs: client)
            records = [json.loads(line) for line in path.read_text().splitlines()]

        self.assertEqual(client.writes, [(query.WRITE_UUID, query.REQUESTS["30"], False)])
        self.assertEqual([record["hex"] for record in records if record["event"] == "rx"],
                         ["CC 30 00 00 55", "CC 30 00"])
        self.assertEqual(len([record for record in records if record["event"] == "write_api_completed"]), 1)
        self.assertTrue(all(record["device_id"] == "test-id" for record in records))

    async def test_wrong_gatt_properties_prevent_write(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            client = FakeClient("test-id", 15, writable=False)
            with self.assertRaisesRegex(RuntimeError, "FFF3"):
                await query.query("test-id", "50", 1, path, lambda *_args, **_kwargs: client)
            records = [json.loads(line) for line in path.read_text().splitlines()]

        self.assertEqual(client.writes, [])
        self.assertEqual(records[-1]["event"], "error")
        self.assertFalse(any(record["event"] == "tx_attempt" for record in records))

    async def test_rejects_invalid_command_and_wait_before_connecting(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            with self.assertRaises(ValueError):
                await query.query("test-id", "43", 1, path)
            with self.assertRaises(ValueError):
                await query.query("test-id", "40", 0, path)
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
