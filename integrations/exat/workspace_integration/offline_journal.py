"""Durable, actor-scoped journal for a future offline AI Referent authority.

This module does not switch the live bot into offline mode. An operation is
acknowledged only after the server has accepted it with its idempotency key.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _now() -> str:
    return datetime.now(UTC).isoformat()


class OfflineJournal:
    """Keep local operations and their blobs until explicitly acknowledged.

    The caller must use a single instance lock around the bot process. SQLite
    transactions serialize concurrent bot and worker threads within that process.
    """

    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.blobs = self.root / "blobs"
        self.blobs.mkdir(exist_ok=True)
        self.database = self.root / "offline-journal.sqlite"
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS operations (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    operation_id TEXT NOT NULL UNIQUE,
                    actor_id TEXT NOT NULL,
                    letter_id TEXT,
                    kind TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    blob_sha256 TEXT,
                    occurred_at TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'acknowledged', 'blocked')),
                    result TEXT,
                    FOREIGN KEY (blob_sha256) REFERENCES blobs(sha256)
                );
                CREATE TABLE IF NOT EXISTS blobs (
                    sha256 TEXT PRIMARY KEY,
                    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
                    name TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS snapshots (
                    actor_id TEXT NOT NULL,
                    resource TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    verified_at TEXT NOT NULL,
                    PRIMARY KEY (actor_id, resource)
                );
                CREATE TABLE IF NOT EXISTS external_effects (
                    effect_id TEXT PRIMARY KEY,
                    letter_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    outcome TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (outcome IN ('unknown', 'confirmed', 'not_sent')),
                    detail TEXT NOT NULL DEFAULT ''
                );
                """
            )

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database, timeout=15)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("PRAGMA foreign_keys=ON")
            with connection:
                yield connection
        finally:
            connection.close()

    def put_blob(self, content: bytes) -> str:
        digest = hashlib.sha256(content).hexdigest()
        target = self.blobs / digest
        if not target.is_file():
            descriptor, temporary = tempfile.mkstemp(prefix="blob-", dir=self.blobs)
            try:
                with os.fdopen(descriptor, "wb") as handle:
                    handle.write(content)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, target)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        if (
            target.stat().st_size != len(content)
            or hashlib.sha256(target.read_bytes()).hexdigest() != digest
        ):
            raise ValueError("Повреждён локальный файл автономного журнала.")
        with self.connect() as connection:
            connection.execute(
                "INSERT OR IGNORE INTO blobs (sha256, byte_size, name) VALUES (?, ?, ?)",
                (digest, len(content), digest),
            )
        return digest

    def read_blob(self, digest: str) -> bytes:
        if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
            raise ValueError("Недопустимый идентификатор файла.")
        with self.connect() as connection:
            row = connection.execute(
                "SELECT byte_size FROM blobs WHERE sha256 = ?", (digest,)
            ).fetchone()
        if row is None:
            raise FileNotFoundError("Локальный файл не зарегистрирован.")
        content = (self.blobs / digest).read_bytes()
        if len(content) != row["byte_size"] or hashlib.sha256(content).hexdigest() != digest:
            raise ValueError("Контрольная сумма локального файла не совпала.")
        return content

    def append(
        self,
        *,
        operation_id: str,
        actor_id: str,
        kind: str,
        payload: dict[str, Any],
        letter_id: str | None = None,
        blob_sha256: str | None = None,
        occurred_at: str | None = None,
    ) -> int:
        operation_id = str(UUID(operation_id))
        if letter_id is not None:
            letter_id = str(UUID(letter_id))
        if not actor_id.isdecimal() or not actor_id or not kind or len(kind) > 80:
            raise ValueError("Неверный автор или вид локальной операции.")
        data = _json(payload)
        timestamp = occurred_at or _now()
        datetime.fromisoformat(timestamp)
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                "SELECT * FROM operations WHERE operation_id = ?", (operation_id,)
            ).fetchone()
            if existing is not None:
                if (existing["actor_id"], existing["letter_id"], existing["kind"],
                    existing["payload"], existing["blob_sha256"]) != (
                    actor_id, letter_id, kind, data, blob_sha256
                ):
                    raise ValueError("Повторный operation_id содержит другие данные.")
                return int(existing["sequence"])
            if blob_sha256 is not None and connection.execute(
                "SELECT 1 FROM blobs WHERE sha256 = ?", (blob_sha256,)
            ).fetchone() is None:
                raise FileNotFoundError("Сначала сохраните файл в автономный журнал.")
            cursor = connection.execute(
                "INSERT INTO operations (operation_id, actor_id, letter_id, kind, payload, "
                "blob_sha256, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (operation_id, actor_id, letter_id, kind, data, blob_sha256, timestamp),
            )
            if cursor.lastrowid is None:
                raise RuntimeError("SQLite не подтвердил запись операции.")
            return cursor.lastrowid

    def pending(self, limit: int = 100) -> list[dict[str, Any]]:
        if not 1 <= limit <= 1000:
            raise ValueError("Недопустимый размер пакета синхронизации.")
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM operations WHERE status = 'pending' AND sequence < "
                "COALESCE((SELECT MIN(sequence) FROM operations WHERE status = 'blocked'), "
                "9223372036854775807) ORDER BY sequence LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {**dict(row), "payload": json.loads(row["payload"])} for row in rows
        ]

    def finish(self, sequence: int, *, accepted: bool, result: dict[str, Any]) -> None:
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT status, result FROM operations WHERE sequence = ?", (sequence,)
            ).fetchone()
            if row is None:
                raise ValueError("Локальная операция не найдена.")
            status = "acknowledged" if accepted else "blocked"
            encoded = _json(result)
            if row["status"] != "pending":
                if row["status"] != status or row["result"] != encoded:
                    raise ValueError("Итог операции уже зафиксирован иначе.")
                return
            earlier = connection.execute(
                "SELECT 1 FROM operations WHERE sequence < ? AND status != 'acknowledged' "
                "LIMIT 1",
                (sequence,),
            ).fetchone()
            if earlier is not None:
                raise ValueError("Синхронизируйте предыдущие операции по порядку.")
            connection.execute(
                "UPDATE operations SET status = ?, result = ? WHERE sequence = ?",
                (status, encoded, sequence),
            )

    def cache(self, actor_id: str, resource: str, payload: dict[str, Any]) -> None:
        if not actor_id.isdecimal() or not resource.startswith("/"):
            raise ValueError("Неверный ключ локальной копии.")
        with self.connect() as connection:
            connection.execute(
                "INSERT INTO snapshots VALUES (?, ?, ?, ?) "
                "ON CONFLICT(actor_id, resource) DO UPDATE SET "
                "payload=excluded.payload, verified_at=excluded.verified_at",
                (actor_id, resource, _json(payload), _now()),
            )

    def snapshot(self, actor_id: str, resource: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT payload, verified_at FROM snapshots WHERE actor_id = ? AND resource = ?",
                (actor_id, resource),
            ).fetchone()
        if row is None:
            return None
        return {"payload": json.loads(row["payload"]), "verifiedAt": row["verified_at"]}

    def cached_letter(self, actor_id: str, letter_id: str) -> dict[str, Any] | None:
        """Return only a letter that this actor received from the server earlier."""
        letter_id = str(UUID(letter_id))
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT payload FROM snapshots WHERE actor_id = ? AND resource LIKE '/letters?%'",
                (actor_id,),
            ).fetchall()
        for row in rows:
            for letter in json.loads(row["payload"]).get("letters", []):
                if isinstance(letter, dict) and letter.get("id") == letter_id:
                    return {str(key): value for key, value in letter.items()}
        return None

    def begin_external_effect(self, effect_id: str, letter_id: str, kind: str) -> bool:
        """False after a crash or retry: physical send must never auto-repeat."""
        effect_id, letter_id = str(UUID(effect_id)), str(UUID(letter_id))
        if kind not in {"exat_send", "webmail_send"}:
            raise ValueError("Недопустимый вид внешней отправки.")
        with self.connect() as connection:
            cursor = connection.execute(
                "INSERT OR IGNORE INTO external_effects "
                "(effect_id, letter_id, kind, started_at) VALUES (?, ?, ?, ?)",
                (effect_id, letter_id, kind, _now()),
            )
            return cursor.rowcount == 1

    def external_effect(self, effect_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM external_effects WHERE effect_id = ?", (str(UUID(effect_id)),)
            ).fetchone()
        return dict(row) if row else None

    def resolve_external_effect(
        self, effect_id: str, *, sent: bool, evidence: str
    ) -> None:
        """Record a human-checked outcome without permitting a second click."""
        if len(evidence.strip()) < 3:
            raise ValueError("Укажите подтверждение проверки внешнего журнала.")
        outcome = "confirmed" if sent else "not_sent"
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT outcome, detail FROM external_effects WHERE effect_id = ?",
                (str(UUID(effect_id)),),
            ).fetchone()
            if row is None:
                raise ValueError("Внешнее действие не найдено.")
            if row["outcome"] != "unknown":
                if row["outcome"] != outcome or row["detail"] != evidence.strip():
                    raise ValueError("Итог внешнего действия уже зафиксирован иначе.")
                return
            connection.execute(
                "UPDATE external_effects SET outcome = ?, detail = ? WHERE effect_id = ?",
                (outcome, evidence.strip(), str(UUID(effect_id))),
            )
