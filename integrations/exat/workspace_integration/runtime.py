"""Apply remote settings at the bot's operation boundary, without killing its process."""

from __future__ import annotations

import json
import sqlite3
import time
from contextlib import suppress
from datetime import UTC, datetime
from typing import Any

from .client import WorkspaceClient, WorkspaceError, connection_settings, legacy_bindings

REVIEWER_KEYS = ("bobur", "davronbek", "umid", "askar")
OPEN_STATUSES = (
    "waiting_review",
    "awaiting_comment",
    "needs_sender_revision",
    "signature_revision_needed",
    "queued_for_processing",
    "awaiting_final_send",
)


def active_bindings(config: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {
            "key": item["key"],
            "name": item["fullName"],
            "telegram_id": item["telegramId"],
            "workspace_username": item["username"],
            "workspace_user_id": item["userId"],
        }
        for item in config["reviewers"]
        if item["enabled"] and item["accountActive"] and item["canApprove"] and item["telegramId"]
    ]


def apply_configuration(service: Any, config: dict[str, Any]) -> list[int]:
    """Atomic local reassignment of still-open decisions; completed history stays intact."""
    incoming = active_bindings(config)
    next_by_key = {item["key"]: item for item in incoming}
    telegram = service.outgoing_settings.setdefault("telegram", {})
    original = telegram.get("reviewers", [])
    old_by_id = {str(item["telegram_id"]): item["key"] for item in incoming}
    old_by_id.update(
        {
            str(value): key
            for key, value in legacy_bindings().items()
            if key in REVIEWER_KEYS and value
        }
    )
    old_by_id.update(
        {
            str(item.get("telegram_id") or ""): item["key"]
            for item in original
            if item.get("key") in REVIEWER_KEYS
        }
    )
    changed_ids = []
    with service.database.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            "CREATE TABLE IF NOT EXISTS workspace_reviewer_state "
            "(id INTEGER PRIMARY KEY CHECK(id=1), configuration TEXT NOT NULL)"
        )
        connection.execute(
            "CREATE TABLE IF NOT EXISTS workspace_reviewer_notifications "
            "(review_id INTEGER PRIMARY KEY, last_attempt REAL NOT NULL DEFAULT 0)"
        )
        stored = connection.execute(
            "SELECT configuration FROM workspace_reviewer_state WHERE id=1"
        ).fetchone()
        if stored:
            previous = json.loads(stored[0])
            # Even disabled slots retain their last identity for later reactivation.
            old_by_id.update(
                {
                    str(item.get("telegramId") or f"disabled:{item['key']}"): item["key"]
                    for item in previous["reviewers"]
                }
            )
        old_by_id.update({f"disabled:{key}": key for key in REVIEWER_KEYS})
        rows = connection.execute("SELECT * FROM outgoing_review_requests").fetchall()
        now = datetime.now(UTC).isoformat()
        for row in rows:
            if row["status"] not in OPEN_STATUSES:
                continue
            values = {}
            for prefix in ("reviewer", "final_reviewer"):
                old_id = str(row[f"{prefix}_telegram_id"] or "")
                key = old_by_id.get(old_id)
                if not old_id:
                    continue
                if not key:
                    raise WorkspaceError(
                        "Для открытых писем отсутствует сопоставление прежнего "
                        "согласующего. Проверьте подключение в GUI Exat."
                    )
                target = next_by_key.get(key)
                new_id = target["telegram_id"] if target else f"disabled:{key}"
                new_name = target["name"] if target else row[f"{prefix}_name"]
                if new_id == old_id and new_name == row[f"{prefix}_name"]:
                    continue
                values[f"{prefix}_telegram_id"] = new_id
                values[f"{prefix}_name"] = new_name
            if not values:
                continue
            changed_ids.append(int(row["id"]))
            current_changed = "reviewer_telegram_id" in values
            if current_changed and row["status"] == "awaiting_comment":
                values["status"] = "waiting_review"
            if current_changed:
                values["reviewer_prompt_message_id"] = None
            values["updated_at"] = now
            # Column names come exclusively from the constants above, never remote input.
            assignments = ", ".join(f"{key} = ?" for key in values)
            connection.execute(
                f"UPDATE outgoing_review_requests SET {assignments} WHERE id = ?",
                (*values.values(), row["id"]),
            )
            if current_changed and row["status"] in {
                "waiting_review",
                "awaiting_comment",
                "awaiting_final_send",
            }:
                connection.execute(
                    "INSERT INTO workspace_reviewer_notifications(review_id) VALUES(?) "
                    "ON CONFLICT(review_id) DO UPDATE SET last_attempt=0",
                    (row["id"],),
                )
            connection.execute(
                "INSERT INTO outgoing_review_events "
                "(review_request_id,event_time,event_type,event_message,extra_json) "
                "VALUES (?,?,?,?,?)",
                (
                    row["id"],
                    now,
                    "workspace_reviewer_reassigned",
                    "Обновлён согласующий из Workspace",
                    json.dumps({"revision": config["revision"]}),
                ),
            )
        connection.execute(
            "INSERT INTO workspace_reviewer_state(id,configuration) VALUES(1,?) "
            "ON CONFLICT(id) DO UPDATE SET configuration=excluded.configuration",
            (json.dumps(config, ensure_ascii=False),),
        )
        connection.commit()
    telegram["reviewers"] = incoming
    service.outgoing_settings["workspace_configuration_revision"] = config["revision"]
    service.outgoing_settings["workspace_configuration_bindings"] = config["reviewers"]
    return changed_ids


def notify_reassigned(bot: Any) -> None:
    with bot.service.database.connect() as connection:
        pending = connection.execute(
            "SELECT review_id FROM workspace_reviewer_notifications WHERE last_attempt < ?",
            (time.time() - 60,),
        ).fetchall()
    valid_ids = {item["telegram_id"] for item in bot.service.reviewers()}
    for row in pending:
        review_id = row[0]
        review = bot.service.get_review_request(review_id)
        done = review["status"] not in {"waiting_review", "awaiting_final_send"}
        if not done and review["reviewer_telegram_id"] in valid_ids:
            if review["status"] == "awaiting_final_send":
                result = bot._notify_signed_or_offer_retry(
                    review,
                    bot.service._letter_payload(int(review["outgoing_id"])),
                )
            else:
                result = bot._notify_reviewer_or_offer_retry(review)
            done = result.get("status") == "sent"
        with bot.service.database.connect() as connection:
            if done:
                connection.execute(
                    "DELETE FROM workspace_reviewer_notifications WHERE review_id=?", (review_id,)
                )
            else:
                connection.execute(
                    "UPDATE workspace_reviewer_notifications SET last_attempt=? WHERE review_id=?",
                    (time.time(), review_id),
                )
            connection.commit()


def refresh_bot(bot: Any) -> bool:
    """False means configured integration is unavailable; don't execute stale decisions."""
    client = None
    fetched = False
    try:
        if not connection_settings().get("api_url"):
            return True
        client = WorkspaceClient()
        config = client.configuration()
        fetched = True
        if config["revision"] <= 1:
            raise WorkspaceError("Администратор ещё не настроил согласующих в Workspace.")
        previous = bot.service.outgoing_settings.get("workspace_configuration_bindings")
        if (
            previous != config["reviewers"]
            or bot.service.outgoing_settings.get("workspace_configuration_revision")
            != config["revision"]
        ):
            # Let an already running browser/send operation finish before applying changes.
            if (
                getattr(bot, "_queue_processing", False)
                or getattr(bot, "_exat_reconcile_running", False)
                or getattr(bot, "_queued_manual_send_ids", set())
            ):
                time.sleep(1)
                return False
            changed = apply_configuration(bot.service, config)
            bot._status_log(
                "workspace_configuration_applied",
                revision=config["revision"],
                reassigned_count=len(changed),
            )
        client.acknowledge(config["revision"])
        notify_reassigned(bot)
        return True
    except (WorkspaceError, OSError, ValueError, KeyError, sqlite3.Error) as exc:
        reason = str(exc) if isinstance(exc, WorkspaceError) else type(exc).__name__
        bot._status_log("workspace_configuration_unavailable", reason=reason)
        if client is not None and fetched:
            # Already reported locally; the API may itself be unavailable.
            with suppress(WorkspaceError):
                client.acknowledge(
                    bot.service.outgoing_settings.get("workspace_configuration_revision", 1),
                    error=reason,
                )
        time.sleep(3)
        return False


def validate_recipient(service: Any, request: Any) -> None:
    if not connection_settings().get("api_url"):
        return
    if not service.outgoing_settings.get("workspace_configuration_revision"):
        raise ValueError("Дождитесь загрузки согласующих Workspace.")
    valid_ids = {item["telegram_id"] for item in service.reviewers()}
    selected = [request.reviewer_telegram_id, getattr(request, "final_reviewer_telegram_id", "")]
    if any(str(value) not in valid_ids for value in selected if value):
        raise ValueError("Согласующий изменён. Выберите актуального получателя заново.")


def final_reviewer_matches(service: Any, telegram_id: str, legacy_match: bool) -> bool:
    if not service.outgoing_settings.get("workspace_configuration_revision"):
        return legacy_match
    return any(
        item.get("key") == "bobur" and item["telegram_id"] == telegram_id
        for item in service.reviewers()
    )


def is_bobur(entry: dict[str, Any] | None) -> bool | None:
    if entry and "key" in entry:
        return entry["key"] == "bobur"
    return None


def is_preliminary(entry: dict[str, Any] | None) -> bool | None:
    if entry and "key" in entry:
        return entry["key"] in {"askar", "umid", "davronbek"}
    return None
