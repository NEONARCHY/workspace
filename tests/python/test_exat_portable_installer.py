"""The transferable EXE reads destination-PC assets, not build-PC secrets."""

import importlib
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def installer(monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / "scripts"))
    return importlib.import_module("install_exat_workspace")


def test_frozen_exat_config_requires_external_files(installer, monkeypatch, tmp_path):
    original = (
        "from pathlib import Path\nimport sys\n\n"
        "def project_root_from_here() -> Path:\n"
        '    if getattr(sys, "frozen", False):\n'
        '        bundle_root = getattr(sys, "_MEIPASS", None)\n'
        "        if bundle_root:\n"
        "            return Path(str(bundle_root))\n"
        "        return Path(sys.executable).resolve().parent\n"
        "    return Path(__file__).resolve().parents[2]\n"
    )
    patched = installer.patch_portable_config(original)
    assert installer.patch_portable_config(patched) == patched
    namespace = {"__file__": str(tmp_path / "src/app/config.py")}
    exec(compile(patched, "config.py", "exec"), namespace)
    project = tmp_path / "referent"
    config = project / "config"
    config.mkdir(parents=True)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path / "build-pc"), raising=False)
    monkeypatch.setattr(sys, "executable", str(project / "dist/YuksalishAIReferent.exe"))
    with pytest.raises(FileNotFoundError, match="внешняя папка config"):
        namespace["project_root_from_here"]()
    for name in (
        "settings.yaml", "employees.yaml", "rules.yaml", "exat_selectors.yaml",
        "platform_selectors.yaml",
    ):
        (config / name).write_text("{}", encoding="utf-8")
    assert namespace["project_root_from_here"]() == project


def test_portable_spec_excludes_config_signatures_and_address_book(installer):
    original = (
        "tzdata_files = []\n"
        "def Analysis(**kwargs):\n    return kwargs\n"
        "result = Analysis(\n"
        "    datas=[\n"
        "        ('config', 'config'),\n"
        "        ('organizations_unified.md', '.'),\n"
        "        ('actual list of organizations.md', '.'),\n"
        "        ('assets\\\\signatures', 'assets\\\\signatures'),\n"
        "    ] + tzdata_files,\n"
        ")\n"
    )
    patched = installer.patch_portable_spec(original)
    assert installer.patch_portable_spec(patched) == patched
    namespace = {}
    exec(compile(patched, "YuksalishAIReferent.spec", "exec"), namespace)
    assert namespace["result"]["datas"] == []


def test_incoming_worker_uses_same_external_project_root(installer):
    original = (
        "from pathlib import Path\n"
        "from src.app.config import load_project_config\n"
        "class MVPWorker:\n"
        "    def __init__(self, project_root=None):\n"
        "        self.project_root = Path(project_root) if project_root "
        "else Path(__file__).resolve().parents[2]\n"
    )
    patched = installer.patch_portable_worker(original)
    assert installer.patch_portable_worker(patched) == patched
    assert "else project_root_from_here()" in patched


def test_signature_fallback_uses_external_project_assets(installer):
    original = (
        "from pathlib import Path\nimport sys\n"
        "def _runtime_root() -> Path:\n"
        '    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))\n'
    )
    patched = installer.patch_portable_facsimile(original)
    assert installer.patch_portable_facsimile(patched) == patched
    assert "return project_root_from_here()" in patched


def test_portable_installer_does_not_overwrite_target_config(installer):
    original = (
        "[Files]\n"
        'Source: "..\\dist\\YuksalishAIReferent.exe"; DestDir: "{app}"; '
        "Flags: ignoreversion\n"
    )
    patched = installer.patch_portable_installer(original)
    assert installer.patch_portable_installer(patched) == patched
    assert patched.count("onlyifdoesntexist") == 4
    assert "config\\*.yaml" in patched
    assert "assets\\signatures" in patched
