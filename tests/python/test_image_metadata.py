import unittest
from hashlib import sha256
from io import BytesIO

from PIL import Image

from yuksalish_api.image_metadata import image_dimensions


class ImageMetadataTests(unittest.TestCase):
    def test_png_geometry_without_changing_original(self) -> None:
        source = BytesIO()
        Image.new("RGB", (30, 70), "red").save(source, format="PNG")
        content = source.getvalue()
        original = sha256(content).digest()
        self.assertEqual(image_dimensions(content, "image/png"), (30, 70))
        self.assertEqual(sha256(content).digest(), original)

    def test_exif_rotation_matches_browser_orientation(self) -> None:
        source = BytesIO()
        image = Image.new("RGB", (30, 70), "red")
        exif = image.getexif()
        exif[274] = 6
        image.save(source, format="JPEG", exif=exif)
        self.assertEqual(image_dimensions(source.getvalue(), "image/jpeg"), (70, 30))

    def test_unsupported_or_corrupt_files_remain_uploadable(self) -> None:
        for content, mime in [(b"bad", "image/png"), (b"<svg/>", "image/svg+xml"),
                              (b"document", "application/pdf")]:
            self.assertEqual(image_dimensions(content, mime), (None, None))


if __name__ == "__main__":
    unittest.main()
