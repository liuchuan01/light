"""Restricted packet builders for currently observed temporary preview paths.

The frame layout has fixed colorType=0.
Effect modes 1–10 are exposed only for controlled dynamic previews.
"""

LIST_FRAMES = {
    "40": bytes.fromhex("BC 40 00 00 55"),
    "30": bytes.fromhex("BC 30 00 00 55"),
    "50": bytes.fromhex("BC 50 00 00 55"),
}
MAX_POINT_INDEX = 22
MIN_BRIGHTNESS = 1
MAX_BRIGHTNESS = 10


def build_preview(target: str | int | tuple[int, ...], rgb: tuple[int, int, int], brightness: int,
                  effect_mode: int = 0, direction: int = 0, speed: int = 0) -> bytes:
    if not isinstance(rgb, tuple) or len(rgb) != 3 or any(
        not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 255
        for value in rgb
    ):
        raise ValueError("RGB must contain exactly three bytes")
    if not isinstance(brightness, int) or isinstance(brightness, bool) or not MIN_BRIGHTNESS <= brightness <= MAX_BRIGHTNESS:
        raise ValueError("brightness must be an integer from 1 to 10")
    if effect_mode not in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10) or isinstance(effect_mode, bool):
        raise ValueError("effect mode must be from 0 through 10")
    if direction not in (0, 1) or isinstance(direction, bool):
        raise ValueError("direction must be 0 or 1")
    if direction and effect_mode not in (3, 4, 5, 6, 7, 8, 9, 10):
        raise ValueError("direction 1 is limited to effect mode 3 through 10")
    if not isinstance(speed, int) or isinstance(speed, bool) or not 0 <= speed <= 100:
        raise ValueError("speed must be an integer from 0 to 100")
    if speed and effect_mode not in (3, 4, 5, 6, 7, 8, 9, 10):
        raise ValueError("nonzero speed is limited to effect mode 3 through 10")
    if effect_mode in (3, 4, 5, 6, 7, 8, 9, 10) and target != "all":
        raise ValueError("effect modes 3 through 10 are limited to the full-body target")
    if target == "all":
        # 43: slot 0, enabled, single RGB, brightness, effectMode, direction, speed.
        return bytes.fromhex("BC 43 01 0A 00 01 00") + bytes(rgb) + bytes([brightness, effect_mode, direction, speed, 0x55])
    points = (target,) if isinstance(target, int) and not isinstance(target, bool) else target
    if isinstance(points, tuple) and 1 <= len(points) <= MAX_POINT_INDEX + 1 and all(
        isinstance(point, int) and not isinstance(point, bool) and 0 <= point <= MAX_POINT_INDEX
        for point in points
    ) and len(set(points)) == len(points):
        # 33: slot 0, point count, selected protocol points, colorType 0, RGB, brightness, effectMode.
        payload = bytes([0, len(points), *points, 0, *rgb, brightness, effect_mode])
        return bytes([0xBC, 0x33, 0x01, len(payload)]) + payload + bytes([0x55])
    raise ValueError("target must be all or one or more distinct D1-D23 protocol points")


def build_request(kind: str, *, list_kind: str | None = None,
                  target: str | int | tuple[int, ...] | None = None,
                  rgb: tuple[int, int, int] | None = None,
                  brightness: int = 10, effect_mode: int = 0,
                  direction: int = 0, speed: int = 0) -> bytes:
    if kind == "list" and list_kind in LIST_FRAMES:
        return LIST_FRAMES[list_kind]
    if kind == "preview" and target is not None and rgb is not None:
        return build_preview(target, rgb, brightness, effect_mode, direction, speed)
    raise ValueError("unsupported command")
