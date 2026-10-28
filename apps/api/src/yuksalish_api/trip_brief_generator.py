"""Deterministic Uzbek-Latin text for structured trip requests."""

from __future__ import annotations

import re
from datetime import date

from .hr_hiring_templates import _latin
from .trip_document_text import trip_destination_phrase

_MONTHS = (
    "yanvar", "fevral", "mart", "aprel", "may", "iyun",
    "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
)
_PLACEHOLDERS = {"test", "asdf", "qwerty", "тест", "нет", "йўқ", "yoq", "bilmayman"}
_URL = re.compile(r"(?:https?://|www\.|\b[\w.-]+\.(?:com|uz|org|net)\b)", re.IGNORECASE)
_REPEATED = re.compile(r"(.)\1{5,}", re.IGNORECASE)


def clean_fact(value: str) -> str:
    return " ".join(value.split()).strip(" .;,")


def validate_fact(
    value: str, *, field: str, min_letters: int, min_words: int = 1,
    max_length: int | None = None,
) -> str:
    cleaned = clean_fact(value)
    words = re.findall(r"[^\W\d_]+", cleaned, re.UNICODE)
    letters = sum(character.isalpha() for character in cleaned)
    if (
        letters < min_letters or len(words) < min_words
        or (max_length is not None and len(cleaned) > max_length)
        or _URL.search(cleaned) or _REPEATED.search(cleaned)
        or cleaned.casefold() in _PLACEHOLDERS
        or (len(words) > 1 and len({word.casefold() for word in words}) == 1)
    ):
        raise ValueError(f"Укажите содержательное значение поля «{field}» без ссылок и заглушек")
    return cleaned


def trip_date_phrase(start: date, end: date) -> str:
    if start == end:
        return f"{start.year}-yil {start.day}-{_MONTHS[start.month - 1]} kuni"
    if start.year == end.year and start.month == end.month:
        return f"{start.year}-yil {start.day}-{end.day}-{_MONTHS[start.month - 1]} kunlari"
    return (
        f"{start.year}-yil {start.day}-{_MONTHS[start.month - 1]}dan "
        f"{end.year}-yil {end.day}-{_MONTHS[end.month - 1]}gacha"
    )


def generate_trip_brief(
    *, destination: str, start: date, end: date, purpose: str, expense_source: str,
) -> str:
    """Use checked facts only; never invent an itinerary, project or funding source."""
    place = trip_destination_phrase(validate_fact(destination, field="Куда едем", min_letters=3))
    activity = _latin(validate_fact(
        purpose, field="Основание и мероприятие", min_letters=20, min_words=4,
        max_length=600,
    ))
    funding = _latin(validate_fact(
        expense_source, field="Источник покрытия расходов", min_letters=3,
    ))
    if end < start:
        raise ValueError("Дата окончания не может быть раньше даты начала")
    return "\n\n".join((
        f"{trip_date_phrase(start, end)} {place} xizmat safari rejalashtirilgan. "
        f"Safarning maqsadi: {activity.rstrip('.!?')}.",
        "Shu munosabat bilan mazkur xizmat safariga ruxsat berishingizni soʻrayman.",  # noqa: RUF001
        f"Safar xarajatlarini qoplash manbai: {funding}.",
    ))


def validate_edited_trip_brief(value: str) -> str:
    """Keep the employee's paragraphs while rejecting empty or placeholder briefs."""
    normalized = "\n".join(line.strip() for line in value.replace("\r\n", "\n").split("\n"))
    normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip()
    validate_fact(
        normalized, field="Текст билдирги", min_letters=80, min_words=12,
        max_length=6000,
    )
    return _latin(normalized)
