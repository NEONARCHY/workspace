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
