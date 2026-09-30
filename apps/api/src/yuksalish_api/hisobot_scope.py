"""Resolve Hisobot contour from the employee's current Workspace department."""

# Uzbek Cyrillic and Latin apostrophes are deliberate aliases, not homoglyph typos.
# ruff: noqa: RUF001

import re
from collections.abc import Mapping
from typing import Any, Literal
from uuid import UUID

from .telegram_access_schemas import HISOBOT_REGIONS

_REGION_ALIASES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Қорақалпоғистон Республикаси", ("qoraqalpogiston", "qoraqalpog‘iston", "қорақалпоғистон")),
    ("Андижон вилояти", ("andijon", "андижон")),
    ("Бухоро вилояти", ("buxoro", "бухоро")),
    ("Фарғона вилояти", ("fargona", "farg‘ona", "фарғона")),
    ("Жиззах вилояти", ("jizzax", "жиззах")),
    ("Наманган вилояти", ("namangan", "наманган")),
    ("Навоий вилояти", ("navoiy", "навоий")),
    ("Қашқадарё вилояти", ("qashqadaryo", "қашқадарё")),
    ("Самарқанд вилояти", ("samarqand", "самарқанд")),
    ("Сирдарё вилояти", ("sirdaryo", "сирдарё")),
    ("Сурхондарё вилояти", ("surxondaryo", "сурхондарё")),
    ("Тошкент шаҳри", ("toshkent shahar", "toshkent shahri", "тошкент шаҳ")),
    ("Тошкент вилояти", ("toshkent viloyat", "тошкент вилоят")),
    ("Хоразм вилояти", ("xorazm", "хоразм")),
)


def _region_in_department(department: Mapping[str, Any]) -> str | None:
    value = f"{department['name']} {department['code']}".casefold()
    value = re.sub(r"[’ʻ‘`']", "", value).replace("_", " ").replace("-", " ")
    for region, aliases in _REGION_ALIASES:
        if any(re.sub(r"[’ʻ‘`']", "", alias) in value for alias in aliases):
            return region
    return None


def effective_hisobot_scope(
    department_id: UUID | None,
    department_rows: Mapping[UUID, Any],
    stored_scope: str | None,
    stored_region: str | None,
) -> tuple[Literal["central", "hudud"], str | None]:
    """A department owns the contour; legacy manual grants cover unassigned people.

    For a regional department with no recognisable region in its name/code or
    ancestry, keep an explicitly configured region instead of guessing another.
    """
    department = department_rows.get(department_id) if department_id else None
    if department is None:
        return ("hudud", stored_region) if stored_scope == "hudud" else ("central", None)
    if department["scope"] == "central":
        return "central", None
    current = department
    seen: set[UUID] = set()
    while current is not None and current["id"] not in seen:
        seen.add(current["id"])
        region = _region_in_department(current)
        if region:
            return "hudud", region
        current = department_rows.get(current["parent_id"]) if current["parent_id"] else None
    return "hudud", stored_region if stored_region in HISOBOT_REGIONS else None
