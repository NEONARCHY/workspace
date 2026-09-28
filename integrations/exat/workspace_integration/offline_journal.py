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
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _valid_actor_actions(actor: dict[str, Any]) -> bool:
    actions = actor.get("moduleActions")
    valid = {"view", "create", "edit", "approve", "admin"}
    return (
        isinstance(actions, list)
        and "view" in actions
        and all(isinstance(action, str) and action in valid for action in actions)
        and len(actions) == len(set(actions))
    )


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
                    authority_epoch TEXT,
                    rights_snapshot_id TEXT,
                    rights_content_sha256 TEXT,
                    required_action TEXT,
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
                    authority_epoch TEXT,
                    started_at TEXT NOT NULL,
                    outcome TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (outcome IN ('unknown', 'confirmed', 'not_sent')),
                    detail TEXT NOT NULL DEFAULT ''
                );
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
                    lease_seconds INTEGER CHECK (lease_seconds BETWEEN 1 AND 600),
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS rights_snapshot (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    snapshot_id TEXT,
                    epoch TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    verified_at TEXT NOT NULL,
                    content_sha256 TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS rights_requests (
                    snapshot_id TEXT PRIMARY KEY,
                    epoch TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    completed_at TEXT,
                    rejected_at TEXT,
                    rejection_reason TEXT
                );
                CREATE TABLE IF NOT EXISTS telegram_cursor (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    next_offset INTEGER NOT NULL CHECK (next_offset >= 0)
                );
                CREATE TABLE IF NOT EXISTS telegram_updates (
                    update_id INTEGER PRIMARY KEY CHECK (update_id >= 0),
                    payload TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    handled_at TEXT
                );
                """
            )
            # A human-confirmed non-delivery may be retried with a new send
            # command; an unknown or confirmed click still fences the letter.
            connection.execute("DROP INDEX IF EXISTS uq_offline_external_letter")
            connection.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_offline_external_active_letter "
                "ON external_effects(letter_id) WHERE outcome != 'not_sent'"
            )
            effect_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(external_effects)")
            }
            if "authority_epoch" not in effect_columns:
                connection.execute("ALTER TABLE external_effects ADD COLUMN authority_epoch TEXT")
            columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(rights_snapshot)")
            }
            if "snapshot_id" not in columns:
                connection.execute("ALTER TABLE rights_snapshot ADD COLUMN snapshot_id TEXT")
            request_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(rights_requests)")
            }
            for name in ("rejected_at", "rejection_reason"):
                if name not in request_columns:
                    connection.execute(f"ALTER TABLE rights_requests ADD COLUMN {name} TEXT")
            operation_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(operations)")
            }
            for name in (
                "authority_epoch", "rights_snapshot_id", "rights_content_sha256",
                "required_action",
            ):
                if name not in operation_columns:
                    connection.execute(f"ALTER TABLE operations ADD COLUMN {name} TEXT")
            authority_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(authority_state)")
            }
            if "lease_seconds" not in authority_columns:
                connection.execute(
                    "ALTER TABLE authority_state ADD COLUMN lease_seconds INTEGER "
                    "CHECK (lease_seconds BETWEEN 1 AND 600)"
                )

    def initialize_telegram_offset(self, previous_offset: int | None) -> int:
        """Import the old post-handle cursor only once before using this inbox."""
        if previous_offset is not None and (
            not isinstance(previous_offset, int) or previous_offset < 0
        ):
            raise ValueError("Недопустимый сохранённый Telegram offset.")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "INSERT OR IGNORE INTO telegram_cursor VALUES (1, ?)",
                (previous_offset if previous_offset is not None else 0,),
            )
            row = connection.execute(
                "SELECT next_offset FROM telegram_cursor WHERE id = 1"
            ).fetchone()
            if row is None:
                raise RuntimeError("Telegram offset не сохранён.")
            return int(row["next_offset"])

    def telegram_offset(self) -> int:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT next_offset FROM telegram_cursor WHERE id = 1"
            ).fetchone()
        if row is None:
            raise RuntimeError("Сначала восстановите Telegram offset.")
        return int(row["next_offset"])

    def receive_telegram_updates(self, updates: list[dict[str, Any]]) -> int:
        """Fsync every update in the same transaction that advances the cursor."""
        encoded: list[tuple[int, str]] = []
        for update in updates:
            update_id = update.get("update_id")
            if type(update_id) is not int or update_id < 0:
                raise ValueError("Telegram прислал обновление без корректного ID.")
            payload = _json(update)
            if len(payload.encode("utf-8")) > 2 * 1024 * 1024:
                raise ValueError("Telegram-обновление превышает безопасный размер.")
            encoded.append((update_id, payload))
        if len({update_id for update_id, _ in encoded}) != len(encoded):
            raise ValueError("Пакет Telegram содержит повторный update_id.")
        encoded.sort(key=lambda item: item[0])
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                "SELECT next_offset FROM telegram_cursor WHERE id = 1"
            ).fetchone()
            if cursor is None:
                raise RuntimeError("Сначала восстановите Telegram offset.")
            next_offset = int(cursor["next_offset"])
            for update_id, payload in encoded:
                existing = connection.execute(
                    "SELECT payload FROM telegram_updates WHERE update_id = ?",
                    (update_id,),
                ).fetchone()
                if existing is not None:
                    if existing["payload"] != payload:
                        raise ValueError("Повторный Telegram update_id содержит другие данные.")
                    continue
                if update_id < next_offset:
                    raise ValueError("Получено старое Telegram-обновление вне журнала.")
                connection.execute(
                    "INSERT INTO telegram_updates VALUES (?, ?, ?, NULL)",
                    (update_id, payload, _now()),
                )
                next_offset = max(next_offset, update_id + 1)
            connection.execute(
                "UPDATE telegram_cursor SET next_offset = ? WHERE id = 1",
                (next_offset,),
            )
            return next_offset

    def pending_telegram_updates(self, limit: int = 100) -> list[dict[str, Any]]:
        if not 1 <= limit <= 1000:
            raise ValueError("Недопустимый размер очереди Telegram.")
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT payload FROM telegram_updates WHERE handled_at IS NULL "
                "ORDER BY update_id LIMIT ?",
                (limit,),
            ).fetchall()
        return [json.loads(row["payload"]) for row in rows]

    def mark_telegram_update_handled(self, update_id: int) -> None:
        with self.connect() as connection:
            cursor = connection.execute(
                "UPDATE telegram_updates SET handled_at = COALESCE(handled_at, ?) "
                "WHERE update_id = ?",
                (_now(), update_id),
            )
            if cursor.rowcount != 1:
                raise ValueError("Telegram-обновление не найдено в журнале.")

    def authority_state(self) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT agent_id, epoch, phase, lease_seconds, updated_at "
                "FROM authority_state WHERE id = 1"
            ).fetchone()
        return dict(row) if row is not None else None

    def set_authority_phase(
        self, agent_id: str, epoch: str, phase: str, *, lease_seconds: int | None = None
    ) -> None:
        """Durably fence a phase transition; a restarted bot cannot invent a lease."""
        epoch = str(UUID(epoch))
        if not agent_id or len(agent_id) > 128 or phase not in {"online", "offline", "replay"}:
            raise ValueError("Недействительное состояние аренды робота.")
        if lease_seconds is not None and not 1 <= lease_seconds <= 600:
            raise ValueError("Недействительный срок аренды робота.")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT agent_id, epoch, phase FROM authority_state WHERE id = 1"
            ).fetchone()
            if row is None:
                if phase != "online":
                    raise ValueError("Нельзя работать автономно без подтверждённой аренды.")
                connection.execute(
                    "INSERT INTO authority_state "
                    "(id, agent_id, epoch, phase, lease_seconds, updated_at) "
                    "VALUES (1, ?, ?, ?, ?, ?)",
                    (agent_id, epoch, phase, lease_seconds, _now()),
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
                "UPDATE authority_state SET phase = ?, "
                "lease_seconds = COALESCE(?, lease_seconds), updated_at = ? WHERE id = 1",
                (phase, lease_seconds, _now()),
            )

    def prepare_offline_rights(self, epoch: str) -> str:
        """Persist the request ID before a network call; reuse it after a crash."""
        epoch = str(UUID(epoch))
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            state = connection.execute(
                "SELECT epoch, phase FROM authority_state WHERE id = 1"
            ).fetchone()
            if state is None or state["epoch"] != epoch or state["phase"] != "online":
                raise ValueError("Нет действующей аренды для запроса прав.")
            pending = connection.execute(
                "SELECT snapshot_id FROM rights_requests "
                "WHERE epoch = ? AND completed_at IS NULL AND rejected_at IS NULL "
                "ORDER BY created_at LIMIT 1",
                (epoch,),
            ).fetchone()
            if pending is not None:
                return str(pending["snapshot_id"])
            snapshot_id = str(uuid4())
            connection.execute(
                "INSERT INTO rights_requests (snapshot_id, epoch, created_at) VALUES (?, ?, ?)",
                (snapshot_id, epoch, _now()),
            )
            return snapshot_id

    def reject_offline_rights_request(
        self, snapshot_id: str, epoch: str, reason: str
    ) -> None:
        """Discard an incompatible response without ever authorizing its actors."""
        snapshot_id, epoch = str(UUID(snapshot_id)), str(UUID(epoch))
        if not reason or len(reason) > 500:
            raise ValueError("Укажите короткую причину отказа от копии прав.")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            request = connection.execute(
                "SELECT epoch, completed_at, rejected_at, rejection_reason "
                "FROM rights_requests WHERE snapshot_id = ?", (snapshot_id,)
            ).fetchone()
            if request is None or request["epoch"] != epoch or request["completed_at"]:
                raise ValueError("Нельзя отклонить неизвестную или принятую копию прав.")
            if request["rejected_at"] is not None:
                if request["rejection_reason"] != reason:
                    raise ValueError("Причина отказа от копии прав уже зафиксирована.")
                return
            connection.execute(
                "UPDATE rights_requests SET rejected_at = ?, rejection_reason = ? "
                "WHERE snapshot_id = ?", (_now(), reason, snapshot_id),
            )

    def save_offline_rights(self, response: dict[str, Any]) -> None:
        """Atomically replace the last server-verified actor set, including revocations."""
        snapshot_id = str(UUID(str(response["snapshotId"])))
        epoch = str(UUID(str(response["epoch"])))
        actors = response["actors"]
        if not isinstance(actors, list):
            raise ValueError("Сервер вернул неверный список Telegram-доступов.")
        ids = [actor.get("telegramId") for actor in actors if isinstance(actor, dict)]
        if (
            len(ids) != len(actors)
            or any(not isinstance(value, str) or not value.isdecimal() for value in ids)
            or len(ids) != len(set(ids))
            or any(not _valid_actor_actions(actor) for actor in actors)
        ):
            raise ValueError("Telegram-доступы содержат дубли, неверные ID или права.")
        canonical = _json(actors)
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        if digest != response.get("contentSha256"):
            raise ValueError("Контрольная сумма Telegram-доступов не совпала.")
        verified_at = datetime.fromisoformat(
            str(response["verifiedAt"]).replace("Z", "+00:00")
        )
        if verified_at.tzinfo is None:
            raise ValueError("Время проверки Telegram-доступов не указано.")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            state = connection.execute(
                "SELECT epoch, phase FROM authority_state WHERE id = 1"
            ).fetchone()
            if state is None or state["epoch"] != epoch or state["phase"] != "online":
                raise ValueError("Нет действующей аренды для сохранения прав.")
            request = connection.execute(
                "SELECT epoch, completed_at, rejected_at FROM rights_requests "
                "WHERE snapshot_id = ?",
                (snapshot_id,),
            ).fetchone()
            if request is None or request["epoch"] != epoch or request["rejected_at"]:
                raise ValueError("Копия прав не соответствует сохранённому запросу.")
            previous = connection.execute(
                "SELECT snapshot_id, verified_at, content_sha256 "
                "FROM rights_snapshot WHERE id = 1"
            ).fetchone()
            if previous is not None:
                prior_time = datetime.fromisoformat(previous["verified_at"])
                if verified_at < prior_time or (
                    verified_at == prior_time and (
                        digest != previous["content_sha256"]
                        or snapshot_id != previous["snapshot_id"]
                    )
                ):
                    raise ValueError("Нельзя заменить права более старой или иной копией.")
            if request["completed_at"] is not None:
                if (
                    previous is None or previous["snapshot_id"] != snapshot_id
                    or previous["content_sha256"] != digest
                    or prior_time != verified_at
                ):
                    raise ValueError("Нельзя повторно применить старую копию прав.")
                return
            connection.execute(
                "INSERT INTO rights_snapshot "
                "(id, snapshot_id, epoch, payload, verified_at, content_sha256) "
                "VALUES (1, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET snapshot_id = excluded.snapshot_id, "
                "epoch = excluded.epoch, "
                "payload = excluded.payload, verified_at = excluded.verified_at, "
                "content_sha256 = excluded.content_sha256",
                (snapshot_id, epoch, canonical, verified_at.isoformat(), digest),
            )
            connection.execute(
                "UPDATE rights_requests SET completed_at = ? WHERE snapshot_id = ?",
                (_now(), snapshot_id),
            )

    def offline_rights_evidence(self) -> dict[str, str] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT snapshot_id, epoch, verified_at, content_sha256 "
                "FROM rights_snapshot WHERE id = 1"
            ).fetchone()
        if row is None or row["snapshot_id"] is None:
            return None  # Older unregistered copies cannot authorize replay.
        return dict(row)

    def verified_actors(self) -> list[dict[str, Any]]:
        """Return the last intact rights snapshot only for the current authority epoch."""
        with self.connect() as connection:
            row = connection.execute(
                "SELECT snapshot_id, epoch, payload, content_sha256 "
                "FROM rights_snapshot WHERE id = 1"
            ).fetchone()
            state = connection.execute(
                "SELECT epoch FROM authority_state WHERE id = 1"
            ).fetchone()
        if (
            row is None or row["snapshot_id"] is None or state is None
            or row["epoch"] != state["epoch"]
        ):
            return []
        if hashlib.sha256(row["payload"].encode("utf-8")).hexdigest() != row["content_sha256"]:
            raise ValueError("Локальная копия Telegram-доступов повреждена.")
        actors = json.loads(row["payload"])
        if not isinstance(actors, list):
            raise ValueError("Локальная копия Telegram-доступов повреждена.")
        for actor in actors:
            if not isinstance(actor, dict) or any(not isinstance(key, str) for key in actor):
                raise ValueError("Локальная копия Telegram-доступов повреждена.")
        return [{str(key): value for key, value in actor.items()} for actor in actors]

    def offline_actor(self, telegram_id: str) -> dict[str, Any] | None:
        """Missing or revoked IDs have no access; old cache cannot grant it."""
        actors = self.verified_actors()
        for actor in actors:
            if actor.get("telegramId") == telegram_id:
                if "view" not in actor.get("moduleActions", []):
                    return None
                return actor
        return None

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

    def available_reserved_numbers(self, agent_id: str) -> int:
        """Count only numbers still spendable in this year and time window."""
        now = datetime.now(UTC)
        with self.connect() as connection:
            value = connection.execute(
                "SELECT COALESCE(SUM(last_number - next_number + 1), 0) "
                "FROM number_reservations WHERE agent_id = ? AND year_suffix = ? "
                "AND valid_until > ? AND next_number <= last_number",
                (agent_id, now.strftime("%y"), now.isoformat()),
            ).fetchone()[0]
        return int(value)

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

    def blob_available(self, digest: str, byte_size: int) -> bool:
        """Cheap availability check; read_blob verifies the bytes before use."""
        if (
            not isinstance(digest, str) or len(digest) != 64
            or any(char not in "0123456789abcdef" for char in digest)
            or not isinstance(byte_size, int) or isinstance(byte_size, bool)
            or byte_size < 0
        ):
            return False
        with self.connect() as connection:
            row = connection.execute(
                "SELECT byte_size FROM blobs WHERE sha256 = ?", (digest,)
            ).fetchone()
        target = self.blobs / digest
        return bool(
            row is not None and row["byte_size"] == byte_size
            and target.is_file() and target.stat().st_size == byte_size
        )

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
        _required_action: str | None = None,
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
                if (
                    existing["actor_id"], existing["letter_id"], existing["kind"],
                    existing["payload"], existing["blob_sha256"],
                    existing["required_action"],
                ) != (
                    actor_id, letter_id, kind, data, blob_sha256, _required_action,
                ) or (_required_action is not None and (
                    existing["authority_epoch"] is None
                    or existing["rights_snapshot_id"] is None
                    or existing["rights_content_sha256"] is None
                )):
                    raise ValueError("Повторный operation_id содержит другие данные.")
                return int(existing["sequence"])
            evidence: tuple[str | None, str | None, str | None, str | None] = (
                None, None, None, None
            )
            if _required_action is not None:
                if _required_action not in {"create", "edit", "approve", "admin"}:
                    raise ValueError("Недопустимое право для автономной операции.")
                state = connection.execute(
                    "SELECT epoch, phase FROM authority_state WHERE id = 1"
                ).fetchone()
                rights = connection.execute(
                    "SELECT snapshot_id, epoch, payload, content_sha256 "
                    "FROM rights_snapshot WHERE id = 1"
                ).fetchone()
                if (
                    state is None or state["phase"] != "offline"
                    or rights is None or rights["snapshot_id"] is None
                    or state["epoch"] != rights["epoch"]
                ):
                    raise ValueError("Нет подтверждённой автономной эпохи и прав.")
                rights_payload = str(rights["payload"])
                rights_hash = hashlib.sha256(rights_payload.encode("utf-8")).hexdigest()
                if rights_hash != rights["content_sha256"]:
                    raise ValueError("Локальная копия Telegram-доступов повреждена.")
                actors = json.loads(rights_payload)
                actor = next(
                    (item for item in actors if isinstance(item, dict)
                     and item.get("telegramId") == actor_id), None,
                ) if isinstance(actors, list) else None
                if (
                    actor is None or not _valid_actor_actions(actor)
                    or _required_action not in actor["moduleActions"]
                    or (_required_action == "approve" and not actor.get("reviewerKeys"))
                ):
                    raise ValueError("Нет подтверждённого права на это действие.")
                evidence = (
                    str(state["epoch"]), str(rights["snapshot_id"]),
                    str(rights["content_sha256"]), _required_action,
                )
            if blob_sha256 is not None and connection.execute(
                "SELECT 1 FROM blobs WHERE sha256 = ?", (blob_sha256,)
            ).fetchone() is None:
                raise FileNotFoundError("Сначала сохраните файл в автономный журнал.")
            cursor = connection.execute(
                "INSERT INTO operations (operation_id, actor_id, letter_id, kind, payload, "
                "blob_sha256, authority_epoch, rights_snapshot_id, rights_content_sha256, "
                "required_action, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (operation_id, actor_id, letter_id, kind, data, blob_sha256, *evidence,
                 timestamp),
            )
            if cursor.lastrowid is None:
                raise RuntimeError("SQLite не подтвердил запись операции.")
            return cursor.lastrowid

    def append_with_rights_evidence(
        self,
        *,
        operation_id: str,
        actor_id: str,
        kind: str,
        payload: dict[str, Any],
        required_action: str,
        letter_id: str | None = None,
        blob_sha256: str | None = None,
        occurred_at: str | None = None,
    ) -> int:
        """Record coarse actor rights; replay must recheck letter and stage rules."""
        return self.append(
            operation_id=operation_id, actor_id=actor_id, kind=kind, payload=payload,
            letter_id=letter_id, blob_sha256=blob_sha256, occurred_at=occurred_at,
            _required_action=required_action,
        )

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

    def operation(self, operation_id: str) -> dict[str, Any] | None:
        operation_id = str(UUID(operation_id))
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM operations WHERE operation_id = ?", (operation_id,)
            ).fetchone()
        return {**dict(row), "payload": json.loads(row["payload"])} if row else None

    def letter_operations(self, letter_id: str) -> list[dict[str, Any]]:
        """Keep the frozen pre-outage base until all replay receipts are reconciled."""
        letter_id = str(UUID(letter_id))
        with self.connect() as connection:
            state = connection.execute(
                "SELECT epoch, phase FROM authority_state WHERE id = 1"
            ).fetchone()
            if state is not None and state["phase"] == "replay":
                rows = connection.execute(
                    "SELECT * FROM operations WHERE letter_id = ? AND authority_epoch = ? "
                    "AND status IN ('pending', 'acknowledged') ORDER BY sequence",
                    (letter_id, state["epoch"]),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM operations WHERE letter_id = ? AND status = 'pending' "
                    "ORDER BY sequence", (letter_id,)
                ).fetchall()
        return [{**dict(row), "payload": json.loads(row["payload"])} for row in rows]

    def offline_created_letter_ids(self) -> list[str]:
        with self.connect() as connection:
            state = connection.execute(
                "SELECT epoch, phase FROM authority_state WHERE id = 1"
            ).fetchone()
            if state is not None and state["phase"] == "replay":
                rows = connection.execute(
                    "SELECT letter_id FROM operations WHERE kind = 'letter.create' "
                    "AND authority_epoch = ? AND status IN ('pending', 'acknowledged') "
                    "ORDER BY sequence", (state["epoch"],)
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT letter_id FROM operations WHERE kind = 'letter.create' "
                    "AND status = 'pending' ORDER BY sequence"
                ).fetchall()
        return [str(row["letter_id"]) for row in rows]

    def pending_authorized(self, limit: int = 100) -> list[dict[str, Any]]:
        """Fail closed if an old local write lacks server-verifiable evidence."""
        operations = self.pending(limit)
        for operation in operations:
            if any(operation[field] is None for field in (
                "authority_epoch", "rights_snapshot_id", "rights_content_sha256",
                "required_action",
            )):
                raise ValueError("Автономная операция без подтверждённых прав требует сверки.")
        return operations

    def replay_manifest(self) -> dict[str, Any]:
        """Prove every local operation was acknowledged before releasing the server fence."""
        with self.connect() as connection:
            return self._replay_manifest(connection)

    def _replay_manifest(self, connection: sqlite3.Connection) -> dict[str, Any]:
        state = connection.execute(
            "SELECT epoch, phase FROM authority_state WHERE id = 1"
        ).fetchone()
        if state is None or state["phase"] != "replay":
            raise ValueError("Сверка доступна только после восстановления связи.")
        unfinished = connection.execute(
            "SELECT 1 FROM operations WHERE status != 'acknowledged' LIMIT 1"
        ).fetchone()
        if unfinished is not None:
            raise ValueError("Остались операции без подтверждения сервера.")
        effects = connection.execute(
            "SELECT * FROM external_effects WHERE authority_epoch = ? "
            "OR authority_epoch IS NULL", (state["epoch"],)
        ).fetchall()
        for effect in effects:
            if effect["outcome"] == "unknown":
                raise ValueError("Результат внешней отправки требует сверки референтом.")
            result_id = str(uuid5(
                NAMESPACE_URL, "ai-offline-result:" + effect["effect_id"]
            ))
            operation = connection.execute(
                "SELECT payload, status FROM operations WHERE operation_id = ?",
                (result_id,),
            ).fetchone()
            if operation is None or operation["status"] != "acknowledged":
                raise ValueError("Результат внешней отправки не подтверждён сервером.")
            payload = json.loads(operation["payload"])
            if (
                payload.get("effectId") != effect["effect_id"]
                or payload.get("sent") != (effect["outcome"] == "confirmed")
                or payload.get("evidence") != effect["detail"]
            ):
                raise ValueError("Квитанция внешней отправки отличается от журнала.")
        rows = connection.execute(
            "SELECT sequence, operation_id, result FROM operations "
            "WHERE authority_epoch = ? ORDER BY sequence", (state["epoch"],)
        ).fetchall()
        entries: list[list[int | str]] = []
        for row in rows:
            result = json.loads(row["result"] or "null")
            if (
                not isinstance(result, dict)
                or result.get("operationId") != row["operation_id"]
                or result.get("sequence") != row["sequence"]
            ):
                raise ValueError("Квитанция автономной операции повреждена.")
            entries.append([int(row["sequence"]), str(row["operation_id"])])
        digest = hashlib.sha256(json.dumps(entries, separators=(",", ":")).encode()).hexdigest()
        return {
            "epoch": str(state["epoch"]),
            "operationCount": len(entries),
            "lastSequence": entries[-1][0] if entries else None,
            "operationsSha256": digest,
            "externalEffectCount": len(effects),
        }

    def finish_replay(
        self, old_epoch: str, new_epoch: str, lease_seconds: int,
        manifest: dict[str, Any],
        *, next_phase: str = "online",
    ) -> None:
        """Advance only from a fully receipted journal to a server-proven new epoch."""
        old_epoch, new_epoch = str(UUID(old_epoch)), str(UUID(new_epoch))
        if (
            old_epoch == new_epoch or not 1 <= lease_seconds <= 600
            or next_phase not in {"online", "replay"}
        ):
            raise ValueError("Сервер не выдал новую действующую эпоху.")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if self._replay_manifest(connection) != manifest or manifest["epoch"] != old_epoch:
                raise ValueError("Журнал изменился после запроса завершения сверки.")
            # The old snapshots predate replay. Applying acknowledged operations to a
            # fresh server response would double-apply them; retaining the snapshots
            # without the overlay would silently show stale letters and history.
            connection.execute(
                "DELETE FROM snapshots WHERE resource = '/letters' "
                "OR resource LIKE '/letters?%' OR resource LIKE '/letters/%' "
                "OR resource LIKE '/packets/%' OR resource LIKE '/comment-audio/%'"
            )
            connection.execute(
                "UPDATE authority_state SET epoch = ?, phase = ?, "
                "lease_seconds = ?, updated_at = ? WHERE id = 1",
                (new_epoch, next_phase, lease_seconds, _now()),
            )

    def pending_blob_hashes(self, limit: int = 100) -> list[str]:
        """List only files still referenced by unacknowledged operations."""
        if not 1 <= limit <= 1000:
            raise ValueError("Недопустимый размер пакета файлов.")
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT blob_sha256 FROM operations WHERE status = 'pending' "
                "AND blob_sha256 IS NOT NULL GROUP BY blob_sha256 "
                "ORDER BY MIN(sequence) LIMIT ?", (limit,)
            ).fetchall()
        return [str(row["blob_sha256"]) for row in rows]

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

    def cache(
        self, actor_id: str, resource: str, payload: dict[str, Any], *,
        expected_epoch: str | None = None, expected_rights_hash: str | None = None,
    ) -> bool:
        if not actor_id.isdecimal() or not resource.startswith("/"):
            raise ValueError("Неверный ключ локальной копии.")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            state = connection.execute(
                "SELECT epoch, phase FROM authority_state WHERE id = 1"
            ).fetchone()
            if expected_epoch is not None or expected_rights_hash is not None:
                rights = connection.execute(
                    "SELECT epoch, content_sha256 FROM rights_snapshot WHERE id = 1"
                ).fetchone()
                if (
                    expected_epoch is None or expected_rights_hash is None
                    or state is None or state["epoch"] != expected_epoch
                    or state["phase"] != "online" or rights is None
                    or rights["epoch"] != expected_epoch
                    or rights["content_sha256"] != expected_rights_hash
                ):
                    return False
            if (
                state is not None and state["phase"] == "replay"
                and (resource.startswith("/letters/") or resource.startswith("/letters?"))
            ):
                # A partially replayed server response is not a new reducer base.
                return False
            connection.execute(
                "INSERT INTO snapshots VALUES (?, ?, ?, ?) "
                "ON CONFLICT(actor_id, resource) DO UPDATE SET "
                "payload=excluded.payload, verified_at=excluded.verified_at",
                (actor_id, resource, _json(payload), _now()),
            )
            return True

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

    def cached_letter_ids(self, actor_id: str) -> list[str]:
        """Return only IDs previously disclosed to this Telegram actor by Workspace."""
        if not actor_id.isdecimal():
            raise ValueError("Неверный Telegram ID.")
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT payload FROM snapshots WHERE actor_id = ? "
                "AND (resource LIKE '/letters?%' OR resource LIKE '/letters/%')",
                (actor_id,),
            ).fetchall()
        result: set[str] = set()
        for row in rows:
            payload = json.loads(row["payload"])
            candidates = payload.get("letters", []) if isinstance(payload, dict) else []
            if not isinstance(candidates, list):
                candidates = []
            if isinstance(payload, dict) and "id" in payload:
                candidates.append(payload)
            for item in candidates:
                if isinstance(item, dict):
                    try:
                        result.add(str(UUID(str(item["id"]))))
                    except (KeyError, TypeError, ValueError):
                        continue
        return sorted(result)

    def cached_progress_items(self, actor_id: str) -> list[dict[str, Any]]:
        """Status-only snapshots previously returned to this exact Telegram actor."""
        if not actor_id.isdecimal():
            raise ValueError("Неверный Telegram ID.")
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT resource, payload FROM snapshots WHERE actor_id = ? "
                "AND resource LIKE '/letters/progress?%'",
                (actor_id,),
            ).fetchall()
        from urllib.parse import parse_qs, urlsplit

        pages = []
        for row in rows:
            query = parse_qs(urlsplit(row["resource"]).query)
            try:
                offset = int(query.get("offset", ["0"])[0])
            except ValueError:
                continue
            pages.append((offset, json.loads(row["payload"])))
        result: list[dict[str, Any]] = []
        seen: set[str] = set()
        for _, payload in sorted(pages, key=lambda page: page[0]):
            items = payload.get("letters", []) if isinstance(payload, dict) else []
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                try:
                    letter_id = str(UUID(str(item["id"])))
                except (KeyError, TypeError, ValueError):
                    continue
                if letter_id not in seen:
                    seen.add(letter_id)
                    result.append({str(key): value for key, value in item.items()})
        return result

    def next_unprepared_approval(self) -> dict[str, Any] | None:
        """Find the earliest offline final approval without a signed-PDF receipt."""
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM operations WHERE kind = 'letter.action' "
                "AND status = 'pending' ORDER BY sequence"
            ).fetchall()
        for row in rows:
            operation = {**dict(row), "payload": json.loads(row["payload"])}
            if (
                operation["payload"].get("action") == "approve"
                and operation["payload"].get("toStatus") == "queued"
            ):
                prepared_id = str(uuid5(
                    NAMESPACE_URL, "ai-offline-prepare:" + operation["operation_id"]
                ))
                signed_id = str(uuid5(
                    NAMESPACE_URL, "ai-offline-sign:" + operation["operation_id"]
                ))
                if self.operation(prepared_id) is None and self.operation(signed_id) is None:
                    return operation
        return None

    def next_undispatched_release(self) -> dict[str, Any] | None:
        """Find a durable final-PDF decision not yet reflected in the compose result."""
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM operations WHERE kind = 'letter.action' "
                "AND status = 'pending' ORDER BY sequence"
            ).fetchall()
        for row in rows:
            operation = {**dict(row), "payload": json.loads(row["payload"])}
            if operation["payload"].get("action") != "release_delivery":
                continue
            dispatch_id = str(uuid5(
                NAMESPACE_URL, "ai-offline-dispatch:" + operation["operation_id"]
            ))
            if self.operation(dispatch_id) is None:
                return operation
        return None

    def next_unsent_command(self) -> dict[str, Any] | None:
        """Return one queued send whose irreversible click has never begun."""
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM operations WHERE status = 'pending' "
                "AND kind IN ('letter.action', 'letter.dispatched') ORDER BY sequence"
            ).fetchall()
        for row in rows:
            operation = {**dict(row), "payload": json.loads(row["payload"])}
            if not (
                (operation["kind"] == "letter.action"
                 and operation["payload"].get("action") == "send")
                or (operation["kind"] == "letter.dispatched"
                    and operation["payload"].get("autoSend") is True)
            ):
                continue
            effect_id = str(uuid5(
                NAMESPACE_URL, "ai-offline-effect:" + operation["operation_id"]
            ))
            if self.external_effect(effect_id) is None:
                return operation
        return None

    def external_effect_for_letter(self, letter_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM external_effects WHERE letter_id = ? "
                "ORDER BY started_at DESC, effect_id DESC LIMIT 1",
                (str(UUID(letter_id)),),
            ).fetchone()
        return dict(row) if row else None

    def unresolved_external_effects(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM external_effects WHERE outcome = 'unknown' ORDER BY started_at"
            ).fetchall()
        return [dict(row) for row in rows]

    def begin_external_effect(self, effect_id: str, letter_id: str, kind: str) -> bool:
        """False after a crash or retry: physical send must never auto-repeat."""
        effect_id, letter_id = str(UUID(effect_id)), str(UUID(letter_id))
        if kind not in {"exat_send", "webmail_send"}:
            raise ValueError("Недопустимый вид внешней отправки.")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            state = connection.execute(
                "SELECT epoch, phase FROM authority_state WHERE id = 1"
            ).fetchone()
            if state is None or state["phase"] != "offline":
                raise ValueError("Внешнее действие доступно только в автономной эпохе.")
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
                "(effect_id, letter_id, kind, authority_epoch, started_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (effect_id, letter_id, kind, state["epoch"], _now()),
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
