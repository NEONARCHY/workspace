"""Registration corrections keep the approved body and original signature pixels."""

from datetime import date
from io import BytesIO

import pytest
from pypdf import PdfReader

from test_hr_hiring_pdf import signature
from yuksalish_api.trip_hr_pdf import TripDocumentSnapshot, hr_order_pdf
from yuksalish_api.trip_order_details_pdf import order_details_pdf
from yuksalish_api.trip_order_pdf import order_pdf


@pytest.mark.parametrize("cyrillic", [False, True])
@pytest.mark.parametrize("employee_count", [1, 20])
def test_registration_replaces_only_two_lines_and_preserves_every_image(cyrillic, employee_count):
    employees = [(f"Synthetic Owner {index}", "Employee") for index in range(employee_count)]
    original = (
        hr_order_pdf(
            TripDocumentSnapshot(
                requester="Synthetic Owner", requester_title="Employee", chair="Synthetic Chair",
                brief_text="Synthetic brief", purpose="Synthetic purpose", destination="Fargona",
                start=date(2026, 11, 9), end=date(2026, 11, 14),
                employees=employees, expense_source="Budget",
            ), number="009-WS", series="\u0430/ф", purpose="Synthetic purpose",
            issued=date(2026, 11, 9), signature=signature(),
        ) if cyrillic else order_pdf(
            order_number="009-WS", issued=date(2026, 11, 9), purpose="Synthetic purpose",
            destination="Fargona", start=date(2026, 11, 9), end=date(2026, 11, 14),
            employees=employees, expense_source="Budget",
            requester="Synthetic Owner", chair="Synthetic Chair", signature=signature(),
        )
    )
    corrected = order_details_pdf(
        original, old_number="009-WS", old_series="\u0430/ф" if cyrillic else "",
        old_date=date(2026, 11, 9), number="77", series="\u0430/ф", issued=date(2026, 10, 31),
    )
    twice = order_details_pdf(
        corrected, old_number="77", old_series="\u0430/ф", old_date=date(2026, 10, 31),
        number="88", series="\u0431/ф", issued=date(2026, 11, 1),
    )
    readers = [PdfReader(BytesIO(data)) for data in [original, corrected, twice]]
    original_text = "\n".join(page.extract_text() for page in readers[0].pages)
    for reader, number in zip(readers[1:], ["77", "88"], strict=True):
        text = "\n".join(page.extract_text() for page in reader.pages)
        assert "009-WS" not in text
        assert f"{number}-" in text
        assert len(reader.pages) == len(readers[0].pages)
        assert [image.data for page in reader.pages for image in page.images] == [
            image.data for page in readers[0].pages for image in page.images
        ]
        # The body is copied, not regenerated from current directory data.
        for line in original_text.splitlines():
            if "009-WS" not in line and not line.startswith(("2026-yil “9”", "2026 йил «9»")):
                assert line in text
    assert "77-" not in readers[2].pages[0].extract_text()


def test_unknown_order_layout_is_rejected_instead_of_editing_other_text():
    content = order_pdf(
        order_number="009-WS", issued=date(2026, 11, 9), purpose="Purpose",
        destination="Fargona", start=date(2026, 11, 9), end=date(2026, 11, 14),
        employees=[("Synthetic Owner", "Employee")], expense_source="Budget",
        requester="Synthetic Owner", chair="Synthetic Chair", signature=signature(),
    )
    with pytest.raises(ValueError, match="не распознаны"):
        order_details_pdf(
            content, old_number="WRONG", old_series="", old_date=date(2026, 11, 9),
            number="77", series="\u0430/ф", issued=date(2026, 11, 1),
        )
