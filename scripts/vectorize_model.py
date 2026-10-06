"""Generate native SVG paths from the supplied Unicorn drawing and point map.

Optional authoring dependencies, not runtime dependencies:
  uv run --with opencv-python-headless --with pillow python scripts/vectorize_model.py
The PNG originals are read-only. No raster pixels are embedded in the SVG output.
"""

import hashlib
import json
from pathlib import Path
from xml.sax.saxutils import escape

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "desktop/src/assets"


def paths(mask, min_area=1.5, epsilon=0.35, external=False):
    mode = cv2.RETR_EXTERNAL if external else cv2.RETR_LIST
    contours, _ = cv2.findContours(mask.astype(np.uint8) * 255, mode, cv2.CHAIN_APPROX_SIMPLE)
    result = []
    for contour in contours:
        if cv2.contourArea(contour) < min_area:
            continue
        simplified = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
        if len(simplified) >= 3:
            result.append("M" + " L".join(f"{x} {y}" for x, y in simplified) + " Z")
    return " ".join(result)


def generate():
    source = ROOT / "docs/unicorn1.png"
    annotated = ROOT / "docs/unicorn2.png"
    rgb = np.asarray(Image.open(source).convert("RGB"))
    marks = np.asarray(Image.open(annotated).convert("RGB"))
    if rgb.shape != marks.shape or rgb.shape[:2] != (681, 844):
        raise ValueError("Source dimensions changed; recalibrate mapping first")
    mapping = json.loads((ROOT / "docs/unicorn-light-map.json").read_text())
    if {point["id"] for point in mapping["points"]} != {f"D{i}" for i in range(1, 24)} or len(mapping["points"]) != 23:
        raise ValueError("Expected exactly D1–D23")

    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    valid = np.ones(gray.shape, dtype=bool)
    valid[648:, 750:] = False  # Exclude the printed footer; attribution remains in metadata/docs.
    silhouette_mask = cv2.morphologyEx(((gray < 195) & valid).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    silhouette = paths(silhouette_mask, min_area=500, epsilon=0.6, external=True)
    # Filled contour sets use evenodd so enclosed paper/armor stays open.
    shading = paths((gray < 184) & valid, min_area=5, epsilon=0.55)
    linework = paths((gray < 135) & valid, min_area=2, epsilon=0.3)
    body = (
        f'<path fill="#8b9999" stroke="#b0c1c1" stroke-width=".65" d="{silhouette}"/>'
        f'<path fill="#435960" fill-opacity=".72" fill-rule="evenodd" d="{shading}"/>'
        f'<path fill="#152a32" fill-opacity=".8" fill-rule="evenodd" d="{linework}"/>'
    )
    header = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 844 681" width="844" height="681">'
    metadata = '<title>Unicorn Gundam — traced front and rear drawing</title><desc>Vector trace of user-supplied docs/unicorn1.png. Original drawing bears SUNRISE attribution. Not an official CAD drawing.</desc>'
    ASSETS.mkdir(parents=True, exist_ok=True)
    (ASSETS / "unicorn-linework.svg").write_text(header + metadata + body + '</svg>\n')

    r, g, b = rgb.astype(float).transpose(2, 0, 1)
    red = (r > g * 1.18) & (r > b * 1.13) & (r - g > 18) & (r > 65) & (r < 225)
    red = cv2.morphologyEx(red.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    regions = []
    review = []
    for point in mapping["points"]:
        region = {key: value for key, value in point.items() if key != "bounds"}
        if "bounds" in point:
            x1, y1, x2, y2 = point["bounds"]
            mask = np.zeros_like(red)
            mask[y1:y2, x1:x2] = red[y1:y2, x1:x2]
            region["path"] = paths(mask, min_area=8, epsilon=0.4)
            region["geometry"] = "traced"
        if not region["path"]:
            raise ValueError(f"Empty emitting region: {point['id']}")
        regions.append(region)
        label_x, label_y = point["label"]
        ax, ay = point["anchor"]
        review.append(f'<g id="{point["id"]}"><title>{escape(point["id"] + " " + point["name"])}</title><path d="{region["path"]}" fill="#69e3bd" stroke="#b3ffe4" stroke-width=".65"/><path d="M{ax} {ay} L{label_x} {label_y}" fill="none" stroke="#789394" stroke-width=".7"/><rect x="{label_x-17}" y="{label_y-9}" width="34" height="18" rx="5" fill="#17272d" stroke="#5e8887" stroke-width=".7"/><text x="{label_x}" y="{label_y+3.5}" text-anchor="middle" font-size="10" font-family="sans-serif" fill="#dcfff2">{point["id"]}</text></g>')
    output = {"viewBox": "0 0 844 681", "source": "docs/unicorn2.png", "regions": regions}
    (ASSETS / "unicorn-regions.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    review_header = header + metadata + '<rect width="844" height="681" fill="#141e23"/>'
    (ROOT / "docs/unicorn-map.svg").write_text(review_header + body + ''.join(review) + '</svg>\n')
    print(json.dumps({
        "source_dimensions": [844, 681],
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "annotated_sha256": hashlib.sha256(annotated.read_bytes()).hexdigest(),
        "changed_pixel_fraction": round(float(np.mean(np.max(np.abs(rgb.astype(float) - marks.astype(float)), axis=2) > 10)), 5),
        "points": len(regions), "front": sum(point["view"] == "front" for point in regions),
        "back": sum(point["view"] == "back" for point in regions),
        "schematic_regions": [point["id"] for point in regions if point["geometry"] == "schematic"],
        "linework_bytes": (ASSETS / "unicorn-linework.svg").stat().st_size,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    generate()
