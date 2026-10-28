"""Known geographic names for trip documents, not a free-text translation service."""

import re

from .hr_hiring_templates import _latin

# Exact, reviewed aliases only. Do not guess the identity of unknown destinations.
_REGIONS = {
    "Андижанская область": "Andijon viloyati",
    "Бухарская область": "Buxoro viloyati",
    "Джизакская область": "Jizzax viloyati",
    "Кашкадарьинская область": "Qashqadaryo viloyati",
    "Навоийская область": "Navoiy viloyati",
    "Наманганская область": "Namangan viloyati",
    "Самаркандская область": "Samarqand viloyati",
    "Сурхандарьинская область": "Surxondaryo viloyati",
    "Сырдарьинская область": "Sirdaryo viloyati",
    "Ташкентская область": "Toshkent viloyati",
    "Ферганская область": "Fargʻona viloyati",  # noqa: RUF001
    "Хорезмская область": "Xorazm viloyati",
    "Республика Каракалпакстан": "Qoraqalpogʻiston Respublikasi",  # noqa: RUF001
    "город Ташкент": "Toshkent shahri",
}
_ALIASES = {alias.casefold(): name for alias, name in _REGIONS.items()}
_ALIASES.update({_latin(alias).casefold(): name for alias, name in _REGIONS.items()})
_ALIASES.update({alias.casefold(): "Ferghana, Uzbekistan" for alias in (
    "Фергана, Узбекистан", "Fergana, Uzbekistan", "Fergana, Узбекистан",
)})
_PATTERN = re.compile(
    r"(?<!\w)(?:" + "|".join(re.escape(alias) for alias in sorted(
        _ALIASES, key=len, reverse=True,
    )) + r")(?!\w)", re.IGNORECASE,
)


def trip_destination_text(value: str) -> str:
    """Normalize known Russian region aliases before converting Uzbek Cyrillic."""
    cleaned = " ".join(value.split())
    return trip_body_text(cleaned)


def trip_body_text(value: str) -> str:
    """Apply reviewed place aliases in authored briefs without rewriting their prose."""
    return _latin(_PATTERN.sub(
        lambda match: _ALIASES.get(match[0].casefold(), match[0]), value,
    ))
