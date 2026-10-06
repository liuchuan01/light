"""Offline protocol and send-boundary tests for the Python demo."""

import argparse
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from model_light import __main__ as demo
from model_light import protocol
from scripts import query_light_list as common


DEVICE_ID = "1BAA3B72-5D5A-32C5-0FD6-4B579EE6566C"


class FakeService:
    def __init__(self, writable: bool = True) -> None:
        self.writable = writable

    def get_characteristic(self, uuid: str):
        if uuid == common.WRITE_UUID:
            return SimpleNamespace(properties=["write-without-response"] if self.writable else ["read"])
        if uuid == common.NOTIFY_UUID:
            return SimpleNamespace(properties=["notify"])
        return None


class FakeServices:
    def __init__(self, writable: bool = True) -> None:
        self.writable = writable

    def get_service(self, uuid: str):
        return FakeService(self.writable) if uuid == common.SERVICE_UUID else None


class FakeClient:
    def __init__(self, device: object, timeout: float, writable: bool = True,
                 enter_failure: bool = False, stop_failure: bool = False) -> None:
        self.device = device
        self.services = FakeServices(writable)
        self.writes = []
        self.callback = None
        self.enter_failure = enter_failure
        self.stop_failure = stop_failure
        self.exited = False
        self.disconnect_called = False

    async def __aenter__(self):
        if self.enter_failure:
            raise RuntimeError("connection failed")
        return self

    async def __aexit__(self, *_args):
        self.exited = True

    async def disconnect(self):
        self.disconnect_called = True

    async def start_notify(self, _uuid, callback):
        self.callback = callback

    async def stop_notify(self, _uuid):
        if self.stop_failure:
            raise RuntimeError("unsubscribe failed")
        self.callback = None

    async def write_gatt_char(self, uuid, data, response):
        self.writes.append((uuid, data, response))
        self.callback(common.NOTIFY_UUID, bytearray.fromhex("CC 33 01"))


async def discover_good(**_kwargs):
    device = SimpleNamespace(address=DEVICE_ID, name="极梦匠")
    advertisement = SimpleNamespace(local_name="极梦匠")
    return {DEVICE_ID: (device, advertisement)}


async def no_pause(_seconds):
    pass


class DemoTests(unittest.IsolatedAsyncioTestCase):
    def test_exact_existing_vectors_and_d_label_mapping(self):
        self.assertEqual(protocol.build_preview("all", (255, 255, 255), 10),
                         bytes.fromhex("BC 43 01 0A 00 01 00 FF FF FF 0A 00 00 00 55"))
        self.assertEqual(protocol.build_preview("all", (255, 0, 0), 10),
                         bytes.fromhex("BC 43 01 0A 00 01 00 FF 00 00 0A 00 00 00 55"))
        self.assertEqual(demo.parse_target("D1"), 0)
        self.assertEqual(demo.parse_target("D23"), 22)
        self.assertEqual(demo.parse_target("D1,D2"), (0, 1))
        self.assertEqual(protocol.build_preview(demo.parse_target("D1"), (255, 0, 0), 10),
                         bytes.fromhex("BC 33 01 09 00 01 00 00 FF 00 00 0A 00 55"))
        self.assertEqual(protocol.build_preview(demo.parse_target("D23"), (255, 0, 0), 10),
                         bytes.fromhex("BC 33 01 09 00 01 16 00 FF 00 00 0A 00 55"))
        self.assertEqual(protocol.build_preview(demo.parse_target("D1,D2"), (255, 0, 0), 10),
                         bytes.fromhex("BC 33 01 0A 00 02 00 01 00 FF 00 00 0A 00 55"))
        self.assertEqual(protocol.build_request("list", list_kind="40"), bytes.fromhex("BC 40 00 00 55"))
        self.assertEqual(protocol.build_preview(0, (255, 0, 0), 10, 1),
                         bytes.fromhex("BC 33 01 09 00 01 00 00 FF 00 00 0A 01 55"))
        self.assertEqual(protocol.build_preview(0, (255, 0, 0), 10, 2),
                         bytes.fromhex("BC 33 01 09 00 01 00 00 FF 00 00 0A 02 55"))
        self.assertEqual(protocol.build_preview("all", (255, 0, 0), 10, 3),
                         bytes.fromhex("BC 43 01 0A 00 01 00 FF 00 00 0A 03 00 00 55"))
        self.assertEqual(protocol.build_preview("all", (255, 0, 0), 10, 3, 1),
                         bytes.fromhex("BC 43 01 0A 00 01 00 FF 00 00 0A 03 01 00 55"))
        self.assertEqual(protocol.build_preview("all", (255, 0, 0), 10, 3, 0, 50),
                         bytes.fromhex("BC 43 01 0A 00 01 00 FF 00 00 0A 03 00 32 55"))
        self.assertEqual(protocol.build_preview("all", (255, 0, 0), 10, 4),
                         bytes.fromhex("BC 43 01 0A 00 01 00 FF 00 00 0A 04 00 00 55"))
        self.assertEqual(protocol.build_preview("all", (255, 0, 0), 10, 5),
                         bytes.fromhex("BC 43 01 0A 00 01 00 FF 00 00 0A 05 00 00 55"))
        self.assertEqual(protocol.build_preview("all", (255, 0, 0), 10, 6),
                         bytes.fromhex("BC 43 01 0A 00 01 00 FF 00 00 0A 06 00 00 55"))
        self.assertEqual(protocol.build_preview("all", (255, 0, 0), 10, 7),
                         bytes.fromhex("BC 43 01 0A 00 01 00 FF 00 00 0A 07 00 00 55"))
        self.assertEqual(protocol.build_preview("all", (255, 0, 0), 10, 8),
                         bytes.fromhex("BC 43 01 0A 00 01 00 FF 00 00 0A 08 00 00 55"))
        self.assertEqual(protocol.build_preview("all", (255, 0, 0), 10, 9),
                         bytes.fromhex("BC 43 01 0A 00 01 00 FF 00 00 0A 09 00 00 55"))
        self.assertEqual(protocol.build_preview("all", (255, 0, 0), 10, 10),
                         bytes.fromhex("BC 43 01 0A 00 01 00 FF 00 00 0A 0A 00 00 55"))

    def test_restricted_parameters(self):
        for value in ("D0", "D24", "d1", "23", "D1,D1"):
            with self.subTest(target=value), self.assertRaises(argparse.ArgumentTypeError):
                demo.parse_target(value)
        for value in ("0", "11", "1.5"):
            with self.subTest(brightness=value), self.assertRaises(argparse.ArgumentTypeError):
                demo.parse_brightness(value)
        with self.assertRaises(argparse.ArgumentTypeError):
            demo.parse_rgb("FF000000")
        with self.assertRaises(ValueError):
            protocol.build_request("save")
        with self.assertRaises(ValueError):
            protocol.build_preview(23, (255, 0, 0), 10)
        with self.assertRaises(ValueError):
            protocol.build_preview((0, 0), (255, 0, 0), 10)
        with self.assertRaises(ValueError):
            protocol.build_preview(0, (255, 0, 0), 10, 6)
        with self.assertRaises(ValueError):
            protocol.build_preview(0, (255, 0, 0), 10, 3)
        with self.assertRaises(ValueError):
            protocol.build_preview("all", (255, 0, 0), 10, 1, 1)
        with self.assertRaises(ValueError):
            protocol.build_preview("all", (255, 0, 0), 10, 1, 0, 50)

    async def test_scan_does_not_connect(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "scan.jsonl"
            await demo.run(DEVICE_ID, "scan", path, discoverer=discover_good,
                           client_factory=lambda *_args, **_kwargs: self.fail("scan connected"))
            records = [json.loads(line) for line in path.read_text().splitlines()]
        self.assertEqual([record["event"] for record in records], ["start", "device_matched", "scan_completed"])

    async def test_one_preview_write_and_raw_notification(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "preview.jsonl"
            clients = []

            def factory(device, timeout):
                client = FakeClient(device, timeout)
                clients.append(client)
                return client

            await demo.run(DEVICE_ID, "preview", path, target=0, rgb=(255, 0, 0),
                           discoverer=discover_good, client_factory=factory, pause=no_pause)
            records = [json.loads(line) for line in path.read_text().splitlines()]
        self.assertEqual(len(clients), 1)
        self.assertEqual(clients[0].writes,
                         [(common.WRITE_UUID, bytes.fromhex("BC 33 01 09 00 01 00 00 FF 00 00 0A 00 55"), False)])
        self.assertEqual([record["hex"] for record in records if record["event"] == "rx"], ["CC 33 01"])
        self.assertEqual(len([record for record in records if record["event"] == "write_api_completed"]), 1)
        self.assertTrue(clients[0].exited)

    async def test_bad_gatt_or_wrong_name_never_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gatt.jsonl"
            client = FakeClient(None, 15, writable=False)
            with self.assertRaisesRegex(RuntimeError, "FFF3"):
                await demo.run(DEVICE_ID, "list", path, list_kind="30",
                               discoverer=discover_good, client_factory=lambda *_args, **_kwargs: client)
            self.assertEqual(client.writes, [])
            self.assertTrue(client.exited)

            async def wrong_name(**_kwargs):
                device = SimpleNamespace(address=DEVICE_ID, name="other")
                return {DEVICE_ID: (device, SimpleNamespace(local_name="other"))}

            with self.assertRaisesRegex(RuntimeError, "name was not"):
                await demo.run(DEVICE_ID, "scan", Path(tmp) / "wrong.jsonl", discoverer=wrong_name,
                               client_factory=lambda *_args, **_kwargs: self.fail("wrong device connected"))

            async def wrong_id(**_kwargs):
                device = SimpleNamespace(address="00000000-0000-0000-0000-000000000001", name="极梦匠")
                return {device.address: (device, SimpleNamespace(local_name="极梦匠"))}

            with self.assertRaisesRegex(RuntimeError, "not found"):
                await demo.run(DEVICE_ID, "scan", Path(tmp) / "wrong-id.jsonl", discoverer=wrong_id,
                               client_factory=lambda *_args, **_kwargs: self.fail("wrong ID connected"))

    async def test_invalid_preview_input_rejected_before_scan(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name, target, brightness in (("point", 23, 10), ("brightness", 0, 11)):
                with self.subTest(name=name):
                    path = Path(tmp) / f"{name}.jsonl"
                    with self.assertRaises(ValueError):
                        await demo.run(DEVICE_ID, "preview", path, target=target, rgb=(255, 0, 0),
                                       brightness=brightness,
                                       discoverer=lambda **_kwargs: self.fail("invalid preview scanned"))
                    self.assertFalse(path.exists())

    async def test_disconnect_after_unsubscribe_or_connection_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            unsubscribe_client = FakeClient(None, 15, stop_failure=True)
            with self.assertRaisesRegex(RuntimeError, "unsubscribe failed"):
                await demo.run(DEVICE_ID, "preview", Path(tmp) / "unsubscribe.jsonl",
                               target="all", rgb=(255, 255, 255), discoverer=discover_good,
                               client_factory=lambda *_args, **_kwargs: unsubscribe_client, pause=no_pause)
            self.assertTrue(unsubscribe_client.exited)

            failed_client = FakeClient(None, 15, enter_failure=True)
            with self.assertRaisesRegex(RuntimeError, "connection failed"):
                await demo.run(DEVICE_ID, "list", Path(tmp) / "connect.jsonl", list_kind="40",
                               discoverer=discover_good,
                               client_factory=lambda *_args, **_kwargs: failed_client)
            self.assertTrue(failed_client.disconnect_called)
            self.assertEqual(failed_client.writes, [])


if __name__ == "__main__":
    unittest.main()
