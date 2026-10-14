"""Regenerate desktop and browser icons from the owner-provided square PNG.

Run from the repository root with the project Python environment.
"""

from pathlib import Path

from PIL import Image

DESKTOP = Path(__file__).resolve().parents[1]
SOURCE = DESKTOP / "build" / "app-icon-source.png"


def main() -> None:
    with Image.open(SOURCE) as original:
        source = original.convert("RGBA")
    if source.width != source.height or source.width < 512:
        raise ValueError("App icon source must be square and at least 512 pixels")

    def resized(size: int) -> Image.Image:
        return source.resize((size, size), Image.Resampling.LANCZOS)

    (DESKTOP / "build").mkdir(exist_ok=True)
    (DESKTOP / "public").mkdir(exist_ok=True)
    resized(256).save(
        DESKTOP / "build" / "app-icon.ico",
        format="ICO",
        sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)],
    )
    resized(256).save(
        DESKTOP / "public" / "favicon.ico",
        format="ICO",
        sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)],
    )
    for size in (192, 512):
        resized(size).save(DESKTOP / "public" / f"app-icon-{size}.png")


if __name__ == "__main__":
    main()
