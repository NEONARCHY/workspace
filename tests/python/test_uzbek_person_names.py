"""Synthetic name variants; stored identities and unrelated prose stay unchanged."""

import pytest

from yuksalish_api.hr_hiring_templates import _latin, latin_person_name


@pytest.mark.parametrize("ending", [
    "угли", "ўғли", "ugli", "ogli", "o'g'li",
    "o\u2018g\u2018li", "o\u2019g\u2019li", "o\u02bbg\u02bbli",
])
def test_normalizes_known_patronymic_variants_in_names(ending: str) -> None:
    assert latin_person_name(f"Testov Xodim Anvar {ending}") == "Testov Xodim Anvar o'g'li"


@pytest.mark.parametrize(("value", "expected"), [
    ("TESTOV XODIM ANVAR UGLI", "TESTOV XODIM ANVAR O'G'LI"),
    ("Testov Xodim Ugli", "Testov Xodim O'g'li"),
    ("Testov Xodim углига", "Testov Xodim o'g'liga"),
    ("Testov Xodim ўғлининг", "Testov Xodim o'g'lining"),
    ("Testov Xodim o'g'lidan", "Testov Xodim o'g'lidan"),
    ("O'Connor & <b>Testov</b>", "O'Connor & <b>Testov</b>"),
    ("Ugliest Oglin Tugli", "Ugliest Oglin Tugli"),
])
def test_preserves_case_suffixes_and_other_name_parts(value: str, expected: str) -> None:
    assert latin_person_name(value) == expected
    assert latin_person_name(expected) == expected


def test_plain_transliteration_does_not_rewrite_non_name_prose() -> None:
    assert _latin("угли") == "ugli"
