"""Synthetic letterheads only: preserve original contents, geometry and real page breaks."""

import base64
import importlib.util
import os
import subprocess
from io import BytesIO
from pathlib import Path
from types import ModuleType
from zipfile import ZipFile

import pytest
from defusedxml import ElementTree as XML
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"w": W, "wp": WP}
LINES = 28


@pytest.fixture
def normalizer() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "letterhead_preview", ROOT / "services/office-preview/docx_letterhead.py",
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def package(parts: dict[str, bytes]) -> bytes:
    result = BytesIO()
    with ZipFile(result, "w") as archive:
        for name, content in parts.items():
            archive.writestr(name, content)
    return result.getvalue()


def parts(content: bytes) -> dict[str, bytes]:
    with ZipFile(BytesIO(content)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def synthetic_letter() -> dict[str, bytes]:
    def decoration(footer: bool) -> bytes:
        tag = "ftr" if footer else "hdr"
        height = 1202120 if footer else 1903357
        return f'''<w:{tag} xmlns:w="{W}" xmlns:wp="{WP}" xmlns:r="{R}"
          xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:mc="urn:test:compat" mc:Ignorable="unused"
          xmlns:unused="urn:test:unused">
          <w:p><w:pPr><w:ind w:left="-2211"/></w:pPr><w:r><w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="7560000" cy="{height}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>
          <wp:docPr id="1" name="Synthetic letterhead"/><wp:cNvGraphicFramePr/>
          <a:graphic><a:graphicData uri="{PIC}"><pic:pic><pic:nvPicPr>
          <pic:cNvPr id="0" name="Synthetic image"/><pic:cNvPicPr/></pic:nvPicPr>
          <pic:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
          <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="7560000" cy="{height}"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
          </a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:{tag}>'''.encode()

    body_lines = "".join(
        f"<w:t>Recorded report line {i:02d}. Content must remain intact.</w:t><w:br/>"
        for i in range(LINES)
    )
    document = f'''<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>
      <w:tbl><w:tblPr><w:tblpPr w:horzAnchor="margin" w:tblpY="-420"/>
      <w:tblW w:w="9354" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="9354"/>
      </w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="9354" w:type="dxa"/></w:tcPr>
      {"<w:p/>" * 6}<w:p><w:r><w:t>Recipient</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p><w:r>{body_lines}</w:r></w:p><w:p/><w:p><w:r><w:t>Signature</w:t></w:r></w:p>
      <w:sectPr><w:headerReference w:type="default" r:id="header"/>
      <w:footerReference w:type="default" r:id="footer"/>
      <w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="851"
      w:bottom="1134" w:left="1701" w:header="0" w:footer="0" w:gutter="0"/>
      </w:sectPr></w:body></w:document>'''.encode()
    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml"
    content_types = f'''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels"
        ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="png" ContentType="image/png"/>
      <Override PartName="/word/document.xml" ContentType="{mime}.document.main+xml"/>
      <Override PartName="/word/styles.xml" ContentType="{mime}.styles+xml"/>
      <Override PartName="/word/header1.xml" ContentType="{mime}.header+xml"/>
      <Override PartName="/word/footer1.xml" ContentType="{mime}.footer+xml"/>
      </Types>'''.encode()
    document_rels = f'''<Relationships xmlns="{REL}">
      <Relationship Id="header" Type="{R}/header" Target="header1.xml"/>
      <Relationship Id="footer" Type="{R}/footer" Target="footer1.xml"/>
      <Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/>
      </Relationships>'''.encode()
    image_rels = (f'<Relationships xmlns="{REL}"><Relationship Id="image" '
                  f'Type="{R}/image" Target="media/letterhead.png"/></Relationships>').encode()
    styles = f'''<w:styles xmlns:w="{W}">
      <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
      <w:name w:val="Normal"/><w:pPr><w:spacing w:after="160" w:line="240" w:lineRule="auto"/>
      </w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="27"/>
      </w:rPr></w:style></w:styles>'''.encode()
    return {
        "[Content_Types].xml": content_types, "word/document.xml": document,
        "_rels/.rels": (
            f'<Relationships xmlns="{REL}"><Relationship Id="doc" '
            f'Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>'
        ).encode(),
        "word/_rels/document.xml.rels": document_rels, "word/styles.xml": styles,
        "word/header1.xml": decoration(False), "word/footer1.xml": decoration(True),
        "word/_rels/header1.xml.rels": image_rels, "word/_rels/footer1.xml.rels": image_rels,
        "word/media/letterhead.png": base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        ),
    }


def test_only_decorative_parts_change_and_original_is_not_mutated(normalizer: ModuleType) -> None:
    original_parts = synthetic_letter()
    original = package(original_parts)
    normalized = parts(normalizer.prepare_letterhead(original))
    assert parts(original) == original_parts
    changed = {name for name in normalized if normalized[name] != original_parts[name]}
    assert changed == {"word/header1.xml", "word/footer1.xml"}
    for name in changed:
        root = XML.fromstring(normalized[name])
        anchor = root.find(".//wp:anchor", NS)
        assert anchor is not None and anchor.get("behindDoc") == "1"
        assert anchor.find("wp:positionH/wp:posOffset", NS).text == "-323850"
        assert root.find(".//wp:inline", NS) is None
        assert b'xmlns:unused="urn:test:unused"' in normalized[name]
        assert b'mc:Ignorable="unused"' in normalized[name]
        assert b'cy="1202120"' in normalized[name] or b'cy="1903357"' in normalized[name]
    prepared = package(normalized)
    assert normalizer.prepare_letterhead(prepared) == prepared


@pytest.mark.parametrize("change", [
    "inline-table", "page-anchor", "positive-offset", "multi-section", "signed", "no-section",
])
def test_other_layouts_are_byte_for_byte_unchanged(normalizer: ModuleType, change: str) -> None:
    data = synthetic_letter()
    document = data["word/document.xml"]
    if change == "inline-table":
        document = document.replace(b'<w:tblpPr w:horzAnchor="margin" w:tblpY="-420"/>', b"")
    elif change == "page-anchor":
        document = document.replace(b"<w:tblpPr ", b'<w:tblpPr w:vertAnchor="page" ')
    elif change == "positive-offset":
        document = document.replace(b'w:tblpY="-420"', b'w:tblpY="420"')
    elif change == "multi-section":
        document = document.replace(b"<w:p/>", b"<w:p><w:pPr><w:sectPr/></w:pPr></w:p>", 1)
    elif change == "no-section":
        document = document.replace(b"w:sectPr", b"w:other")
    else:
        data["_xmlsignatures/signature.xml"] = b"synthetic"
    data["word/document.xml"] = document
    original = package(data)
    assert normalizer.prepare_letterhead(original) == original


@pytest.mark.parametrize("change", ["text", "field", "small-image", "allocated-margin", "external"])
def test_real_header_content_and_other_margins_are_preserved(
    normalizer: ModuleType, change: str,
) -> None:
    data = synthetic_letter()
    for name in ["word/header1.xml", "word/footer1.xml"]:
        if change == "text":
            data[name] = data[name].replace(b"<w:r>", b"<w:r><w:t>Actual header text</w:t>", 1)
        elif change == "field":
            data[name] = data[name].replace(b"<w:r>", b'<w:r><w:fldChar w:fldCharType="begin"/>', 1)
        elif change == "small-image":
            data[name] = data[name].replace(b'cx="7560000"', b'cx="500000"')
    if change == "allocated-margin":
        data["word/document.xml"] = data["word/document.xml"].replace(
            b'w:header="0" w:footer="0"', b'w:header="120" w:footer="120"',
        )
    if change == "external":
        data["word/_rels/document.xml.rels"] = data["word/_rels/document.xml.rels"].replace(
            b"<Relationship ", b'<Relationship TargetMode="External" ',
        )
    original = package(data)
    assert normalizer.prepare_letterhead(original) == original


def test_rejects_entities_and_leaves_large_layouts_to_native_import(normalizer: ModuleType) -> None:
    data = synthetic_letter()
    data["word/header1.xml"] = b'<!DOCTYPE hdr [<!ENTITY secret SYSTEM "file:///secret">]><hdr/>'
    with pytest.raises(ValueError, match="Invalid Word"):
        normalizer.prepare_letterhead(package(data))
    data["word/header1.xml"] = b" " * (normalizer.MAX_XML + 1)
    original = package(data)
    assert normalizer.prepare_letterhead(original) == original


@pytest.mark.parametrize("explicit_break", [False, True])
def test_real_converter_keeps_all_text_and_honours_explicit_breaks(
    normalizer: ModuleType, tmp_path: Path, explicit_break: bool,
) -> None:
    image = os.environ.get("YUKSALISH_OFFICE_PREVIEW_TEST_IMAGE")
    if not image:
        pytest.skip("Set YUKSALISH_OFFICE_PREVIEW_TEST_IMAGE for isolated LibreOffice regression")
    data = synthetic_letter()
    if explicit_break:
        data["word/document.xml"] = data["word/document.xml"].replace(
            b"<w:sectPr>",
            b'<w:p><w:r><w:br w:type="page"/><w:t>Second page</w:t></w:r></w:p><w:sectPr>',
        )
    original = package(data)
    (tmp_path / "before.docx").write_bytes(original)
    (tmp_path / "after.docx").write_bytes(normalizer.prepare_letterhead(original))
    code = (
        'from pathlib import Path; import server; '
        'server.prepare_letterhead = lambda content: content; '
        '[(p.with_suffix(".pdf").write_bytes(server.convert(p.read_bytes(),"docx"))) '
        'for p in Path("/data").glob("*.docx")]'
    )
    subprocess.run([
        "docker", "run", "--rm", "--init", "--network", "none", "--read-only",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "768m",
        "--cpus", "1", "--pids-limit", "128", "--tmpfs", "/tmp:rw,noexec,nosuid,size=192m",
        "--mount", f"type=bind,source={tmp_path.resolve()},target=/data", image,
        "python", "-c", code,
    ], check=True, capture_output=True, timeout=90)
    before, after = (PdfReader(tmp_path / f"{name}.pdf") for name in ["before", "after"])
    assert len(after.pages) == (2 if explicit_break else 1)
    if not explicit_break:
        assert len(before.pages) == 2
    text = " ".join(page.extract_text() for page in after.pages)
    assert "Recipient" in text and "Signature" in text
    for i in range(LINES):
        assert f"Recorded report line {i:02d}. Content must remain intact." in text
    assert (tmp_path / "before.docx").read_bytes() == original
