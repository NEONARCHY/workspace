"""One-time, local-only sanitization of the owner's Word layout (no HR values)."""

import argparse
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from PIL import Image

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}


def text(paragraph: ET.Element, value: str) -> None:
    props = deepcopy(paragraph.find(f"{{{W}}}pPr"))
    run_props = paragraph.find(f"{{{W}}}r/{{{W}}}rPr")
    run_props = deepcopy(run_props) if run_props is not None else None
    paragraph.clear()
    if props is not None:
        paragraph.append(props)
    run = ET.SubElement(paragraph, f"{{{W}}}r")
    if run_props is not None:
        run.append(run_props)
    ET.SubElement(run, f"{{{W}}}t").text = value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    with ZipFile(args.source) as source:
        # Preserve namespace prefixes, including those referenced in mc:Ignorable.
        for _, (prefix, uri) in ET.iterparse(BytesIO(source.read("word/document.xml")),
                                           events=["start-ns"]):
            if prefix != "xml":
                ET.register_namespace(prefix, uri)
        root = ET.fromstring(source.read("word/document.xml"))
        for node in root.findall(".//w:t", NS):
            node.text = ""
        for parent in root.iter():
            for child in list(parent):
                if child.tag in {f"{{{W}}}{name}" for name in (
                    "bookmarkStart", "bookmarkEnd", "proofErr", "lastRenderedPageBreak",
                )}:
                    parent.remove(child)
            for key in list(parent.attrib):
                if key.startswith(f"{{{W}}}rsid"):
                    del parent.attrib[key]
        body = root.find("w:body", NS)
        assert body is not None
        tables = body.findall("w:tbl", NS)
        rows = tables[0].findall("w:tr", NS)

        def slot(row: int, cell: int, paragraph: int, value: str) -> None:
            text(rows[row].findall("w:tc", NS)[cell].findall("w:p", NS)[paragraph], value)

        slot(0, 0, 0, "МАЪЛУМОТНОМА")
        slot(1, 0, 1, "{{fullName}}")
        slot(2, 0, 1, "{{appointmentDate}}")
        slot(2, 0, 2, "{{jobTitle}}")
        pairs = [
            (3, 0, "Туғилган йили:", "birthDate"),
            (3, 1, "Туғилган жойи:", "birthPlace"),
            (4, 0, "Миллати:", "nationality"),
            (4, 1, "Партиявийлиги:", "partyMembership"),
            (5, 0, "Маълумоти:", "educationLevel"),
            (5, 1, "Тамомлаган:", "institutions"),
            (7, 0, "Илмий даражаси:", "academicDegree"),
            (7, 1, "Илмий унвони:", "academicTitle"),
            (8, 0, "Қайси чет тилларини билади:", "languages"),
            (8, 1, "Ҳарбий (махсус) унвони:", "militaryRank"),
        ]
        for row, cell, label, name in pairs:
            slot(row, cell, 0, label)
            slot(row, cell, 1, "{{" + name + "}}")
        slot(6, 0, 0, "Маълумоти бўйича мутахассислиги:")
        slot(6, 1, 0, "{{specialties}}")
        slot(9, 0, 0, "Давлат мукофотлари билан тақдирланганми: ")
        slot(10, 0, 0, "Халқ депутатлари, республика, вилоят, шаҳар ва туман Кенгаши депутатими")
        slot(10, 0, 1, "ёки бошқа сайланадиган органларнинг аъзосими: ")
        for row_index, p_index, name in ((9, 0, "awards"), (10, 1, "electedMembership")):
            paragraph = rows[row_index].find("w:tc", NS).findall("w:p", NS)[p_index]
            run = ET.SubElement(paragraph, f"{{{W}}}r")
            props = ET.SubElement(run, f"{{{W}}}rPr")
            ET.SubElement(props, f"{{{W}}}b", {f"{{{W}}}val": "0"})
            ET.SubElement(props, f"{{{W}}}sz", {f"{{{W}}}val": "22"})
            ET.SubElement(run, f"{{{W}}}t").text = "{{" + name + "}}"
        slot(11, 0, 1, "МЕҲНАТ ФАОЛИЯТИ")
        for cell, name in enumerate(("workPeriod", "workDash", "workPosition")):
            slot(13, cell, 0, "{{" + name + "}}")
        for row in rows[14:]:
            tables[0].remove(row)

        paragraphs = body.findall("w:p", NS)
        text(paragraphs[3], "{{fullName}}нинг яқин қариндошлари ҳақида")
        text(paragraphs[4], " ".join("МАЪЛУМОТ"))
        relatives = tables[1].findall("w:tr", NS)
        for cell, labels in zip(relatives[0].findall("w:tc", NS), (
            ("Қариндош-", "лиги"), ("Фамилияси,исми", "ва отасининг исми"),
            ("Туғилган", "йили ва жойи"), ("Иш жойи ва лавозими",), ("Яшаш жойи",),
        ), strict=True):
            ps = cell.findall("w:p", NS)
            for paragraph, label in zip(ps, labels, strict=True):
                text(paragraph, label)
        for i, cell in enumerate(relatives[1].findall("w:tc", NS)):
            ps = cell.findall("w:p", NS)
            text(ps[0], "{{relative" + str(i) + "}}")
            for extra in ps[1:]:
                cell.remove(extra)
        for row in relatives[2:]:
            tables[1].remove(row)
        # Floating tables cannot reliably repeat across pages. Preserve original grid,
        # centering and minimum row heights; use in-flow table for long families.
        table_props = tables[1].find("w:tblPr", NS)
        assert table_props is not None
        for floating in list(table_props):
            if floating.tag in {f"{{{W}}}tblpPr", f"{{{W}}}tblOverlap"}:
                table_props.remove(floating)
        ET.SubElement(table_props, f"{{{W}}}jc", {f"{{{W}}}val": "center"})
        for i, row in enumerate(relatives[:2]):
            props = row.find("w:trPr", NS)
            if props is None:
                props = ET.SubElement(row, f"{{{W}}}trPr")
            ET.SubElement(props, f"{{{W}}}tblHeader" if i == 0 else f"{{{W}}}cantSplit")
        # Source trailing Calibri paragraphs contain no semantic content.
        for paragraph in paragraphs[6:]:
            body.remove(paragraph)
        portrait = BytesIO()
        Image.new("RGB", (300, 400), "white").save(portrait, format="JPEG")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(args.output, "w", ZIP_DEFLATED) as output:
            for item in source.infolist():
                if item.filename == "word/document.xml":
                    content = ET.tostring(root, encoding="utf-8", xml_declaration=True)
                elif item.filename == "word/media/image1.jpeg":
                    content = portrait.getvalue()
                elif item.filename.startswith("docProps/"):
                    # Keep relationships valid, but do not retain creator/last editor.
                    tag = ("{http://schemas.openxmlformats.org/package/2006/metadata/core-properties}coreProperties"
                           if item.filename.endswith("core.xml") else
                           "{http://schemas.openxmlformats.org/officeDocument/2006/extended-properties}Properties")
                    content = ET.tostring(ET.Element(tag), encoding="utf-8", xml_declaration=True)
                elif item.filename == "word/settings.xml":
                    settings = ET.fromstring(source.read(item.filename))
                    safe = {"compat", "defaultTabStop", "characterSpacingControl", "mathPr",
                            "themeFontLang", "clrSchemeMapping", "decimalSymbol", "listSeparator",
                            "doNotAutoCompressPictures", "defaultImageDpi"}
                    for setting in list(settings):
                        if setting.tag.split("}")[-1] not in safe:
                            settings.remove(setting)
                    content = ET.tostring(settings, encoding="utf-8", xml_declaration=True)
                else:
                    content = source.read(item.filename)
                output.writestr(item.filename, content)
    print("Sanitized template created; reference unchanged.")


if __name__ == "__main__":
    main()
