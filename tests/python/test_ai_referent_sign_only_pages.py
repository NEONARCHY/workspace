"""One physical page per PDF, and no partial publication on signature failure."""

import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from zipfile import ZipFile

import pytest


@pytest.fixture
def signer(tmp_path: Path, monkeypatch):
    fitz = pytest.importorskip("fitz")
    root = Path(__file__).resolve().parents[2]
    monkeypatch.syspath_prepend(str(root / "integrations/exat"))
    from workspace_integration.sign_only import sign_document_pages

    draft = tmp_path / "two-letters.docx"
    with ZipFile(draft, "w") as package:
        package.writestr("word/document.xml", "<document/>")
    signature = tmp_path / "test-signature.png"
    signature.write_bytes(b"synthetic-test-only")
    facsimile = SimpleNamespace(
        enabled=True,
        _resolve_signature_image=lambda _name: signature,
        signature_width_points=155,
        signature_vertical_offset_points=8,
    )
    core = ModuleType("src")
    outgoing = ModuleType("src.outgoing")
    fake = ModuleType("src.outgoing.facsimile")

    def convert(_source, target, *, require_word):
        assert require_word
        with fitz.open() as pdf:
            for number in range(2):
                page = pdf.new_page()
                page.insert_text(
                    (72, 72), f"Letter {number + 1} requires a signature on this page."
                )
            pdf.save(target)

    fake._convert_docx_to_pdf = convert
    fake._stamp_pdf_signature = lambda *_args, **_kwargs: (True, None)
    monkeypatch.setitem(sys.modules, "src", core)
    monkeypatch.setitem(sys.modules, "src.outgoing", outgoing)
    monkeypatch.setitem(sys.modules, "src.outgoing.facsimile", fake)
    return sign_document_pages, facsimile, draft, tmp_path, fake, fitz


def test_one_pdf_per_page_without_exat_send(signer):
    sign_document_pages, facsimile, draft, folder, _fake, fitz = signer
    results = sign_document_pages(facsimile, draft, folder / "signed", "Approver")
    assert [path.name for path in results] == ["001.pdf", "002.pdf"]
    for path in results:
        with fitz.open(path) as pdf:
            assert len(pdf) == 1


def test_failed_page_publishes_nothing(signer):
    sign_document_pages, facsimile, draft, folder, fake, _fitz = signer
    calls = 0

    def fail_second(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return (calls == 1, None if calls == 1 else "unsafe")

    fake._stamp_pdf_signature = fail_second
    from workspace_integration.client import WorkspaceError

    with pytest.raises(WorkspaceError):
        sign_document_pages(facsimile, draft, folder / "signed", "Approver")
    assert not list((folder / "signed").glob("*.pdf"))
