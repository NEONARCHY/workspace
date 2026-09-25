"""Full Workspace display names must resolve to the same known Exat signatures."""

# ruff: noqa: RUF001

import importlib
from pathlib import Path

import pytest


@pytest.mark.parametrize(
    ("display_name", "canonical"),
    [
        ("Бекмуродов Бобур Мансурович", "Bobur Bekmurodov"),
        ("Bekmurodov Bobur Mansurovich", "Bobur Bekmurodov"),
        ("B.Bekmurodov", "Bobur Bekmurodov"),
        ("Б.Бекмуродов", "Bobur Bekmurodov"),
        ("Маматханов Аскар Махмутович", "Askar Mamatxanov"),
        ("A.Mamatxanov", "Askar Mamatxanov"),
        ("А.Маматханов", "Askar Mamatxanov"),
        ("Ражабов Умид Махмудович", "Umid Rajabov"),
        ("U.Rajabov", "Umid Rajabov"),
        ("У.Ражабов", "Umid Rajabov"),
        ("Лютфиддинов Давронбек Бахтиёр угли", "Davronbek Lutfiddinov"),
        ("D.Lyutfiddinov", "Davronbek Lutfiddinov"),
        ("Д.Лютфиддинов", "Davronbek Lutfiddinov"),
        ("Другой Бобур", "Другой Бобур"),
        ("Неизвестный Бекмуродов", "Неизвестный Бекмуродов"),
    ],
)
def test_known_person_requires_both_name_and_surname(monkeypatch, display_name, canonical):
    root = Path(__file__).resolve().parents[2]
    monkeypatch.syspath_prepend(str(root / "integrations/exat"))
    identity = importlib.import_module("workspace_integration.signature_identity")
    assert identity.canonical_reviewer_name(display_name) == canonical


def test_facsimile_patch_is_idempotent_and_guards_unknown_versions(monkeypatch):
    root = Path(__file__).resolve().parents[2]
    monkeypatch.syspath_prepend(str(root / "scripts"))
    installer = importlib.import_module("install_exat_workspace")
    source = (
        "class FacsimileService:\n"
        "    def _resolve_signature_image(self, reviewer_name: str) -> Path | None:\n"
        "        normalized = normalize_search_text(reviewer_name)\n"
        "        return None\n\n"
        "def _signature_name_variants(reviewer_name: str) -> tuple[str, ...]:\n"
        "    normalized = normalize_search_text(reviewer_name)\n"
        "    return (normalized,)\n"
    )
    patched = installer.patch_signature_identity(source)
    assert patched.count("canonical_reviewer_name(reviewer_name)") == 2
    assert installer.patch_signature_identity(patched) == patched
    with pytest.raises(ValueError):
        installer.patch_signature_identity("def unknown():\n    pass\n")
