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
        self._audio_jobs: deque[tuple[str, str, str, int]] = deque()
        self._queued_details: set[tuple[str, str]] = set()
        self._queued_packets: set[tuple[str, str]] = set()
        self._queued_files: set[tuple[str, str, str, str]] = set()
        self._queued_audio: set[tuple[str, str]] = set()
        self._take_audio_next = True
        self._recipient_pages: dict[str, dict[int, list[dict[str, Any]]]] = {}
        self._recipient_revision: dict[str, str | None] = {}
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
            jobs.append((telegram_id, "/recipients?" + urlencode({
                "query": "", "category": "", "offset": 0, "limit": 30,
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
            not self._jobs and not self._file_jobs and not self._audio_jobs
            and self.clock() >= self._next_cycle
        ):
            self._jobs = self._initial_jobs(self.journal.verified_actors())
            self._file_jobs.clear()
            self._audio_jobs.clear()
            self._queued_details.clear()
            self._queued_packets.clear()
            self._queued_files.clear()
            self._queued_audio.clear()
            self._take_audio_next = True
            self._recipient_pages.clear()
            self._recipient_revision.clear()
            self._rights_hash = rights_hash
            self._next_cycle = self.clock() + 300
        if self._audio_jobs and (not self._jobs or self._take_audio_next):
            self._take_audio_next = False
            return self._fetch_audio(state["epoch"], rights_hash)
        self._take_audio_next = True
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
        if (
            path.startswith("/letters/") and not path.startswith("/letters/progress")
            and result.get("id") != path.removeprefix("/letters/")
        ):
            raise WorkspaceError("Сервер вернул другую карточку письма.", 502)
        if not self.journal.cache(
            actor, path, result,
            expected_epoch=state["epoch"], expected_rights_hash=rights_hash,
        ):
            return False
        if path.startswith("/recipients?"):
            query = parse_qs(urlsplit(path).query, keep_blank_values=True)
            offset = int(query["offset"][0])
            entries, total = result.get("entries"), result.get("totalCount")
            if (
                not isinstance(entries, list)
                or any(not isinstance(entry, dict) for entry in entries)
                or type(total) is not int or not 0 <= total <= 2000
                or len(entries) > 30 or offset + len(entries) > total
                or (offset < total and not entries)
            ):
                raise WorkspaceError("Сервер вернул неполную адресную книгу.", 502)
            revision = result.get("updatedAt")
            if revision != self._recipient_revision.get(actor) and actor in self._recipient_pages:
                self._recipient_pages.pop(actor, None)
                self._recipient_revision.pop(actor, None)
                self._jobs.appendleft((actor, "/recipients?" + urlencode({
                    "query": "", "category": "", "offset": 0, "limit": 30,
                })))
                return True
            self._recipient_revision[actor] = revision
            pages = self._recipient_pages.setdefault(actor, {})
            pages[offset] = entries
            if offset + len(entries) < total:
                self._jobs.appendleft((actor, "/recipients?" + urlencode({
                    "query": "", "category": "", "offset": offset + len(entries),
                    "limit": 30,
                })))
                return True
            combined = [entry for page_offset in sorted(pages) for entry in pages[page_offset]]
            if len(combined) != total or len({entry.get("id") for entry in combined}) != total:
                raise WorkspaceError("Страницы адресной книги не составляют справочник.", 502)
            return self.journal.cache(
                actor, "/recipient-catalog", {
                    "entries": combined, "totalCount": total, "updatedAt": revision,
                }, expected_epoch=state["epoch"], expected_rights_hash=rights_hash,
            )
        if path.startswith("/letters/") and not path.startswith("/letters/progress"):
            letter_id = path.removeprefix("/letters/")
            for event in result.get("events", []):
                if (
                    not isinstance(event, dict)
                    or event.get("eventType") != "letter.return_for_revision"
                ):
                    continue
                audio = event.get("audio")
                if not isinstance(audio, dict):
                    continue
                try:
                    audio_id = str(UUID(str(audio["id"])))
                except (KeyError, TypeError, ValueError):
                    continue
                size = audio.get("byteSize")
                if (
                    audio.get("contentType") != "audio/ogg"
                    or not isinstance(size, int) or isinstance(size, bool)
                    or not 0 < size <= 50 * 1024 * 1024
                ):
                    continue
                key = (actor, audio_id)
                if key not in self._queued_audio:
                    self._queued_audio.add(key)
                    self._audio_jobs.append((actor, letter_id, audio_id, size))
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
                    if key not in self._queued_details:
                        self._queued_details.add(key)
                        self._jobs.append((actor, "/letters/" + letter_id))
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

    def _fetch_audio(self, epoch: str, rights_hash: str) -> bool:
        actor, letter_id, audio_id, size = self._audio_jobs.popleft()
        path = "/comment-audio/" + audio_id
        old = self.journal.snapshot(actor, path)
        if old is not None and old["payload"].get("letterId") == letter_id:
            digest = old["payload"].get("sha256")
            if isinstance(digest, str) and self.journal.blob_available(digest, size):
                return True
        try:
            content = self.client.transfer(
                "/ai-referent/agent/comment-audio/" + audio_id, telegram_id=actor
            )
        except WorkspaceError as error:
            if error.retryable:
                self._audio_jobs.appendleft((actor, letter_id, audio_id, size))
            elif error.status not in {403, 404}:
                raise
            return False
        if len(content) != size:
            raise WorkspaceError("Размер автономного аудио не совпал.", 502)
        current = self.journal.authority_state()
        evidence = self.journal.offline_rights_evidence()
        if (
            current is None or current["phase"] != "online" or current["epoch"] != epoch
            or evidence is None or evidence["content_sha256"] != rights_hash
        ):
            return False
        digest = self.journal.put_blob(content)
        return self.journal.cache(
            actor, path, {"letterId": letter_id, "sha256": digest, "byteSize": size},
            expected_epoch=epoch, expected_rights_hash=rights_hash,
        )

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
