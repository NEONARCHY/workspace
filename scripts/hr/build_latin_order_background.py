"""Derive the Latin order blank from the owner's original, retaining its artwork."""

from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "apps/api/src/yuksalish_api/hr_assets"
SOURCE = ASSETS / "order-original-blank.pdf"
DESTINATION = ASSETS / "order-latin-blank.pdf"


def meaningful_text(block: list[tuple[list[object], bytes]]) -> str:
    parts: list[str] = []
    for operands, operator in block:
        if operator == b"Tj":
            parts.append(str(operands[0]))
        elif operator == b"TJ":
            parts.extend(str(part) for part in operands[0] if isinstance(part, str | bytes))
    return "".join(parts).strip()


def main() -> None:
    reader = PdfReader(SOURCE)
    if len(reader.pages) != 1:
        raise ValueError("Expected one original order page")
    writer = PdfWriter()
    page = writer.add_page(reader.pages[0])
    content = ContentStream(page.get_contents(), writer)
    result: list[tuple[list[object], bytes]] = []
    kept: list[str] = []
    removed = 0
    operations = content.operations
    index = 0
    while index < len(operations):
        if operations[index][1] != b"BT":
            result.append(operations[index])
            index += 1
            continue
        end = next(
            (
                offset for offset in range(index + 1, len(operations))
                if operations[offset][1] == b"ET"
            ),
            None,
        )
        if end is None:
            raise ValueError("Unclosed text object in original order")
        block = operations[index : end + 1]
        text = meaningful_text(block)
        if text in {"HARAKAT", "MOVEMENT"}:
            kept.append(text)
            result.extend(block)
        elif text:
            removed += 1
        else:
            result.extend(block)
        index = end + 1
    if set(kept) != {"HARAKAT", "MOVEMENT"} or removed != 4:
        raise ValueError("Original order text changed; inspect the blank before rebuilding")
    content.operations = result
    page.replace_contents(content)
    writer.write(DESTINATION)
    latin_blank = PdfReader(DESTINATION).pages[0].extract_text()
    if "БУЙРУҚ" in latin_blank or "HARAKAT" not in latin_blank:
        raise ValueError("Order background text was not sanitized")


if __name__ == "__main__":
    main()
