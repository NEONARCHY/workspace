"""Freeze and resize Google's CC BY 4.0 animated Noto reaction artwork.

Run from the repository root with Python 3.11 and Pillow with WebP support.
Only the existing server-approved catalog is downloaded; nothing loads from
Google at runtime. The manifest records original hashes and local adaptations.
"""
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps/desktop/public/emoji/noto"
SOURCE = ROOT / "apps/desktop/src/renderer/reaction-catalog.ts"


def prepare(emoji: str) -> tuple[str, dict[str, object] | None]:
    code = "-".join(f"{ord(c):x}" for c in emoji if c != "\ufe0f")
    url = f"https://fonts.gstatic.com/s/e/notoemoji/latest/{code}/512.webp"
    try:
        with urlopen(url, timeout=45) as response:
            source = response.read(8 * 1024 * 1024 + 1)
    except HTTPError as error:
        if error.code == 404:
            return code, None
        raise
    if len(source) > 8 * 1024 * 1024:
        raise ValueError(f"Oversized source: {code}")
    image = Image.open(BytesIO(source))
    if image.format != "WEBP" or image.size != (512, 512):
        raise ValueError(f"Unexpected source: {code}")
    if getattr(image, "n_frames", 1) < 2:
        return code, None
    frames: list[Image.Image] = []
    times: list[int] = []
    elapsed = 0
    for index in range(image.n_frames):
        image.seek(index)
        # Decoding populates each WebP frame's duration.
        image.load()
        duration = int(image.info.get("duration", 40))
        # Preserve native timing (usually 30 ms in these WebP sources); dropping frames made
        # smooth source motion look choppy even when the UI rendered at 60 Hz.
        frames.append(image.convert("RGBA").resize((64, 64), Image.Resampling.LANCZOS))
        times.append(elapsed)
        elapsed += duration
    durations = [b - a for a, b in zip(times, [*times[1:], elapsed], strict=True)]
    still_path = OUT / f"{code}-still.webp"
    animation_path = OUT / f"{code}.webp"
    frames[0].save(still_path, "WEBP", lossless=True, method=6)
    frames[0].save(animation_path, "WEBP", save_all=True, append_images=frames[1:],
                   duration=durations, loop=0, quality=78, method=4, minimize_size=True)
    animation = animation_path.read_bytes()
    print(f"{code}: {len(frames)} frames / {len(animation)} bytes", flush=True)
    return code, {"source": url, "sourceSha256": sha256(source).hexdigest(),
                  "sha256": sha256(animation).hexdigest(), "bytes": len(animation),
                  "frames": len(frames), "durationMs": elapsed,
                  "minFrameMs": min(durations), "maxFrameMs": max(durations)}


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    groups = re.findall(r'entries: "([^"]+)"', SOURCE.read_text(encoding="utf-8"))
    emojis = [entry.split("|")[0] for group in groups for entry in group.split(";")]
    if len(emojis) != 120 or len(set(emojis)) != 120:
        raise ValueError("Review the server-approved reaction catalog before updating assets")
    if "--catalog-only" in sys.argv:
        entries = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    else:
        with ThreadPoolExecutor(max_workers=4) as pool:
            entries = dict(pool.map(prepare, emojis))
    (OUT / "manifest.json").write_text(json.dumps(entries, indent=2) + "\n", encoding="utf-8")
    (SOURCE.parent / "animated-reactions.json").write_text(
        json.dumps([code for code, entry in entries.items() if entry is not None], indent=2)
        + "\n", encoding="utf-8")
    license_path = ROOT / "apps/desktop/public/licenses"
    (license_path / "Noto-Animated-Emoji-CC-BY-4.0.txt").write_bytes(
        (license_path / "Twemoji-CC-BY-4.0.txt").read_bytes())
    supported = sum(value is not None for value in entries.values())
    print(f"Animated {supported}/{len(entries)}; unavailable entries retain static Twemoji.")
