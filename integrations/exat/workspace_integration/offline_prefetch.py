"""Incrementally save actor-scoped read models before a Workspace outage."""

from __future__ import annotations

import hashlib
import time
from collections import deque
from collections.abc import Callable
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit
from uuid import UUID

from .client import WorkspaceClient, WorkspaceError
from .offline_journal import OfflineJournal


class OfflineSnapshotSeeder:
    """Fetch one authorized page per tick; never block the authority heartbeat."""

    def __init__(
        self, client: WorkspaceClient, journal: OfflineJournal, *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.client, self.journal, self.clock = client, journal, clock
        self._jobs: deque[tuple[str, str]] = deque()
        self._file_jobs: deque[tuple[str, str, str, str, int, str]] = deque()
        self._queued_packets: set[tuple[str, str]] = set()
        self._queued_files: set[tuple[str, str, str, str]] = set()
        self._rights_hash: str | None = None
        self._next_cycle = 0.0

    @staticmethod
    def _initial_jobs(actors: list[dict[str, Any]]) -> deque[tuple[str, str]]:
        jobs: deque[tuple[str, str]] = deque()
        for actor in actors:
            telegram_id = actor.get("telegramId")
            if not isinstance(telegram_id, str) or "view" not in actor.get("moduleActions", []):
                continue
            jobs.append((telegram_id, "/reviewers"))
            for limit in (6, 8):
                jobs.append((telegram_id, "/recipients?" + urlencode({
                    "query": "", "category": "", "offset": 0, "limit": limit,
                })))
            for filter_name in ("activeOnly", "sentOnly"):
                jobs.append((telegram_id, "/letters?" + urlencode({
                    "offset": 0, "limit": 100, filter_name: "true",
                })))
            if "admin" in actor.get("moduleActions", []):
                jobs.append((telegram_id, "/letters/progress?offset=0&limit=100"))
        return jobs

    def tick(self) -> bool:
        """One network read at most; return False when waiting or disconnected."""
        state = self.journal.authority_state()
        evidence = self.journal.offline_rights_evidence()
        if (
            state is None or state["phase"] != "online" or evidence is None
            or evidence["epoch"] != state["epoch"]
        ):
            return False
        rights_hash = evidence["content_sha256"]
        if rights_hash != self._rights_hash or (
            not self._jobs and not self._file_jobs and self.clock() >= self._next_cycle
        ):
            self._jobs = self._initial_jobs(self.journal.verified_actors())
            self._file_jobs.clear()
            self._queued_packets.clear()
            self._queued_files.clear()
            self._rights_hash = rights_hash
            self._next_cycle = self.clock() + 300
        if not self._jobs and self._file_jobs:
            return self._fetch_file(state["epoch"], rights_hash)
        if not self._jobs:
            return False
        actor, path = self._jobs.popleft()
        try:
            result = self.client.request(
                "/ai-referent/agent" + path, telegram_id=actor
            )
        except WorkspaceError as error:
            if error.retryable:
                self._jobs.appendleft((actor, path))
            elif error.status not in {403, 404}:
                raise
            return False
        current = self.journal.authority_state()
        current_evidence = self.journal.offline_rights_evidence()
        if (
            current is None or current["phase"] != "online"
            or current["epoch"] != state["epoch"] or current_evidence is None
            or current_evidence["content_sha256"] != rights_hash
        ):
            return False
        if not self.journal.cache(
            actor, path, result,
            expected_epoch=state["epoch"], expected_rights_hash=rights_hash,
        ):
            return False
        if path.startswith("/packets/outgoing/"):
            letter_id = path.removeprefix("/packets/outgoing/")
            for item in result.get("files", []):
                if not isinstance(item, dict):
                    continue
                try:
                    file_id = str(UUID(str(item["id"])))
                except (KeyError, TypeError, ValueError):
                    continue
                source, digest, size = (
                    item.get("source"), item.get("sha256"), item.get("byteSize")
                )
                if (
                    source not in {"attachment", "packet"}
                    or not isinstance(digest, str) or len(digest) != 64
                    or any(char not in "0123456789abcdef" for char in digest)
                    or not isinstance(size, int) or isinstance(size, bool)
                    or size < 0 or size > 50 * 1024 * 1024
                ):
                    continue
                key = (actor, letter_id, file_id, source)
                if key not in self._queued_files and not self.journal.blob_available(digest, size):
                    self._queued_files.add(key)
                    self._file_jobs.append((actor, letter_id, file_id, digest, size, source))
        if path.startswith("/letters?") or path.startswith("/letters/progress?"):
            query = parse_qs(urlsplit(path).query)
            offset, limit = int(query["offset"][0]), int(query["limit"][0])
            letters = result.get("letters", [])
            if not isinstance(letters, list):
                raise WorkspaceError("Сервер вернул неверный список писем.", 502)
            total = result.get("totalCount")
            if path.startswith("/letters?"):
                for letter in letters:
                    if not isinstance(letter, dict):
                        continue
                    try:
                        letter_id = str(UUID(str(letter["id"])))
                    except (KeyError, TypeError, ValueError):
                        continue
                    key = (actor, letter_id)
                    if key not in self._queued_packets:
                        self._queued_packets.add(key)
                        self._jobs.append((actor, "/packets/outgoing/" + letter_id))
            if (
                (isinstance(total, int) and offset + limit < total)
                or (total is None and len(letters) == limit)
            ):
                next_query = {key: values[0] for key, values in query.items()}
                next_query["offset"] = str(offset + limit)
                self._jobs.append((actor, urlsplit(path).path + "?" + urlencode(next_query)))
        return True

    def _fetch_file(self, epoch: str, rights_hash: str) -> bool:
        actor, letter_id, file_id, digest, size, source = self._file_jobs.popleft()
        if self.journal.blob_available(digest, size):
            return True
        path = (
            f"/ai-referent/agent/packets/outgoing/{letter_id}/files/{file_id}?"
            + urlencode({"source": source})
        )
        try:
            content = self.client.transfer(path, telegram_id=actor)
        except WorkspaceError as error:
            if error.retryable:
                self._file_jobs.appendleft((actor, letter_id, file_id, digest, size, source))
            elif error.status not in {403, 404}:
                raise
            return False
        if len(content) != size or hashlib.sha256(content).hexdigest() != digest:
            raise WorkspaceError("Контрольная сумма файла для автономной копии не совпала.", 502)
        current = self.journal.authority_state()
        evidence = self.journal.offline_rights_evidence()
        if (
            current is None or current["phase"] != "online" or current["epoch"] != epoch
            or evidence is None or evidence["content_sha256"] != rights_hash
        ):
            return False
        self.journal.put_blob(content)
        return True
