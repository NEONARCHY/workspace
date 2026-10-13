"""Build privacy-safe PDF backgrounds from the owner's original Word forms.

This is a one-time maintainer tool, not a runtime dependency. Export each source
with Word to a static PDF first, then pass the exports here. PyMuPDF is needed
only for this asset-build step. Do not commit the filled sample or its export.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pymupdf


def erase(page: pymupdf.Page, boxes: list[tuple[float, float, float, float]]) -> None:
    for box in boxes:
        page.add_redact_annot(pymupdf.Rect(*box), fill=(1, 1, 1))
    page.apply_redactions(images=0, graphics=0, text=0)


def build_contract(source: Path, destination: Path) -> None:
    with pymupdf.open(source) as document:
        if len(document) < 2:
            raise ValueError("The contract export must contain two populated pages")
        # The old DOC exports a third, completely blank page; do not ship it.
        while len(document) > 2:
            document.delete_page(2)
        erase(document[0], [(383, 128, 560, 147), (84, 153, 559, 181)])
        erase(
            document[1],
            [
                (367, 598, 505, 612),  # sample employer full name
                (398, 667, 475, 682),  # sample employer phone
                (332, 710, 540, 726),  # sample employer address
            ],
        )
        document.set_metadata({})
        document.save(destination, garbage=4, clean=True, deflate=True)


def build_order(source: Path, destination: Path) -> None:
    with pymupdf.open(source) as document:
        if len(document) != 1:
            raise ValueError("The order sample must have exactly one page")
        erase(
            document[0],
            [
                (278, 161, 361, 181),  # sample order number
                (77, 186, 306, 206),  # sample date
                (78, 260, 566, 446),  # all sample-specific body text
                (397, 513, 535, 534),  # sample chair name
            ],
        )
        document.set_metadata({})
        document.save(destination, garbage=4, clean=True, deflate=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("contract_pdf", type=Path)
    parser.add_argument("order_pdf", type=Path)
    parser.add_argument("output_directory", type=Path)
    arguments = parser.parse_args()
    output = arguments.output_directory
    output.mkdir(parents=True, exist_ok=True)
    build_contract(arguments.contract_pdf, output / "contract-original-blank.pdf")
    build_order(arguments.order_pdf, output / "order-original-blank.pdf")


if __name__ == "__main__":
    main()
