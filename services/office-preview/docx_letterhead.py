"""Preview-only workaround for Writer moving floating address tables below letterheads.

Word allows the floating table to overlap the header's empty picture area. Writer
reserves the full inline picture height before positioning the table, and also
reserves the footer picture before laying out the body. Anchor these decorative
pictures to their existing page coordinates in this narrowly recognised layout.
"""

import re
from copy import copy
from io import BytesIO
from zipfile import BadZipFile, ZipFile

from defusedxml import ElementTree as XML
from defusedxml.common import DefusedXmlException

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"w": W, "wp": WP}
MAX_XML = 2 * 1024 * 1024


class _LargeLayout(Exception):
    """Leave large layouts to the existing resource-limited Writer import."""


def _part(archive: ZipFile, name: str) -> bytes:
    if archive.getinfo(name).file_size > MAX_XML:
        raise _LargeLayout
    return archive.read(name)


def _picture(data: bytes, *, page_width: int, left: int, budget: int, footer: bool) -> bytes:
    root = XML.fromstring(data)
    paragraphs = root.findall("w:p", NS)
    pictures = root.findall(".//wp:inline", NS)
    # Text, fields, multiple objects and non-decorative headers retain native import.
    if (root.tag != f"{{{W}}}{'ftr' if footer else 'hdr'}"
            or len(root) != 1 or len(paragraphs) != 1 or len(pictures) != 1
            or root.findall(".//w:t", NS) or root.findall(".//w:instrText", NS)
            or root.findall(".//w:fldChar", NS) or root.findall(".//wp:anchor", NS)
            or any(root.findall(f".//w:{tag}", NS) for tag in ["tab", "br", "cr"])):
        return data
    inline = pictures[0]
    picture_ns = "http://schemas.openxmlformats.org/drawingml/2006/picture"
    if inline.find(f".//{{{picture_ns}}}pic") is None:
        return data
    extent = inline.find("wp:extent", NS)
    if extent is None:
        return data
    # Only a page-wide picture taller than its allotted header/footer margin.
    if (page_width <= 0 or budget <= 0
            or int(extent.get("cx", "0")) < page_width * 635 * 0.99
            or int(extent.get("cy", "0")) <= budget * 635):
        return data
    indent = paragraphs[0].find("w:pPr/w:ind", NS)
    if indent is None or f"{{{W}}}left" not in indent.attrib:
        return data
    x = (left + int(indent.get(f"{{{W}}}left", "0"))) * 635
    # Keep every existing namespace declaration and markup-compatibility prefix byte.
    prefixes = [prefix for _, (prefix, uri) in XML.iterparse(BytesIO(data), events=("start-ns",))
                if uri == WP and prefix]
    if not prefixes:
        return data
    prefix = prefixes[0].encode("ascii")
    tag = re.escape(prefix)
    pattern = rb"<" + tag + rb":inline\b[^>]*>(.*?)</" + tag + rb":inline>"
    matches = list(re.finditer(pattern, data, flags=re.DOTALL))
    if len(matches) != 1:
        return data
    p = prefix.decode("ascii")
    vertical = f"<{p}:align>bottom</{p}:align>" if footer else f"<{p}:posOffset>0</{p}:posOffset>"
    opening = (
        f'<{p}:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" '
        'relativeHeight="0" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">'
        f'<{p}:simplePos x="0" y="0"/>'
        f'<{p}:positionH relativeFrom="page"><{p}:posOffset>{x}</{p}:posOffset></{p}:positionH>'
        f'<{p}:positionV relativeFrom="page">{vertical}</{p}:positionV>'
    ).encode("ascii")
    match = matches[0]
    contents = match[1].replace(f"<{p}:docPr".encode(), f"<{p}:wrapNone/><{p}:docPr".encode(), 1)
    return (data[:match.start()] + opening + contents
            + f"</{p}:anchor>".encode() + data[match.end():])


def prepare_letterhead(content: bytes) -> bytes:
    """Return the original bytes unless this is a single-section floating-address letter."""
    try:
        with ZipFile(BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) > 3000 or sum(entry.file_size for entry in entries) > 80_000_000:
                raise ValueError("Word archive exceeds limits")
            names = archive.namelist()
            if len(set(names)) != len(names) or "word/document.xml" not in names:
                return content
            if any(name.startswith("_xmlsignatures/") for name in names):
                return content
            document = XML.fromstring(_part(archive, "word/document.xml"))
            body = document.find("w:body", NS)
            sections = document.findall(".//w:sectPr", NS)
            if body is None or not len(body) or body[0].tag != f"{{{W}}}tbl" or len(sections) != 1:
                return content
            position = body[0].find("w:tblPr/w:tblpPr", NS)
            if (position is None or position.get(f"{{{W}}}vertAnchor", "margin") != "margin"
                    or int(position.get(f"{{{W}}}tblpY", "0")) >= 0):
                return content
            section = sections[0]
            margins, size = section.find("w:pgMar", NS), section.find("w:pgSz", NS)
            if margins is None or size is None or margins.get(f"{{{W}}}gutter", "0") != "0":
                return content
            relationships = XML.fromstring(_part(archive, "word/_rels/document.xml.rels"))
            targets = {item.get("Id"): item.get("Target", "") for item in relationships
                       if item.get("TargetMode") != "External"}
            replacements: dict[str, bytes] = {}
            for kind, edge in [("header", "top"), ("footer", "bottom")]:
                references = section.findall(f"w:{kind}Reference", NS)
                if (len(references) != 1 or references[0].get(f"{{{W}}}type") != "default"
                        or margins.get(f"{{{W}}}{kind}", "0") != "0"):
                    continue
                target = targets.get(references[0].get(f"{{{R}}}id"), "")
                # Only ordinary same-directory parts; never resolve paths or external targets.
                if not re.fullmatch(kind + r"[0-9]+\.xml", target):
                    continue
                name = "word/" + target
                original = _part(archive, name)
                updated = _picture(original, page_width=int(size.get(f"{{{W}}}w", "0")),
                                   left=int(margins.get(f"{{{W}}}left", "0")),
                                   budget=int(margins.get(f"{{{W}}}{edge}", "0")),
                                   footer=kind == "footer")
                if updated != original:
                    replacements[name] = updated
            if not replacements:
                return content
            output = BytesIO()
            with ZipFile(output, "w") as result:
                for entry in entries:
                    result.writestr(copy(entry), replacements.get(entry.filename,
                                    archive.read(entry.filename)))
            return output.getvalue()
    except _LargeLayout:
        return content
    except (BadZipFile, XML.ParseError, DefusedXmlException, KeyError) as error:
        raise ValueError("Invalid Word layout package") from error
