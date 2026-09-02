from __future__ import annotations

import json
from importlib.resources import files
from pathlib import Path
from typing import Any

from . import MAPPING_VERSION
from .source import EXPECTED_TABLE_COLUMNS


def load_mapping(path: Path | None = None) -> dict[str, Any]:
    if path is None:
        raw = files("hisobot_import.spec").joinpath("mapping.v1.json").read_text(encoding="utf-8")
    else:
        raw = path.read_text(encoding="utf-8")
    payload: dict[str, Any] = json.loads(raw)
    return payload


def validate_mapping(payload: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    if payload.get("version") != MAPPING_VERSION:
        issues.append("mapping_version_mismatch")
    raw_mappings = payload.get("tables")
    if not isinstance(raw_mappings, list):
        return [*issues, "tables_must_be_a_list"]
    source_tables: list[str] = []
    for item in raw_mappings:
        if isinstance(item, dict) and isinstance(item.get("source"), str):
            source_tables.append(item["source"])
    if len(source_tables) != len(set(source_tables)):
        issues.append("duplicate_source_table")
    missing = sorted(set(EXPECTED_TABLE_COLUMNS) - set(source_tables))
    extra = sorted(set(source_tables) - set(EXPECTED_TABLE_COLUMNS))
    if missing:
        issues.append(f"missing_source_tables:{','.join(missing)}")
    if extra:
        issues.append(f"unknown_source_tables:{','.join(extra)}")
    for item in raw_mappings:
        if not isinstance(item, dict):
            issues.append("table_mapping_must_be_an_object")
            continue
        if not item.get("target") or not item.get("strategy") or not item.get("source_key"):
            issues.append(f"incomplete_mapping:{item.get('source', '<unknown>')}")
    return issues
