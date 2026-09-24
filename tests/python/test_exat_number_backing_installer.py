"""The update must preserve the text anchor while widening only the backing."""
import importlib
from pathlib import Path

import pytest


def test_mask_patch_is_idempotent_and_keeps_number_position(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "scripts"))
    installer = importlib.import_module("install_exat_workspace")
    source = (
        "def insert(document):\n"
        "        shape = document.Shapes.AddTextbox(1, 82, 126, 245, 27)\n"
        "        if shape:\n"
        "            shape.TextFrame.MarginLeft = 0\n"
        "            page.draw_rect(rect, color=None, fill=(1, 1, 1), overlay=True)\n"
    )
    patched = installer.patch_number_backing(source)
    assert "AddTextbox(1, 44, 126, 283, 27)" in patched
    assert "MarginLeft = 38" in patched
    assert "fitz.Rect(min(rect.x0, 44), rect.y0, rect.x1, rect.y1)" in patched
    assert installer.patch_number_backing(patched) == patched
    with pytest.raises(ValueError):
        installer.patch_number_backing("def unknown():\n    pass\n")
