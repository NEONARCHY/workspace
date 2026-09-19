import re

# ruff: noqa: RUF001 - Uzbek Latin titles intentionally use typographic apostrophes.

CYRILLIC_PATTERN = re.compile(r"[\u0400-\u052f]")

PAYMENT_CREATOR_POSITION_NAMES = (
    "Bosh hisobchi",
    "Hududiy bo‘linmalar bilan ishlash bo‘limi boshlig‘i",
    "Rais o‘rinbosari",
    '"Yuksalish" harakati raisi, Qonunchilik palatasi qo\'mita raisi',
)

EXECUTIVE_LEADER_POSITION_NAME = (
    '"Yuksalish" harakati raisi, Qonunchilik palatasi qo\'mita raisi'
)


def is_executive_leader(job_title: str | None) -> bool:
    """Return whether the employee holds the workspace-wide leadership position."""
    return (job_title or "").strip().casefold() == EXECUTIVE_LEADER_POSITION_NAME.casefold()


def latin_position_name(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("Value must not be blank")
    if CYRILLIC_PATTERN.search(normalized):
        raise ValueError("Position name must use Latin script")
    return normalized
