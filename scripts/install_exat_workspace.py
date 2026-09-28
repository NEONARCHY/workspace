# ruff: noqa: RUF001
"""Install the versioned Workspace reviewer adapter into an existing Exat source tree.

Dry-run by default. No process, bot, database, container or server is started.
Unknown source anchors fail before any file is written. Original sources are backed up.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1] / "integrations/exat/workspace_integration"
MARKER = "# workspace-reviewers-v1"
SHARED_MARKER = "# workspace-shared-v2"


def patch_shared(relative: str, source: str) -> str:
    if SHARED_MARKER in source or relative == "src/gui.py":
        return source
    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)
    additions: list[tuple[int, str]] = []
    if relative == "src/outgoing/telegram_bot.py":
        methods = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef) and node.name == "run_polling"
        ]
        if len(methods) != 1:
            raise ValueError("Не найдена единственная точка запуска бота Exat.")
        additions.append(
            (
                methods[0].body[0].lineno - 1,
                f"        {SHARED_MARKER}\n"
                "        from src.workspace_integration.shared_bot import enabled, run_shared\n"
                "        if enabled():\n"
                "            return run_shared(self, max_updates=max_updates,\n"
                "                              stop_after_idle_seconds=stop_after_idle_seconds)\n",
            )
        )
    elif relative == "src/outgoing/service.py":
        protected = {
            "create_review_request",
            "create_from_draft",
            "replace_review_request_draft",
            "request_review_comment",
            "submit_review_comment",
            "reject_review_request",
            "cancel_review_request_by_sender",
            "approve_review_request",
            "release_final_approval",
            "confirm_manual_send_for_review_request",
            "confirm_manual_send",
            "handle_review",
            "retry_outgoing_send",
            "mark_review_request_manually_sent",
            "mark_outgoing_manually_sent",
            "retry_review_request_send",
            "force_delete_review_request",
            "renumber_prepared_letter",
            "queue_review_request",
            "queue_referent_manual_send",
            "activate_next_queued_review_request",
            "clear_stuck_queue_state",
            "verify_prepared_exat_send",
            "reconcile_prepared_exat_sends",
            "reject_prepared_send_for_review_request",
            "cleanup_returned_draft",
            "prepare_exat_compose",
            "mark_edo_delivered",
            "mark_edo_delivery_failed",
        }
        found = {
            node.name: node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef) and node.name in protected
        }
        if not {"handle_review", "confirm_manual_send", "approve_review_request"} <= found.keys():
            raise ValueError("Неизвестная версия жизненного цикла Exat.")
        for node in found.values():
            additions.append(
                (
                    node.body[0].lineno - 1,
                    f"        {SHARED_MARKER}\n"
                    "        from src.workspace_integration.authority import (\n"
                    "            guard_legacy_mutation)\n"
                    "        guard_legacy_mutation()\n",
                )
            )
    for index, value in sorted(additions, reverse=True):
        lines.insert(index, value)
    result = "".join(lines)
    compile(result, relative, "exec")
    return result


def replace_once(source: str, old: str, new: str) -> str:
    if source.count(old) != 1:
        raise ValueError(
            "Версия исходников Exat отличается: ожидаемый участок не найден однозначно."
        )
    return source.replace(old, new, 1)


def patch_source(relative: str, source: str) -> str:
    if MARKER in source:
        return source
    if relative == "src/gui.py":
        source = replace_once(
            source,
            "        self.root.after(900, self._auto_start_outgoing_telegram_bot)",
            f"        {MARKER}\n"
            "        from src.workspace_integration.gui import attach_gui\n"
            "        attach_gui(self)\n"
            "        self.root.after(900, self._auto_start_outgoing_telegram_bot)",
        )
        source = replace_once(
            source,
            "    def save_outgoing_reviewer_settings(self) -> None:\n",
            "    def save_outgoing_reviewer_settings(self) -> None:\n"
            "        from src.workspace_integration.gui import open_shared_settings\n"
            "        if open_shared_settings(self):\n"
            "            return\n",
        )
    elif relative == "src/outgoing/telegram_bot.py":
        actor_anchor = (
            "    def _is_allowed_actor(self, from_user: dict[str, Any] | None, "
            'chat_id: str = "") -> bool:\n'
        )
        source = replace_once(
            source,
            actor_anchor,
            actor_anchor
            + "        if self.service.outgoing_settings.get('workspace_configuration_revision'):\n"
            "            actor_id = str((from_user or {}).get('id') or '')\n"
            "            if any(item['telegram_id'] == actor_id\n"
            "                   for item in self.service.reviewers()):\n"
            "                return True\n",
        )
        source = replace_once(
            source,
            "        last_exat_reconcile_check = 0.0\n        while True:\n",
            f"        {MARKER}\n"
            "        from src.workspace_integration.runtime import refresh_bot\n"
            "        last_exat_reconcile_check = 0.0\n        while True:\n"
            "            if not refresh_bot(self):\n                continue\n",
        )
        source = replace_once(
            source,
            "            for update in updates:\n",
            "            for update in updates:\n"
            "                if not refresh_bot(self):\n                    break\n",
        )
        for name, helper in (
            ("_is_bobur_reviewer_entry", "is_bobur"),
            ("_is_preliminary_reviewer_entry", "is_preliminary"),
        ):
            anchor = f"def {name}(entry: dict[str, Any] | None) -> bool:\n"
            source = replace_once(
                source,
                anchor,
                anchor + f"    from src.workspace_integration.runtime import {helper}\n"
                f"    shared = {helper}(entry)\n"
                "    if shared is not None:\n        return shared\n",
            )
    elif relative == "src/outgoing/service.py":
        source = replace_once(
            source,
            "    def reviewers(self) -> list[dict[str, str]]:\n",
            "    def reviewers(self) -> list[dict[str, str]]:\n"
            f"        {MARKER}\n"
            "        if self.outgoing_settings.get('workspace_configuration_revision'):\n"
            "            return list(self.outgoing_settings['telegram'].get('reviewers', []))\n",
        )
        for name, model in (
            ("create_review_request", "OutgoingReviewRequestCreate"),
            ("create_from_draft", "OutgoingCreateRequest"),
        ):
            anchor = f"    def {name}(self, request: {model}) -> dict[str, Any]:\n"
            source = replace_once(
                source,
                anchor,
                anchor
                + "        from src.workspace_integration.runtime import validate_recipient\n"
                "        validate_recipient(self, request)\n",
            )
        anchor = (
            "        defer_send = bool(self.outgoing_settings.get("
            '"bobur_final_send_confirmation", False)) and (\n'
        )
        source = replace_once(
            source,
            anchor,
            "        from src.workspace_integration.runtime import final_reviewer_matches\n"
            + anchor,
        )
        anchor = (
            '            str(row["reviewer_telegram_id"] or "").strip() '
            "== BOBUR_REVIEWER_TELEGRAM_ID\n"
        )
        source = replace_once(
            source,
            anchor,
            "            final_reviewer_matches(self,\n"
            "                str(row['reviewer_telegram_id'] or '').strip(),\n"
            "                str(row['reviewer_telegram_id'] or '').strip()\n"
            "                == BOBUR_REVIEWER_TELEGRAM_ID)\n",
        )
    else:
        raise ValueError("Неизвестная точка интеграции")
    compile(source, relative, "exec")
    return source


def patch_number_backing(source: str) -> str:
    """Widen only the white mask, keeping the number/date text anchor unchanged."""
    marker = "# workspace-number-backing-v1"
    if marker in source:
        return source
    source = replace_once(
        source,
        "        shape = document.Shapes.AddTextbox(1, 82, 126, 245, 27)",
        f"        {marker}\n"
        "        # Extend the mask 38pt left; retain the text at x=82pt.\n"
        "        shape = document.Shapes.AddTextbox(1, 44, 126, 283, 27)",
    )
    source = replace_once(source, "            shape.TextFrame.MarginLeft = 0",
                          "            shape.TextFrame.MarginLeft = 38")
    source = replace_once(
        source,
        "            page.draw_rect(rect, color=None, fill=(1, 1, 1), overlay=True)",
        "            backing = fitz.Rect(min(rect.x0, 44), rect.y0, rect.x1, rect.y1)\n"
        "            page.draw_rect(backing, color=None, fill=(1, 1, 1), overlay=True)",
    )
    compile(source, "src/outgoing/facsimile.py", "exec")
    return source


def patch_signature_identity(source: str) -> str:
    """Resolve full Workspace names before Exat's existing image and row lookup."""
    marker = "# workspace-signature-identity-v1"
    if source.count(marker) == 2:
        return source
    if marker in source:
        raise ValueError("Частично обновлён механизм распознавания подписанта Exat.")
    for header, indent in (
        (
            "    def _resolve_signature_image(self, reviewer_name: str) -> Path | None:\n",
            "        ",
        ),
        ("def _signature_name_variants(reviewer_name: str) -> tuple[str, ...]:\n", "    "),
    ):
        anchor = header + f"{indent}normalized = normalize_search_text(reviewer_name)\n"
        replacement = (
            header
            + f"{indent}{marker}\n"
            + f"{indent}from src.workspace_integration.signature_identity "
            "import canonical_reviewer_name\n"
            + f"{indent}normalized = normalize_search_text("
            "canonical_reviewer_name(reviewer_name))\n"
        )
        source = replace_once(source, anchor, replacement)
    compile(source, "src/outgoing/facsimile.py", "exec")
    return source


def patch_portable_facsimile(source: str) -> str:
    marker = "# workspace-portable-signatures-v1"
    if marker in source:
        return source
    old = (
        "def _runtime_root() -> Path:\n"
        "    return Path(getattr(sys, \"_MEIPASS\", Path(__file__).resolve().parents[2]))\n"
    )
    new = (
        "def _runtime_root() -> Path:\n"
        f"    {marker}\n"
        "    from src.app.config import project_root_from_here\n"
        "    return project_root_from_here()\n"
    )
    patched = replace_once(source, old, new)
    compile(patched, "src/outgoing/facsimile.py", "exec")
    return patched


def patch_portable_config(source: str) -> str:
    """Frozen Exat must use the destination PC's configuration, never build-PC secrets."""
    marker = "# workspace-portable-config-v1"
    if marker in source:
        return source
    old = (
        "    if getattr(sys, \"frozen\", False):\n"
        "        bundle_root = getattr(sys, \"_MEIPASS\", None)\n"
        "        if bundle_root:\n"
        "            return Path(str(bundle_root))\n"
        "        return Path(sys.executable).resolve().parent\n"
    )
    new = (
        f"    {marker}\n"
        "    if getattr(sys, \"frozen\", False):\n"
        "        executable_dir = Path(sys.executable).resolve().parent\n"
        "        required = (\"settings.yaml\", \"employees.yaml\", \"rules.yaml\",\n"
        "                    \"exat_selectors.yaml\", \"platform_selectors.yaml\")\n"
        "        for root in (executable_dir, executable_dir.parent):\n"
        "            if all((root / \"config\" / name).is_file() for name in required):\n"
        "                return root\n"
        "        raise FileNotFoundError(\n"
        "            \"Не найдена внешняя папка config рядом с EXE или в его родительской \"\n"
        "            \"папке. Сохраните настройки с ПК референта перед обновлением.\"\n"
        "        )\n"
    )
    patched = replace_once(source, old, new)
    compile(patched, "src/app/config.py", "exec")
    return patched


def patch_portable_spec(source: str) -> str:
    """Keep confidential runtime assets outside the one-file executable."""
    marker = "# workspace-external-assets-v1"
    if marker in source:
        return source
    old = (
        "    datas=[\n"
        "        ('config', 'config'),\n"
        "        ('organizations_unified.md', '.'),\n"
        "        ('actual list of organizations.md', '.'),\n"
        "        ('assets\\\\signatures', 'assets\\\\signatures'),\n"
        "    ] + tzdata_files,\n"
    )
    patched = replace_once(source, old, f"    {marker}\n    datas=tzdata_files,\n")
    compile(patched, "YuksalishAIReferent.spec", "exec")
    return patched


def patch_portable_worker(source: str) -> str:
    """Incoming worker must load its .env and catalog from the destination tree."""
    marker = "# workspace-portable-worker-v1"
    if marker in source:
        return source
    source = replace_once(
        source,
        "from src.app.config import load_project_config\n",
        "from src.app.config import load_project_config, project_root_from_here\n",
    )
    source = replace_once(
        source,
        "        self.project_root = Path(project_root) if project_root "
        "else Path(__file__).resolve().parents[2]\n",
        f"        {marker}\n"
        "        self.project_root = Path(project_root) if project_root "
        "else project_root_from_here()\n",
    )
    compile(source, "src/app/worker.py", "exec")
    return source


def patch_portable_installer(source: str) -> str:
    """New installs receive external files; upgrades keep local config and signatures."""
    marker = "; workspace-external-assets-v1"
    if marker in source:
        return source
    anchor = (
        '[Files]\n'
        'Source: "..\\dist\\YuksalishAIReferent.exe"; DestDir: "{app}"; Flags: ignoreversion\n'
    )
    replacement = anchor + (
        f"{marker}\n"
        'Source: "..\\config\\*.yaml"; DestDir: "{app}\\config"; '
        'Flags: ignoreversion onlyifdoesntexist\n'
        'Source: "..\\organizations_unified.md"; DestDir: "{app}"; '
        'Flags: ignoreversion onlyifdoesntexist\n'
        'Source: "..\\actual list of organizations.md"; DestDir: "{app}"; '
        'Flags: ignoreversion onlyifdoesntexist\n'
        'Source: "..\\assets\\signatures\\*"; DestDir: "{app}\\assets\\signatures"; '
        'Flags: ignoreversion onlyifdoesntexist\n'
    )
    return replace_once(source, anchor, replacement)


def install(root: Path, *, apply: bool = False) -> dict[str, object]:
    root = root.resolve(strict=True)
    if not root.is_dir() or root == Path(root.anchor):
        raise ValueError("Укажите конкретную папку исходников Exat.")
    planned: dict[Path, bytes] = {}
    for relative in ("src/gui.py", "src/outgoing/telegram_bot.py", "src/outgoing/service.py"):
        path = (root / relative).resolve(strict=True)
        if not path.is_relative_to(root):
            raise ValueError("Путь исходников выходит за пределы Exat.")
        original = path.read_bytes()
        source = original.decode("utf-8-sig").replace("\r\n", "\n")
        patched = patch_shared(relative, patch_source(relative, source))
        if patched != source:
            planned[path] = patched.replace("\n", "\r\n" if b"\r\n" in original else "\n").encode(
                "utf-8"
            )
    facsimile = root / "src/outgoing/facsimile.py"
    if facsimile.exists():
        if not facsimile.resolve().is_relative_to(root):
            raise ValueError("Путь исходников выходит за пределы Exat.")
        original = facsimile.read_bytes()
        source = original.decode("utf-8-sig").replace("\r\n", "\n")
        patched = patch_portable_facsimile(
            patch_signature_identity(patch_number_backing(source))
        )
        if patched != source:
            planned[facsimile] = patched.replace(
                "\n", "\r\n" if b"\r\n" in original else "\n"
            ).encode("utf-8")
    portable_paths = {
        "src/app/config.py": patch_portable_config,
        "src/app/worker.py": patch_portable_worker,
        "YuksalishAIReferent.spec": patch_portable_spec,
        "installer/YuksalishAIReferent.iss": patch_portable_installer,
    }
    present = [relative for relative in portable_paths if (root / relative).exists()]
    if present and len(present) != len(portable_paths):
        raise ValueError(
            "Для переносимой сборки нужны config.py, worker.py, spec и installer Exat."
        )
    for relative in present:
        path = (root / relative).resolve(strict=True)
        if not path.is_relative_to(root):
            raise ValueError("Путь сборки выходит за пределы Exat.")
        original = path.read_bytes()
        source = original.decode("utf-8-sig").replace("\r\n", "\n")
        patched = portable_paths[relative](source)
        if patched != source:
            planned[path] = patched.replace(
                "\n", "\r\n" if b"\r\n" in original else "\n"
            ).encode("utf-8")
    destination = root / "src/workspace_integration"
    if not destination.resolve().is_relative_to(root):
        raise ValueError("Каталог адаптера выходит за пределы Exat.")
    for source in PACKAGE.glob("*.py"):
        content = source.read_bytes()
        compile(content, str(source), "exec")
        path = destination / source.name
        if not path.resolve().is_relative_to(root):
            raise ValueError("Файл адаптера выходит за пределы Exat.")
        if not path.exists() or path.read_bytes() != content:
            planned[path] = content
    backup: Path | None = None
    if apply and planned:
        backup = (
            root / ".workspace-integration-backups" / datetime.now(UTC).strftime("%Y%m%d-%H%M%S-%f")
        )
        if not backup.resolve().is_relative_to(root):
            raise ValueError("Каталог резервной копии выходит за пределы Exat.")
        backup.mkdir(parents=True, exist_ok=False)
        manifest = {}
        for path in planned:
            relative = path.relative_to(root)
            manifest[str(relative)] = (
                hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
            )
            if path.exists():
                saved = backup / relative
                saved.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, saved)
        (backup / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        for path, content in planned.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(".workspace-tmp")
            temporary.write_bytes(content)
            temporary.replace(path)
    return {
        "mode": "applied" if apply else "dry-run",
        "root": str(root),
        "changedFiles": [str(path.relative_to(root)) for path in planned],
        "backup": str(backup) if backup else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exat-root", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(install(args.exat_root, apply=args.apply), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
