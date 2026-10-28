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
    "Ферганская область": "Farg'ona viloyati",
    "Хорезмская область": "Xorazm viloyati",
    "Республика Каракалпакстан": "Qoraqalpog'iston Respublikasi",
    "город Ташкент": "Toshkent shahri",
}
_CITIES = {
    "Andijon": ("Андижан", "Andijan"),
    "Buxoro": ("Бухара", "Bukhara"),
    "Jizzax": ("Джизак", "Jizzakh"),
    "Qarshi": ("Карши", "Karshi"),
    "Navoiy": ("Навои", "Navoi"),
    "Namangan": ("Наманган",),
    "Samarqand": ("Самарканд", "Samarkand"),
    "Termiz": ("Термез", "Термиз", "Termez"),
    "Guliston": ("Гулистан", "Gulistan"),
    "Toshkent": ("Ташкент", "Tashkent"),
    "Farg'ona": ("Фергана", "Фарғона", "Fergana", "Ferghana"),
    "Urganch": ("Ургенч", "Urgench"),
    "Nukus": ("Нукус",),
    "Xiva": ("Хива", "Khiva"),
}
_COUNTRIES = ("Uzbekistan", "Узбекистан", "O'zbekiston", "Ўзбекистон")
_APOSTROPHES = "'\u02bb\u02bc\u2018\u2019"
_ALIASES: dict[str, str] = {}
_BARE_CITIES: dict[str, str] = {}


def _add_alias(alias: str, name: str) -> None:
    for variant in (alias, _latin(alias)):
        for apostrophe in _APOSTROPHES:
            key = re.sub(f"[{_APOSTROPHES}]", apostrophe, variant).casefold()
            _ALIASES[key] = name


for _alias, _name in _REGIONS.items():
    _add_alias(_alias, _name)
    _add_alias(_name, _name)

for _city, _variants in _CITIES.items():
    for _alias in (_city, *_variants):
        for _variant in (_alias, _latin(_alias)):
            _BARE_CITIES[re.sub(f"[{_APOSTROPHES}]", "'", _variant).casefold()] = _city
        for _label in (f"город {_alias}", f"\u0433. {_alias}", f"{_alias} shahri"):
            _add_alias(_label, f"{_city} shahri")
        _add_alias(f"{_alias} hududiga", f"{_city} shahriga")
        for _country in _COUNTRIES:
            _add_alias(f"{_alias}, {_country}", f"{_city} shahri")

_PATTERN = re.compile(
    r"(?<!\w)(?P<place>" + "|".join(re.escape(alias) for alias in sorted(
        _ALIASES, key=len, reverse=True,
    )) + r")(?P<direction>ga)?(?!\w)", re.IGNORECASE,
)
_ADMIN_ENDING = re.compile(r"\b(viloyati|shahri|tumani|respublikasi)(?:ga)?$", re.IGNORECASE)
_OLD_DIRECTION = re.compile(
    r"\b(viloyati|shahri|tumani|respublikasi)(?:ga)?(?:\s+hududiga|ga)\b", re.IGNORECASE,
)


def trip_destination_text(value: str) -> str:
    """Use explicit administrative labels; a reviewed bare city is never a region."""
    cleaned = " ".join(value.split())
    normalized = trip_body_text(cleaned)
    city = _BARE_CITIES.get(re.sub(f"[{_APOSTROPHES}]", "'", normalized).casefold())
    return f"{city} shahri" if city else normalized


def trip_destination_phrase(value: str) -> str:
    """Dative place for both generated briefs and orders, with no doubled suffix."""
    place = trip_destination_text(value)
    if _ADMIN_ENDING.search(place):
        return _ADMIN_ENDING.sub(lambda match: match[1] + "ga", place)
    return place if place.casefold().endswith(" hududiga") else f"{place} hududiga"


def trip_body_text(value: str) -> str:
    """Apply reviewed place aliases in authored briefs without rewriting their prose."""
    normalized = _PATTERN.sub(
        lambda match: _ALIASES.get(match["place"].casefold(), match["place"])
        + (match["direction"] or ""),
        _latin(value),
    )
    return _OLD_DIRECTION.sub(lambda match: match[1] + "ga", normalized)
