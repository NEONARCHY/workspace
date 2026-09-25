"""Recognize configured signers despite Workspace patronymics and name order."""

# ruff: noqa: RUF001
from __future__ import annotations

import re

_SIGNERS: tuple[tuple[tuple[tuple[str, str], ...], str], ...] = (
    (
        (
            ("bobur", "bekmurodov"), ("b", "bekmurodov"),
            ("бобур", "бекмуродов"), ("б", "бекмуродов"),
        ),
        "Bobur Bekmurodov",
    ),
    (
        (
            ("askar", "mamatxanov"), ("askar", "mamatkhanov"),
            ("a", "mamatxanov"), ("a", "mamatkhanov"),
            ("аскар", "маматханов"), ("а", "маматханов"),
        ),
        "Askar Mamatxanov",
    ),
    (
        (("umid", "rajabov"), ("u", "rajabov"), ("умид", "ражабов"), ("у", "ражабов")),
        "Umid Rajabov",
    ),
    (
        (
            ("davronbek", "lutfiddinov"),
            ("davronbek", "lyutfiddinov"),
            ("davron", "lutfiddinov"),
            ("davron", "lyutfiddinov"),
            ("d", "lutfiddinov"),
            ("d", "lyutfiddinov"),
            ("давронбек", "лютфиддинов"),
            ("даврон", "лютфиддинов"),
            ("д", "лютфиддинов"),
        ),
        "Davronbek Lutfiddinov",
    ),
)


def canonical_reviewer_name(display_name: str) -> str:
    """Map four known people by name/initial and surname; never infer from a role."""
    tokens = set(re.findall(r"[^\W\d_]+", display_name.casefold()))
    matches = [
        canonical
        for pairs, canonical in _SIGNERS
        if any(first in tokens and surname in tokens for first, surname in pairs)
    ]
    return matches[0] if len(matches) == 1 else display_name
