# ruff: noqa: RUF001
"""Explicit Uzbek alphabet choice for a new memorandum snapshot, never identity data."""

import re
from typing import Literal

from .hr_hiring_templates import latin_person_name

DocumentScript = Literal["latin", "cyrillic"]
_PAIRS = {
    "o'": "ў",
    "g'": "ғ",
    "sh": "ш",
    "ch": "ч",
    "yo": "ё",
    "yu": "ю",
    "ya": "я",
    "ye": "е",
    "ts": "ц",
}
_LETTERS = dict(zip("abvgdejziyklmnoprstufxhcq", "абвгдежзийклмнопрстуфхҳcқ", strict=True))
_LETTERS["c"] = "с"
_LETTERS["w"] = "в"
_APOSTROPHES = str.maketrans({"‘": "'", "’": "'", "ʻ": "'", "ʼ": "'", "`": "'"})
_TOKENS = re.compile(r"o'|g'|sh|ch|yo|yu|ya|ye|ts|[a-z]", re.IGNORECASE)


def document_text(value: str, script: DocumentScript) -> str:
    if script == "latin":
        return latin_person_name(value).translate(_APOSTROPHES)

    def convert(match: re.Match[str]) -> str:
        token = match.group()
        result = _PAIRS.get(token.lower(), _LETTERS.get(token.lower(), token))
        return (
            result.upper()
            if token.isupper()
            else result.capitalize()
            if token[0].isupper()
            else result
        )

    # Convert Latin only; already-Cyrillic text and punctuation stay authored.
    return _TOKENS.sub(convert, value.translate(_APOSTROPHES)).replace("'", "ъ")


def document_parts(
    chair: str, requester: str, job_title: str, body: str, script: DocumentScript
) -> dict[str, str]:
    return {
        "heading": "BILDIRGI" if script == "latin" else "БИЛДИРГИ",
        "recipient_label": "“Yuksalish” harakati raisi"
        if script == "latin"
        else "“Юксалиш” ҳаракати раиси",
        "recipient": document_text(chair, script) + "ga"
        if script == "latin"
        else document_text(chair, script) + "га",
        "requester": document_text(requester, script),
        "job_title": document_text(job_title, script),
        "body": document_text(body, script),
    }
