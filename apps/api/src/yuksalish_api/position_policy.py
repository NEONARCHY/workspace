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


def is_human_resources_position(job_title: str | None) -> bool:
    """Return whether the title belongs to the personnel/HR function."""
    normalized = (job_title or "").strip().casefold()
    return "kadr" in normalized or "персонал" in normalized


def is_calendar_chairman(job_title: str | None) -> bool:
    """Equivalent apostrophes/spacing in the chairman's calendar identity only."""
    apostrophes = str.maketrans({"‘": "'", "’": "'", "ʻ": "'", "ʼ": "'", "`": "'"})
    normalized = " ".join((job_title or "").translate(apostrophes).casefold().split())
    chairman = EXECUTIVE_LEADER_POSITION_NAME.translate(apostrophes).casefold()
    return normalized == chairman


def is_calendar_audience_leader(job_title: str | None) -> bool:
    """Calendar-only authority: do not broaden the chairman's other object permissions."""
    apostrophes = str.maketrans({"‘": "'", "’": "'", "ʻ": "'", "ʼ": "'", "`": "'"})
    normalized = " ".join((job_title or "").translate(apostrophes).casefold().split())
    return is_calendar_chairman(job_title) or bool(re.fullmatch(
        r"rais(?:ning)? (?:birinchi )?o'rinbosari", normalized
    ))


def latin_position_name(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("Value must not be blank")
    if CYRILLIC_PATTERN.search(normalized):
        raise ValueError("Position name must use Latin script")
    return normalized


def is_employee_lifecycle_leader(job_title: str | None) -> bool:
    """Recognise actual leadership positions, not a leader's assistant or specialist."""
    if is_calendar_audience_leader(job_title):
        return True
    apostrophes = str.maketrans({"‘": "'", "’": "'", "ʻ": "'", "ʼ": "'", "`": "'"})
    normalized = " ".join((job_title or "").translate(apostrophes).casefold().split())
    if normalized in {"bosh hisobchi", "direktor"}:
        return True
    return (
        normalized.endswith(("boshlig'i", "boshligi", "rahbari"))
        and any(word in normalized for word in ("bo'lim", "bo'linma", "departament", "boshqarma"))
    )
