"""Read geometry only; uploaded originals are never resized or re-encoded."""
import warnings
from io import BytesIO

from PIL import Image, UnidentifiedImageError


def image_dimensions(content: bytes, content_type: str) -> tuple[int | None, int | None]:
    if not content_type.lower().startswith("image/"):
        return None, None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                width, height = image.size
                if image.getexif().get(274) in (5, 6, 7, 8):
                    width, height = height, width
                if 0 < width <= 100_000 and 0 < height <= 100_000:
                    return width, height
    except (OSError, ValueError, UnidentifiedImageError,
            Image.DecompressionBombError, Image.DecompressionBombWarning):
        pass  # Unsupported/corrupt previews do not alter or reject the original file.
    return None, None
