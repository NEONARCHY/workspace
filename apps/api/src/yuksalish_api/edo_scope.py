"""Read-only scope sent to EDO in the authenticated employee assertion."""

import hashlib
import json
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

MAX_SCOPE_EMPLOYEES = 100
SCOPE_HEADER = "X-Workspace-Read-Scope"


@dataclass(frozen=True)
class EdoReadScope:
    mode: Literal["assigned", "employees", "all"] = "assigned"
    employee_ids: tuple[UUID, ...] = ()

    def __post_init__(self) -> None:
        if self.mode not in {"assigned", "employees", "all"}:
            raise ValueError("Unknown EDO read scope")
        if self.mode == "employees":
            if not 1 <= len(self.employee_ids) <= MAX_SCOPE_EMPLOYEES:
                raise ValueError("Invalid EDO employee scope size")
            if len(set(self.employee_ids)) != len(self.employee_ids):
                raise ValueError("Duplicate EDO scope employee")
        elif self.employee_ids:
            raise ValueError("Employee IDs are only valid for an employee scope")

    @property
    def expanded(self) -> bool:
        return self.mode != "assigned"

    @property
    def visibility(self) -> Literal["assigned", "departments", "all"]:
        return "departments" if self.mode == "employees" else self.mode

    def claim(self) -> dict[str, object]:
        return {
            "version": 1,
            "mode": self.mode,
            "employee_ids": sorted(str(value) for value in self.employee_ids),
        }

    def digest(self) -> str:
        canonical = json.dumps(self.claim(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("ascii")).hexdigest()
