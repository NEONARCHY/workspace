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
from uuid import UUID, uuid4


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
                CREATE UNIQUE INDEX IF NOT EXISTS uq_offline_external_letter
                    ON external_effects(letter_id);
                CREATE TABLE IF NOT EXISTS number_reservations (
                    reservation_id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL,
                    requested_count INTEGER NOT NULL CHECK (requested_count BETWEEN 1 AND 20),
                    year_suffix TEXT,
                    first_number INTEGER,
                    last_number INTEGER,
                    next_number INTEGER,
                    valid_until TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS number_assignments (
                    letter_id TEXT PRIMARY KEY,
                    reservation_id TEXT NOT NULL REFERENCES number_reservations(reservation_id),
                    year_suffix TEXT NOT NULL,
                    outgoing_number INTEGER NOT NULL,
                    assigned_at TEXT NOT NULL,
                    UNIQUE (year_suffix, outgoing_number)
                );
                CREATE TABLE IF NOT EXISTS authority_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    agent_id TEXT NOT NULL,
                    epoch TEXT NOT NULL,
                    phase TEXT NOT NULL CHECK (phase IN ('online', 'offline', 'replay')),
                    updated_at TEXT NOT NULL
                );
                """
            )

    def authority_state(self) -> dict[str, str] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT agent_id, epoch, phase, updated_at FROM authority_state WHERE id = 1"
            ).fetchone()
        return dict(row) if row is not None else None

    def set_authority_phase(self, agent_id: str, epoch: str, phase: str) -> None:
        """Durably fence a phase transition; a restarted bot cannot invent a lease."""
        epoch = str(UUID(epoch))
        if not agent_id or len(agent_id) > 128 or phase not in {"online", "offline", "replay"}:
            raise ValueError("Недействительное состояние аренды робота.")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT agent_id, epoch, phase FROM authority_state WHERE id = 1"
            ).fetchone()
            if row is None:
                if phase != "online":
                    raise ValueError("Нельзя работать автономно без подтверждённой аренды.")
                connection.execute(
                    "INSERT INTO authority_state VALUES (1, ?, ?, ?, ?)",
                    (agent_id, epoch, phase, _now()),
                )
                return
            if row["agent_id"] != agent_id or row["epoch"] != epoch:
                raise ValueError("Аренда относится к другому роботу или эпохе.")
            if (row["phase"], phase) not in {
                ("online", "online"), ("online", "offline"), ("online", "replay"),
                ("offline", "offline"), ("offline", "replay"), ("replay", "replay"),
            }:
                raise ValueError("Нельзя возобновить запись до сверки журнала.")
            connection.execute(
                "UPDATE authority_state SET phase = ?, updated_at = ? WHERE id = 1",
                (phase, _now()),
            )

    def prepare_number_reservation(self, agent_id: str, count: int) -> str:
        """Persist the idempotency key before asking the server for a range."""
        if not agent_id or len(agent_id) > 128 or not 1 <= count <= 20:
            raise ValueError("Неверный агент или размер резерва.")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            pending = connection.execute(
                "SELECT reservation_id FROM number_reservations WHERE agent_id = ? "
                "AND requested_count = ? AND first_number IS NULL "
                "ORDER BY created_at LIMIT 1",
                (agent_id, count),
            ).fetchone()
            if pending is not None:
                return str(pending["reservation_id"])
            reservation_id = str(uuid4())
            connection.execute(
                "INSERT INTO number_reservations "
                "(reservation_id, agent_id, requested_count, created_at) VALUES (?, ?, ?, ?)",
                (reservation_id, agent_id, count, _now()),
            )
            return reservation_id

    def save_number_reservation(self, response: dict[str, Any]) -> None:
        """Only a matching, unexpired server-issued range can become spendable."""
        reservation_id = str(UUID(str(response["reservationId"])))
        agent_id = str(response["agentId"])
        year_suffix = str(response["yearSuffix"])
        first_number, last_number = int(response["firstNumber"]), int(response["lastNumber"])
        valid_until = datetime.fromisoformat(str(response["validUntil"]).replace("Z", "+00:00"))
        now = datetime.now(UTC)
        if (
            len(year_suffix) != 2 or not year_suffix.isdecimal()
            or first_number < 1 or last_number < first_number
            or valid_until.tzinfo is None or valid_until <= now
            or year_suffix != now.strftime("%y")
        ):
            raise ValueError("Сервер вернул недействительный резерв номеров.")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM number_reservations WHERE reservation_id = ?", (reservation_id,)
            ).fetchone()
            if row is None or row["agent_id"] != agent_id or (
                last_number - first_number + 1 != row["requested_count"]
            ):
                raise ValueError("Резерв не соответствует сохранённому запросу.")
            if row["first_number"] is not None:
                if (row["year_suffix"], row["first_number"], row["last_number"],
                    row["valid_until"]) != (
                    year_suffix, first_number, last_number, valid_until.isoformat()
                ):
                    raise ValueError("Повторный ответ изменил уже сохранённый резерв.")
                return
            overlap = connection.execute(
                "SELECT 1 FROM number_reservations WHERE reservation_id != ? "
                "AND year_suffix = ? AND first_number <= ? AND last_number >= ? LIMIT 1",
                (reservation_id, year_suffix, last_number, first_number),
            ).fetchone()
            if overlap is not None:
                raise ValueError("Диапазоны резервов пересекаются.")
            connection.execute(
                "UPDATE number_reservations SET year_suffix = ?, first_number = ?, "
                "last_number = ?, next_number = ?, valid_until = ? WHERE reservation_id = ?",
                (year_suffix, first_number, last_number, first_number,
                 valid_until.isoformat(), reservation_id),
            )

    def take_reserved_number(self, letter_id: str, agent_id: str) -> tuple[int, str]:
        """Assign once per letter; a crash may create a gap but never a duplicate."""
        letter_id = str(UUID(letter_id))
        now = datetime.now(UTC)
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            assigned = connection.execute(
                "SELECT outgoing_number, year_suffix FROM number_assignments "
                "WHERE letter_id = ?", (letter_id,)
            ).fetchone()
            if assigned is not None:
                return int(assigned["outgoing_number"]), str(assigned["year_suffix"])
            row = connection.execute(
                "SELECT * FROM number_reservations WHERE agent_id = ? AND year_suffix = ? "
                "AND valid_until > ? AND next_number <= last_number "
                "ORDER BY first_number LIMIT 1",
                (agent_id, now.strftime("%y"), now.isoformat()),
            ).fetchone()
            if row is None:
                raise ValueError("Нет действующего резерва исходящих номеров.")
            number = int(row["next_number"])
            connection.execute(
                "UPDATE number_reservations SET next_number = ? WHERE reservation_id = ?",
                (number + 1, row["reservation_id"]),
            )
            connection.execute(
                "INSERT INTO number_assignments VALUES (?, ?, ?, ?, ?)",
                (letter_id, row["reservation_id"], row["year_suffix"], number, now.isoformat()),
            )
            return number, str(row["year_suffix"])

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
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                "SELECT letter_id, kind FROM external_effects WHERE effect_id = ?",
                (effect_id,),
            ).fetchone()
            if existing is not None and (existing["letter_id"], existing["kind"]) != (
                letter_id, kind
            ):
                raise ValueError("Повторный идентификатор отправки относится к другому письму.")
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
