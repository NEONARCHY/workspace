"""Synthetic cards/MRZ only; production identity text must never enter fixtures."""

from PIL import Image, ImageDraw

from yuksalish_api.hr_identity import extract_identity
from yuksalish_api.hr_identity_layout import card_regions, check_digit, merge_results, td1_identity


def mrz() -> list[str]:
    document = "AD0000000"
    first = "IU" + "UZB" + document + check_digit(document) + "0" * 14 + "<"
    birth, expiry = "900101", "300101"
    second = birth + check_digit(birth) + "M" + expiry + check_digit(expiry) + "UZB" + "<" * 11
    second += check_digit(first[5:] + second[:7] + second[8:15] + second[18:29])
    return [first, second, "TESTOV<<ALI".ljust(30, "<")]


def test_mrz_requires_every_check_and_explicit_patronymic_review() -> None:
    rows = mrz()
    result = td1_identity(rows)
    assert result is not None
    assert result.pinfl == "0" * 14 and result.passport == "AD0000000"
    assert result.full_name == "TESTOV ALI" and not result.name_complete
    for line, position in ((0, 14), (0, 15), (1, 6), (1, 14), (1, 29)):
        changed = rows.copy()
        value = rows[line]
        changed[line] = (
            value[:position] + str((int(value[position]) + 1) % 10) + value[position + 1 :]
        )
        assert td1_identity(changed) is None
    assert td1_identity([rows[0][:-1], *rows[1:]]) is None
    assert td1_identity(["1" + rows[0][1:], *rows[1:]]) is None
    assert td1_identity([*rows[:2], "TEST0V<<ALI".ljust(30, "<")]) is None


def test_known_check_digit_and_bilingual_label_punctuation() -> None:
    assert check_digit("AB2134<<<") == "5"  # ICAO public synthetic worked example.
    result = extract_identity(
        [
            "Familiyasi / Surname",
            "TESTOV",
            "Ismi / Given name(s)",
            "ALI",
            "Otasining ismi / Patronymic",
            "TESTOVICH",
            "Shaxsiy raqami / Personal number",
            "00000000000000",
            "Karta raqami / Card number",
            "AD0000000",
        ]
    )
    assert result.full_name == "TESTOV ALI TESTOVICH"
    assert result.pinfl == "0" * 14 and result.passport == "AD0000000"
    assert result.name_complete


def test_separate_vertical_horizontal_and_single_card_regions() -> None:
    for horizontal in (False, True):
        canvas = Image.new("RGB", (1200, 440) if horizontal else (640, 840), "white")
        draw = ImageDraw.Draw(canvas)
        boxes = (
            [(20, 20, 580, 380), (620, 20, 1180, 380)]
            if horizontal
            else [(20, 20, 580, 380), (20, 440, 580, 800)]
        )
        for box in boxes:
            draw.rectangle(box, fill="#bbbbbb")
        parts = card_regions(canvas)
        assert len(parts) == 2
        assert all(1.2 < part.width / part.height < 2 for part in parts)
        assert len(card_regions(parts[0])) == 1


def test_names_from_front_and_mrz_merge_without_losing_the_patronymic() -> None:
    short = td1_identity(mrz())
    assert short is not None
    long = extract_identity(["FULL NAME: TESTOV ALI TESTOVICH"])
    result = merge_results([short, long])
    assert result.full_name == long.full_name and result.name_complete
    assert result.pinfl == short.pinfl
