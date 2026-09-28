# ruff: noqa: RUF001
"""Durable local draft reducer; never treats a cached server letter as a write grant."""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from copy import deepcopy
from pathlib import Path, PurePath
from tempfile import TemporaryDirectory
from threading import RLock
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from .client import WorkspaceError
from .offline_journal import OfflineJournal

_EDITABLE = {"draft", "needs_revision"}
_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
_MAX_COMMENT_AUDIO_BYTES = 10 * 1024 * 1024
_FIELDS = {
    "subject": 300,
    "recipientOrganization": 300,
    "recipientAddress": 500,
    "note": 5000,
}


class OfflineWorkflow:
    """Reduce immutable operations over the last verified per-actor server copy.

    Physical preparation and external delivery still need a local executor
    before the failover switch may be enabled in production.
    """

    def __init__(self, journal: OfflineJournal):
        self.journal = journal
        self._lock = RLock()

    def list_letters(
        self, telegram_id: str, *, offset: int, limit: int,
        active_only: bool = False, sent_only: bool = False,
    ) -> dict[str, Any]:
        """List only previously visible or locally created letters; never claim completeness."""
        self._actor(telegram_id, "view")
        if offset < 0 or not 1 <= limit <= 100 or (active_only and sent_only):
            raise WorkspaceError("Неверные параметры списка писем.", 422)
        ids = set(self.journal.cached_letter_ids(telegram_id))
        ids.update(self.journal.offline_created_letter_ids())
        letters: list[dict[str, Any]] = []
        for letter_id in ids:
            try:
                letter = self.read(telegram_id, letter_id)
            except WorkspaceError as error:
                if error.status in {403, 404}:
                    continue
                raise
            if sent_only and letter["status"] != "sent":
                continue
            if active_only and letter["status"] in {"sent", "signed", "cancelled"}:
                continue
            letters.append(letter)
        letters.sort(key=lambda letter: (letter["updatedAt"], letter["id"]), reverse=True)
        selected = letters[offset:offset + limit]
        counts: dict[str, int] = {}
        for letter in letters:
            counts[letter["status"]] = counts.get(letter["status"], 0) + 1
        return {
            "letters": selected,
            "totalCount": len(letters),
            "pendingReviewCount": counts.get("pending_review", 0)
            + counts.get("awaiting_final_send", 0),
            "readyCount": sum(counts.get(status, 0) for status in (
                "approved", "queued", "sending", "referent_review_pending"
            )),
            "sentCount": counts.get("sent", 0),
            "signedCount": counts.get("signed", 0),
            "offlinePartial": True,
        }

    def _actor(self, telegram_id: str, action: str) -> dict[str, Any]:
        actor = self.journal.offline_actor(telegram_id)
        if actor is None or action not in actor["moduleActions"]:
            raise WorkspaceError("Автономный доступ к AI Referent не подтверждён.", 403)
        return actor

    def cached_resource(self, telegram_id: str, path: str) -> dict[str, Any]:
        """Expose only an exact snapshot previously returned to this actor."""
        self._actor(telegram_id, "view")
        if not path.startswith(("/reviewers", "/recipients?")):
            raise WorkspaceError("Этот справочник недоступен без связи с сервером.", 503)
        snapshot = self.journal.snapshot(telegram_id, path)
        if snapshot is None:
            raise WorkspaceError("Эта часть справочника не сохранена на ПК референта.", 503)
        payload = snapshot["payload"]
        if not isinstance(payload, dict):
            raise WorkspaceError("Сохранённый справочник повреждён.", 503)
        return payload

    def packet(self, telegram_id: str, letter_id: str) -> dict[str, Any]:
        """Expose only locally durable files from a letter this actor can open."""
        letter = self.read(telegram_id, letter_id)
        snapshot = self.journal.snapshot(telegram_id, "/packets/outgoing/" + letter["id"])
        cached_files = snapshot["payload"].get("files", []) if snapshot is not None else []
        if not isinstance(cached_files, list):
            cached_files = []
        local_ids = {
            str(uuid5(NAMESPACE_URL, "ai-offline-attachment:" + item["operation_id"]))
            for item in self.journal.letter_operations(letter["id"])
            if item["kind"] == "letter.attachment"
        }
        prepared = next(
            (item for item in reversed(self.journal.letter_operations(letter["id"]))
             if item["kind"] == "letter.prepared"), None,
        ) if letter.get("finalPdfFileId") is not None else None
        if prepared is not None:
            primary_ids = {
                item["id"] for item in letter["attachments"]
                if item["documentRole"] == "primary"
            }
            cached_files = [
                item for item in cached_files
                if isinstance(item, dict)
                and not (item.get("source") == "attachment" and item.get("id") in primary_ids)
            ]
        local_files = [
                {
                    "id": item["id"],
                    "name": f"original/{item['id']}/{item['fileName']}",
                    "byteSize": item["byteSize"],
                    "sha256": item["sha256"],
                    "source": "attachment",
                    "createdAt": item["createdAt"],
                }
                for item in letter["attachments"]
                if item["id"] in local_ids
                and (prepared is None or item["documentRole"] != "primary")
            ]
        if prepared is not None:
            local_files.append({
                "id": letter["finalPdfFileId"],
                "name": "signed/" + prepared["payload"]["commandId"] + ".pdf",
                "byteSize": prepared["payload"]["byteSize"],
                "sha256": prepared["blob_sha256"],
                "source": "packet",
                "createdAt": prepared["occurred_at"],
            })
        files = [
            item for item in cached_files
            if isinstance(item, dict)
            and isinstance(item.get("id"), str)
            and isinstance(item.get("name"), str)
            and item.get("source") in {"attachment", "packet"}
            and self.journal.blob_available(item.get("sha256"), item.get("byteSize"))
        ]
        seen = {(item["id"], item["source"]) for item in files}
        files.extend(
            item for item in local_files
            if (item["id"], item["source"]) not in seen
        )
        return {"files": files, "offlinePartial": True}

    def packet_file(
        self, telegram_id: str, letter_id: str, file_id: str,
        source: str = "attachment",
    ) -> bytes:
        try:
            file_id = str(UUID(file_id))
        except (TypeError, ValueError) as error:
            raise WorkspaceError("Неверный идентификатор файла.", 422) from error
        item = next(
            (entry for entry in self.packet(telegram_id, letter_id)["files"]
             if entry["id"] == file_id and entry["source"] == source), None,
        )
        if item is None:
            raise WorkspaceError("Файл недоступен в локальной копии.", 404)
        try:
            return self.journal.read_blob(item["sha256"])
        except (FileNotFoundError, ValueError) as error:
            raise WorkspaceError("Локальный файл повреждён или отсутствует.", 503) from error

    def comment_audio_file(self, telegram_id: str, letter_id: str, audio_id: str) -> bytes:
        """A returned voice note is private to the author of its letter."""
        letter = self.read(telegram_id, letter_id)
        actor = self._actor(telegram_id, "view")
        if letter["createdByUserId"] != actor["userId"]:
            raise WorkspaceError("Голосовой комментарий доступен автору письма.", 403)
        try:
            audio_id = str(UUID(audio_id))
        except (TypeError, ValueError) as error:
            raise WorkspaceError("Неверный идентификатор голосового комментария.", 422) from error
        used = any(
            event["eventType"] == "letter.return_for_revision"
            and isinstance(event.get("audio"), dict)
            and event["audio"].get("id") == audio_id
            for event in letter["events"]
        )
        if not used:
            raise WorkspaceError("Комментарий не относится к этому письму.", 404)
        operation = next(
            (item for item in self.journal.letter_operations(letter["id"])
             if item["kind"] == "letter.comment_audio"
             and str(uuid5(NAMESPACE_URL, "ai-offline-audio:" + item["operation_id"]))
             == audio_id), None,
        )
        if operation is None or operation["blob_sha256"] is None:
            raise WorkspaceError("Аудио пока недоступно без связи с Workspace.", 503)
        try:
            return self.journal.read_blob(operation["blob_sha256"])
        except (FileNotFoundError, ValueError) as error:
            raise WorkspaceError("Локальное аудио повреждено или отсутствует.", 503) from error

    def progress_list(self, telegram_id: str, *, offset: int, limit: int) -> dict[str, Any]:
        actor = self._actor(telegram_id, "view")
        if "admin" not in actor["moduleActions"]:
            return {"letters": [], "offlinePartial": True}
        if offset < 0 or not 1 <= limit <= 100:
            raise WorkspaceError("Неверные параметры списка этапов.", 422)
        items = self.journal.cached_progress_items(telegram_id)
        return {"letters": items[offset:offset + limit], "offlinePartial": True}

    def progress_item(self, telegram_id: str, letter_id: str) -> dict[str, Any]:
        actor = self._actor(telegram_id, "view")
        if "admin" not in actor["moduleActions"]:
            raise WorkspaceError("Этап письма не найден.", 404)
        try:
            letter_id = str(UUID(letter_id))
        except (TypeError, ValueError) as error:
            raise WorkspaceError("Неверный идентификатор письма.", 422) from error
        exact = self.journal.snapshot(telegram_id, "/letters/progress/" + letter_id)
        if exact is not None:
            payload = exact["payload"]
            if not isinstance(payload, dict):
                raise WorkspaceError("Сохранённый этап письма повреждён.", 503)
            return payload
        for item in self.journal.cached_progress_items(telegram_id):
            if item["id"] == letter_id:
                return item
        raise WorkspaceError("Этап письма не сохранён в локальной копии.", 404)

    def record_prepared(
        self, telegram_id: str, letter_id: str, approval_operation_id: str,
        signed_pdf: bytes,
    ) -> dict[str, Any]:
        """Durably record one signed delivery PDF; no external send occurs here."""
        actor = self._actor(telegram_id, "approve")
        try:
            letter_id = str(UUID(letter_id))
            approval_operation_id = str(UUID(approval_operation_id))
        except (TypeError, ValueError) as error:
            raise WorkspaceError("Неверный ID письма или согласования.", 422) from error
        if (
            not isinstance(signed_pdf, bytes)
            or not signed_pdf.startswith(b"%PDF-")
            or not 0 < len(signed_pdf) <= 50 * 1024 * 1024
        ):
            raise WorkspaceError("Подписанный PDF отсутствует или повреждён.", 422)
        operation_id = str(uuid5(NAMESPACE_URL, "ai-offline-prepare:" + approval_operation_id))
        command_id = str(uuid5(NAMESPACE_URL, "ai-offline-command:" + approval_operation_id))
        digest = hashlib.sha256(signed_pdf).hexdigest()
        with self._lock:
            old = self.journal.operation(operation_id)
            if old is not None:
                if (
                    old["actor_id"] != telegram_id or old["letter_id"] != letter_id
                    or old["kind"] != "letter.prepared" or old["blob_sha256"] != digest
                ):
                    raise WorkspaceError("Повтор подготовки содержит другой PDF.", 409)
                return self.read(telegram_id, letter_id)
            approval = self.journal.operation(approval_operation_id)
            if (
                approval is None or approval["kind"] != "letter.action"
                or approval["letter_id"] != letter_id or approval["actor_id"] != telegram_id
                or approval["payload"].get("action") != "approve"
                or approval["payload"].get("toStatus") != "queued"
            ):
                raise WorkspaceError("Итоговое согласование для подготовки не найдено.", 409)
            letter = self.read(telegram_id, letter_id)
            if (
                letter["status"] != "queued" or letter["workflowKind"] != "delivery"
                or letter["reviewerUserId"] != actor["userId"]
                or letter["revision"] != approval["payload"]["expectedRevision"] + 1
            ):
                raise WorkspaceError("Письмо не ожидает автономной подготовки.", 409)
            final_bobur = letter["finalReviewerUserId"] == actor["userId"]
            next_status = "awaiting_final_send" if final_bobur else "referent_review_pending"
            self.journal.put_blob(signed_pdf)
            self.journal.append_with_rights_evidence(
                operation_id=operation_id, actor_id=telegram_id, letter_id=letter_id,
                kind="letter.prepared",
                payload={
                    "approvalOperationId": approval_operation_id,
                    "commandId": command_id, "expectedRevision": letter["revision"],
                    "fromStatus": "queued", "toStatus": next_status,
                    "byteSize": len(signed_pdf), "actorUserId": actor["userId"],
                    "actorName": actor["fullName"],
                },
                blob_sha256=digest, required_action="approve",
            )
            return self.read(telegram_id, letter_id)

    @staticmethod
    def _fields(payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise WorkspaceError("Данные письма должны быть объектом.", 422)
        values: dict[str, Any] = {}
        for field, limit in _FIELDS.items():
            value = payload.get(field, "")
            if not isinstance(value, str) or len(value.strip()) > limit:
                raise WorkspaceError("Проверьте поля письма и их длину.", 422)
            values[field] = value.strip()
        kind = payload.get("workflowKind", "delivery")
        route = payload.get("route")
        if kind not in {"delivery", "sign_only"} or route not in {"exat", "webmail"}:
            raise WorkspaceError("Вид письма или канал отправки не поддерживается.", 422)
        if kind == "sign_only" and route != "exat":
            raise WorkspaceError("Подписание без отправки не использует Webmail.", 422)
        values["workflowKind"] = kind
        values["route"] = route
        for key in ("reviewerUserId", "finalReviewerUserId"):
            value = payload.get(key)
            try:
                values[key] = str(UUID(str(value))) if value is not None else None
            except (TypeError, ValueError) as error:
                raise WorkspaceError("Согласующий указан неверно.", 422) from error
        if kind == "sign_only" and values["finalReviewerUserId"] is not None:
            raise WorkspaceError("Для подписи выберите одного согласующего.", 422)
        if kind == "sign_only":
            values["recipientOrganization"] = "Подписание без отправки"
            values["recipientAddress"] = ""
        return values

    def _validated_route(self, actor_id: str, values: dict[str, Any]) -> dict[str, Any]:
        """Use only the last server-verified reviewer catalog while disconnected."""
        ids = (values["reviewerUserId"], values["finalReviewerUserId"])
        if not any(ids):
            return values
        snapshot = self.journal.snapshot(actor_id, "/reviewers")
        if snapshot is None:
            raise WorkspaceError("Нет проверенного списка согласующих для работы без сети.", 503)
        reviewers = snapshot["payload"].get("reviewers", [])
        if not isinstance(reviewers, list):
            raise WorkspaceError("Локальный список согласующих повреждён.", 503)
        keys: list[str | None] = []
        for user_id in ids:
            if user_id is None:
                keys.append(None)
                continue
            reviewer = next(
                (
                    item
                    for item in reviewers
                    if isinstance(item, dict) and item.get("userId") == user_id
                ),
                None,
            )
            if reviewer is None or not reviewer.get("canApprove"):
                raise WorkspaceError("Выбранный согласующий недоступен в проверенной копии.", 422)
            keys.append(str(reviewer.get("key") or ""))
        if ids[1] is not None:
            if ids[0] == ids[1]:
                raise WorkspaceError("Выберите разных согласующих.", 422)
            if keys[0] == "bobur":
                values["reviewerUserId"], values["finalReviewerUserId"] = ids[1], ids[0]
            elif keys[1] != "bobur":
                raise WorkspaceError("Второй этап возможен только с решением Бобура.", 422)
        return values

    def _reviewer_name(self, actor_id: str, user_id: str | None) -> str | None:
        if user_id is None:
            return None
        snapshot = self.journal.snapshot(actor_id, "/reviewers")
        if snapshot is None:
            return None
        for reviewer in snapshot["payload"].get("reviewers", []):
            if reviewer.get("userId") == user_id:
                return str(reviewer.get("fullName") or "")
        return None

    def create(
        self, telegram_id: str, operation_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        actor = self._actor(telegram_id, "create")
        values = self._validated_route(telegram_id, self._fields(payload))
        epoch = self.journal.authority_state()
        if epoch is None or epoch["phase"] != "offline":
            raise WorkspaceError("Автономная запись ещё не разрешена.", 503)
        try:
            operation_id = str(UUID(operation_id))
        except (TypeError, ValueError) as error:
            raise WorkspaceError("Неверный идентификатор действия.", 422) from error
        letter_id = str(uuid5(NAMESPACE_URL, f"ai-offline:{epoch['epoch']}:{operation_id}"))
        content = {
            **values,
            "letterId": letter_id,
            "actorUserId": actor["userId"],
            "actorName": actor["fullName"],
        }
        with self._lock:
            self.journal.append_with_rights_evidence(
                operation_id=operation_id,
                actor_id=telegram_id,
                letter_id=letter_id,
                kind="letter.create",
                payload=content,
                required_action="create",
            )
            return self.read(telegram_id, letter_id)

    def update(
        self, telegram_id: str, letter_id: str, operation_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        actor = self._actor(telegram_id, "edit")
        try:
            letter_id, operation_id = str(UUID(letter_id)), str(UUID(operation_id))
        except (TypeError, ValueError) as error:
            raise WorkspaceError("Неверный идентификатор письма или действия.", 422) from error
        values = self._validated_route(telegram_id, self._fields(payload))
        revision = payload.get("expectedRevision")
        if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
            raise WorkspaceError("Не указана актуальная версия письма.", 422)
        content = {
            **values,
            "expectedRevision": revision,
            "actorUserId": actor["userId"],
            "actorName": actor["fullName"],
        }
        with self._lock:
            old = self.journal.operation(operation_id)
            if old is not None:
                if (old["actor_id"], old["letter_id"], old["kind"], old["payload"]) != (
                    telegram_id,
                    letter_id,
                    "letter.update",
                    content,
                ):
                    raise WorkspaceError("Повтор действия содержит другие данные.", 409)
                return self.read(telegram_id, letter_id)
            letter = self.read(telegram_id, letter_id)
            if letter["createdByUserId"] != actor["userId"]:
                raise WorkspaceError("Редактировать письмо может только автор.", 403)
            if letter["status"] not in _EDITABLE or letter["revision"] != revision:
                raise WorkspaceError("Письмо уже изменилось. Откройте актуальную версию.", 409)
            if letter["workflowKind"] != values["workflowKind"]:
                raise WorkspaceError("Вид заявки нельзя изменить после создания.", 422)
            self.journal.append_with_rights_evidence(
                operation_id=operation_id,
                actor_id=telegram_id,
                letter_id=letter_id,
                kind="letter.update",
                payload=content,
                required_action="edit",
            )
            return self.read(telegram_id, letter_id)

    def attach(
        self,
        telegram_id: str,
        letter_id: str,
        operation_id: str,
        *,
        file_name: str,
        content: bytes,
        role: str,
        expected_revision: int,
    ) -> dict[str, Any]:
        """Persist a document before returning success to the sender."""
        actor = self._actor(telegram_id, "edit")
        try:
            letter_id, operation_id = str(UUID(letter_id)), str(UUID(operation_id))
        except (TypeError, ValueError) as error:
            raise WorkspaceError("Неверный идентификатор письма или действия.", 422) from error
        if (
            not isinstance(file_name, str)
            or not file_name.strip()
            or len(file_name) > 255
            or file_name != PurePath(file_name).name
            or any(char in file_name for char in ("/", "\\", "\0", "\r", "\n"))
        ):
            raise WorkspaceError("Неверное имя файла.", 422)
        if role not in {"primary", "additional"} or (
            role == "primary" and not file_name.lower().endswith(".docx")
        ):
            raise WorkspaceError("Основное письмо должно быть DOCX.", 422)
        if not isinstance(content, bytes) or not 0 < len(content) <= _MAX_ATTACHMENT_BYTES:
            raise WorkspaceError("Файл пустой или слишком большой.", 413)
        if (
            not isinstance(expected_revision, int)
            or isinstance(expected_revision, bool)
            or expected_revision < 1
        ):
            raise WorkspaceError("Не указана актуальная версия письма.", 422)
        with self._lock:
            digest = hashlib.sha256(content).hexdigest()
            payload = {
                "fileName": file_name,
                "role": role,
                "byteSize": len(content),
                "expectedRevision": expected_revision,
                "actorUserId": actor["userId"],
                "actorName": actor["fullName"],
            }
            old = self.journal.operation(operation_id)
            if old is not None:
                if (
                    old["actor_id"],
                    old["letter_id"],
                    old["kind"],
                    old["payload"],
                    old["blob_sha256"],
                ) != (telegram_id, letter_id, "letter.attachment", payload, digest):
                    raise WorkspaceError("Повтор загрузки содержит другой файл.", 409)
                self.journal.put_blob(content)
                attachment_id = str(uuid5(NAMESPACE_URL, "ai-offline-attachment:" + operation_id))
                return next(
                    item
                    for item in self.read(telegram_id, letter_id)["attachments"]
                    if item["id"] == attachment_id
                )
            letter = self.read(telegram_id, letter_id)
            if letter["createdByUserId"] != actor["userId"] or letter["status"] not in _EDITABLE:
                raise WorkspaceError("Загрузить файл может автор редактируемого письма.", 403)
            if letter["revision"] != expected_revision:
                raise WorkspaceError("Письмо уже изменилось. Обновите данные.", 409)
            if letter["workflowKind"] == "sign_only" and role != "primary":
                raise WorkspaceError("Для подписи загрузите только основной DOCX.", 422)
            existing_attachment = next(
                (
                    item
                    for item in letter["attachments"]
                    if item["sha256"] == digest
                    and item["fileName"] == file_name
                    and item["documentRole"] == role
                ),
                None,
            )
            if isinstance(existing_attachment, dict):
                return {str(key): value for key, value in existing_attachment.items()}
            self.journal.put_blob(content)
            self.journal.append_with_rights_evidence(
                operation_id=operation_id,
                actor_id=telegram_id,
                letter_id=letter_id,
                kind="letter.attachment",
                payload=payload,
                blob_sha256=digest,
                required_action="edit",
            )
            attachment_id = str(uuid5(NAMESPACE_URL, "ai-offline-attachment:" + operation_id))
            return next(
                item
                for item in self.read(telegram_id, letter_id)["attachments"]
                if item["id"] == attachment_id
            )

    def check_document(
        self,
        telegram_id: str,
        letter_id: str,
        operation_id: str,
        checker: Callable[[Path, list[dict[str, str]], str], list[str]],
    ) -> dict[str, Any]:
        """Run the real facsimile checker against the durable primary DOCX."""
        actor = self._actor(telegram_id, "edit")
        try:
            letter_id, operation_id = str(UUID(letter_id)), str(UUID(operation_id))
        except (TypeError, ValueError) as error:
            raise WorkspaceError("Неверный идентификатор письма или действия.", 422) from error
        with self._lock:
            letter = self.read(telegram_id, letter_id)
            if letter["createdByUserId"] != actor["userId"] or letter["status"] not in _EDITABLE:
                raise WorkspaceError("Проверить документ может только автор черновика.", 403)
            primary = next(
                (
                    item
                    for item in reversed(letter["attachments"])
                    if item["documentRole"] == "primary"
                ),
                None,
            )
            if primary is None or not primary["fileName"].lower().endswith(".docx"):
                raise WorkspaceError("Сначала загрузите основной DOCX.", 422)
            catalog = self.journal.snapshot(telegram_id, "/reviewers")
            if catalog is None:
                raise WorkspaceError("Нет проверенного списка согласующих.", 503)
            reviewers = [
                {"key": item["key"], "name": item["fullName"]}
                for item in catalog["payload"].get("reviewers", [])
                if isinstance(item, dict)
                and item.get("canApprove")
                and isinstance(item.get("key"), str)
                and isinstance(item.get("fullName"), str)
            ]
            if not reviewers:
                raise WorkspaceError("Нет доступных согласующих для проверки подписи.", 503)
            digest = primary["sha256"]
            old = self.journal.operation(operation_id)
            if old is not None:
                if (
                    old["kind"] != "letter.document_check"
                    or old["letter_id"] != letter_id
                    or old["blob_sha256"] != digest
                    or old["actor_id"] != telegram_id
                ):
                    raise WorkspaceError("Проверяемый документ изменился.", 409)
                previous_check = self.read(telegram_id, letter_id).get("documentCheck")
                if not isinstance(previous_check, dict):
                    raise WorkspaceError("Результат прежней проверки недоступен.", 409)
                return {str(key): value for key, value in previous_check.items()}
            content = self.journal.read_blob(digest)
            revision = letter["revision"]
            workflow_kind = letter["workflowKind"]
        with TemporaryDirectory(prefix="referent-offline-preflight-") as temporary:
            draft = Path(temporary) / "letter.docx"
            draft.write_bytes(content)
            try:
                passed_keys = checker(draft, reviewers, workflow_kind)
            except Exception:
                # Office/COM may fail; never turn an unknown outcome into a pass.
                passed_keys = []
        allowed = {item["key"] for item in reviewers}
        if not isinstance(passed_keys, list) or any(key not in allowed for key in passed_keys):
            passed_keys = []
        keys = sorted(set(passed_keys))
        selected = letter["finalReviewerUserId"] or letter["reviewerUserId"]
        selected_key = next(
            (
                item["key"]
                for item in catalog["payload"]["reviewers"]
                if item.get("userId") == selected
            ),
            None,
        )
        # Telegram uploads the DOCX before asking for a reviewer. Validate all
        # available signatures now; the eventual selection is checked at submit.
        passed = bool(keys and (selected_key is None or selected_key in keys))
        result = {
            "status": "passed" if passed else "failed",
            "reviewerKeys": keys,
            "detail": ""
            if passed
            else (
                "Проверка безопасного размещения подписи не пройдена. "
                "Обратитесь к IT-специалисту и загрузите исправленный DOCX."
            ),
            "expectedRevision": revision,
            "actorUserId": actor["userId"],
            "actorName": actor["fullName"],
        }
        with self._lock:
            latest = self.read(telegram_id, letter_id)
            current = next(
                (
                    item
                    for item in reversed(latest["attachments"])
                    if item["documentRole"] == "primary"
                ),
                None,
            )
            if latest["revision"] != revision or current is None or current["sha256"] != digest:
                raise WorkspaceError("Документ изменился во время проверки. Повторите её.", 409)
            self.journal.append_with_rights_evidence(
                operation_id=operation_id,
                actor_id=telegram_id,
                letter_id=letter_id,
                kind="letter.document_check",
                payload=result,
                blob_sha256=digest,
                required_action="edit",
            )
            saved_check = self.read(telegram_id, letter_id).get("documentCheck")
            if not isinstance(saved_check, dict):
                raise ValueError("Результат проверки не сохранился в локальном журнале.")
            return {str(key): value for key, value in saved_check.items()}

    def act(
        self,
        telegram_id: str,
        letter_id: str,
        operation_id: str,
        *,
        action: str,
        expected_revision: int,
        comment: str = "",
        comment_audio_id: str | None = None,
    ) -> dict[str, Any]:
        """Handle only decisions whose complete local effects are implemented."""
        if action not in {"submit", "approve", "return_for_revision", "cancel"}:
            raise WorkspaceError("Это решение пока недоступно без связи с сервером.", 503)
        actor = self._actor(telegram_id, "view")
        try:
            letter_id, operation_id = str(UUID(letter_id)), str(UUID(operation_id))
        except (TypeError, ValueError) as error:
            raise WorkspaceError("Неверный идентификатор письма или действия.", 422) from error
        if (
            not isinstance(expected_revision, int)
            or isinstance(expected_revision, bool)
            or expected_revision < 1
            or not isinstance(comment, str)
            or len(comment.strip()) > 2000
        ):
            raise WorkspaceError("Неверная версия письма или комментарий.", 422)
        comment = comment.strip()
        if comment_audio_id is not None:
            try:
                comment_audio_id = str(UUID(comment_audio_id))
            except (TypeError, ValueError) as error:
                raise WorkspaceError(
                    "Неверный идентификатор голосового комментария.", 422
                ) from error
            if action != "return_for_revision":
                raise WorkspaceError("Голосовой комментарий доступен только при возврате.", 422)
        if action == "return_for_revision" and len(comment) < 3 and comment_audio_id is None:
            raise WorkspaceError("Укажите причину возврата.", 422)
        with self._lock:
            old = self.journal.operation(operation_id)
            if old is not None:
                payload = old["payload"]
                if (
                    old["actor_id"],
                    old["letter_id"],
                    old["kind"],
                    payload.get("action"),
                    payload.get("expectedRevision"),
                    payload.get("comment"),
                    payload.get("commentAudioId"),
                ) != (
                    telegram_id,
                    letter_id,
                    "letter.action",
                    action,
                    expected_revision,
                    comment,
                    comment_audio_id,
                ):
                    raise WorkspaceError("Повтор решения содержит другие данные.", 409)
                if (
                    action == "return_for_revision"
                    and payload.get("fromStatus") == "referent_review_pending"
                ):
                    return {
                        "id": letter_id, "status": "needs_revision",
                        "revision": expected_revision + 1,
                    }
                return self.read(telegram_id, letter_id)
            letter = self.read(telegram_id, letter_id)
            required = (
                "admin" if action == "return_for_revision"
                and letter["status"] == "referent_review_pending"
                else "approve" if action in {"approve", "return_for_revision"} else "edit"
            )
            if required not in actor["moduleActions"]:
                raise WorkspaceError("У вас нет права на это решение.", 403)
            if letter["revision"] != expected_revision:
                raise WorkspaceError("Письмо уже изменилось. Откройте актуальную версию.", 409)
            if comment_audio_id is not None:
                audio = next(
                    (
                        item
                        for item in self.journal.letter_operations(letter_id)
                        if item["kind"] == "letter.comment_audio"
                        and str(uuid5(NAMESPACE_URL, "ai-offline-audio:" + item["operation_id"]))
                        == comment_audio_id
                    ),
                    None,
                )
                if (
                    audio is None
                    or audio["actor_id"] != telegram_id
                    or audio["payload"]["revision"] != expected_revision
                ):
                    raise WorkspaceError("Аудио не относится к текущему решению.", 422)
            creator = letter["createdByUserId"] == actor["userId"]
            reviewer = letter["reviewerUserId"] == actor["userId"]
            next_reviewer = None
            outgoing_number = None
            year_suffix = None
            if action == "submit":
                if not creator or letter["status"] not in _EDITABLE:
                    raise WorkspaceError("Отправить на согласование может автор черновика.", 403)
                selected = letter["finalReviewerUserId"] or letter["reviewerUserId"]
                catalog = self.journal.snapshot(telegram_id, "/reviewers")
                if catalog is None:
                    raise WorkspaceError("Нет проверенного списка согласующих.", 503)
                selected_key = next(
                    (
                        item.get("key")
                        for item in catalog["payload"].get("reviewers", [])
                        if isinstance(item, dict) and item.get("userId") == selected
                    ),
                    None,
                )
                if letter["reviewerUserId"] is None or not selected_key:
                    raise WorkspaceError("Сначала выберите согласующего.", 422)
                if letter["workflowKind"] == "delivery" and (
                    not letter["recipientOrganization"] or not letter["recipientAddress"]
                ):
                    raise WorkspaceError("Выберите организацию и адрес получателя.", 422)
                if (
                    letter["workflowKind"] == "delivery"
                    and selected_key == "bobur"
                    and not letter["finalReviewerUserId"]
                ):
                    raise WorkspaceError("Перед Бобуром нужен предварительный согласующий.", 422)
                if not any(
                    item["documentRole"] == "primary" and item["fileName"].lower().endswith(".docx")
                    for item in letter["attachments"]
                ):
                    raise WorkspaceError("Перед согласованием загрузите основной DOCX.", 422)
                check = letter.get("documentCheck")
                if (
                    not check
                    or check["status"] != "passed"
                    or selected_key not in check["reviewerKeys"]
                ):
                    raise WorkspaceError("Проверка подписи ещё не пройдена.", 409)
                next_status = "pending_review"
            elif action == "cancel":
                if not creator or letter["status"] not in _EDITABLE | {"pending_review"}:
                    raise WorkspaceError("Отменить письмо на этом этапе нельзя.", 403)
                next_status = "cancelled"
            else:
                operator_return = (
                    action == "return_for_revision"
                    and letter["status"] == "referent_review_pending"
                    and "admin" in actor["moduleActions"]
                )
                if not operator_return and (not reviewer or not actor.get("reviewerKeys")):
                    raise WorkspaceError("Решение доступно назначенному согласующему.", 403)
                if letter["status"] not in (
                    {"pending_review", "awaiting_final_send", "referent_review_pending"}
                    if action == "return_for_revision" else {"pending_review"}
                ) or (letter["status"] == "referent_review_pending" and not operator_return):
                    raise WorkspaceError("Письмо не ожидает этого решения.", 409)
                if action == "return_for_revision":
                    next_status = "needs_revision"
                    next_reviewer = letter["initialReviewerUserId"]
                elif letter["finalReviewerUserId"] and (
                    letter["reviewerUserId"] != letter["finalReviewerUserId"]
                ):
                    next_status = "pending_review"
                    next_reviewer = letter["finalReviewerUserId"]
                else:
                    next_status = "queued"
                    if letter["workflowKind"] == "delivery":
                        if letter["outgoingNumber"] is not None:
                            outgoing_number = letter["outgoingNumber"]
                            year_suffix = letter["yearSuffix"]
                        else:
                            authority = self.journal.authority_state()
                            if authority is None:
                                raise WorkspaceError("Нет автономной аренды робота.", 503)
                            try:
                                outgoing_number, year_suffix = self.journal.take_reserved_number(
                                    letter_id, authority["agent_id"]
                                )
                            except ValueError as error:
                                raise WorkspaceError(str(error), 409) from error
            payload = {
                "action": action,
                "comment": comment,
                "commentAudioId": comment_audio_id,
                "expectedRevision": expected_revision,
                "fromStatus": letter["status"],
                "toStatus": next_status,
                "nextReviewerUserId": next_reviewer,
                "outgoingNumber": outgoing_number,
                "yearSuffix": year_suffix,
                "actorUserId": actor["userId"],
                "actorName": actor["fullName"],
                "creatorUserId": letter["createdByUserId"],
            }
            self.journal.append_with_rights_evidence(
                operation_id=operation_id,
                actor_id=telegram_id,
                letter_id=letter_id,
                kind="letter.action",
                payload=payload,
                required_action=required,
            )
            if required == "admin" and next_status == "needs_revision":
                # The operator has completed the final intervention and must not
                # acquire visibility into the author's next review cycle.
                return {"id": letter_id, "status": next_status, "revision": expected_revision + 1}
            return self.read(telegram_id, letter_id)

    def save_comment_audio(
        self,
        telegram_id: str,
        letter_id: str,
        operation_id: str,
        *,
        expected_revision: int,
        duration_ms: int,
        content: bytes,
        content_type: str,
    ) -> dict[str, Any]:
        """Bind a private Opus blob to the reviewer and exact decision revision."""
        actor = self._actor(telegram_id, "view")
        try:
            letter_id, operation_id = str(UUID(letter_id)), str(UUID(operation_id))
        except (TypeError, ValueError) as error:
            raise WorkspaceError("Неверный идентификатор письма или действия.", 422) from error
        if (
            not isinstance(content, bytes)
            or not 0 < len(content) <= _MAX_COMMENT_AUDIO_BYTES
            or not isinstance(expected_revision, int)
            or isinstance(expected_revision, bool)
            or expected_revision < 1
            or not isinstance(duration_ms, int)
            or isinstance(duration_ms, bool)
            or not 1 <= duration_ms <= 300_000
        ):
            raise WorkspaceError("Голосовой комментарий: не более 5 минут и 10 МБ.", 422)
        ogg = content.startswith(b"OggS") and b"OpusHead" in content[:65536]
        webm = content.startswith(b"\x1a\x45\xdf\xa3") and b"OpusHead" in content[:65536]
        if not (
            (ogg and content_type in {"audio/ogg", "audio/opus"})
            or (webm and content_type in {"audio/webm", "video/webm"})
        ):
            raise WorkspaceError("Нужна голосовая запись Opus в OGG или WebM.", 422)
        mime = "audio/ogg" if ogg else "audio/webm"
        digest = hashlib.sha256(content).hexdigest()
        with self._lock:
            payload = {
                "revision": expected_revision,
                "durationMs": duration_ms,
                "contentType": mime,
                "byteSize": len(content),
                "actorUserId": actor["userId"],
                "actorName": actor["fullName"],
            }
            old = self.journal.operation(operation_id)
            if old is not None and (
                old["actor_id"],
                old["letter_id"],
                old["kind"],
                old["payload"],
                old["blob_sha256"],
            ) != (telegram_id, letter_id, "letter.comment_audio", payload, digest):
                raise WorkspaceError("Повтор загрузки содержит другое аудио.", 409)
            if old is not None:
                self.journal.put_blob(content)
                return {
                    "id": str(uuid5(NAMESPACE_URL, "ai-offline-audio:" + operation_id)),
                    "contentType": mime,
                    "durationMs": duration_ms,
                    "byteSize": len(content),
                }
            letter = self.read(telegram_id, letter_id)
            operator = (
                letter["status"] == "referent_review_pending"
                and "admin" in actor["moduleActions"]
            )
            reviewer = (
                letter["status"] in {"pending_review", "awaiting_final_send"}
                and letter["reviewerUserId"] == actor["userId"]
                and "approve" in actor["moduleActions"]
                and bool(actor.get("reviewerKeys"))
            )
            if letter["revision"] != expected_revision or not (operator or reviewer):
                raise WorkspaceError("Сейчас вы не можете вернуть это письмо.", 403)
            self.journal.put_blob(content)
            self.journal.append_with_rights_evidence(
                operation_id=operation_id,
                actor_id=telegram_id,
                letter_id=letter_id,
                kind="letter.comment_audio",
                payload=payload,
                blob_sha256=digest,
                required_action="admin" if operator else "approve",
            )
            return {
                "id": str(uuid5(NAMESPACE_URL, "ai-offline-audio:" + operation_id)),
                "contentType": mime,
                "durationMs": duration_ms,
                "byteSize": len(content),
            }

    def read(self, telegram_id: str, letter_id: str) -> dict[str, Any]:
        actor = self._actor(telegram_id, "view")
        try:
            letter_id = str(UUID(letter_id))
        except (TypeError, ValueError) as error:
            raise WorkspaceError("Неверный идентификатор письма.", 422) from error
        snapshot = self.journal.snapshot(telegram_id, "/letters/" + letter_id)
        baseline = (
            snapshot["payload"]
            if snapshot is not None
            else self.journal.cached_letter(telegram_id, letter_id)
        )
        letter = deepcopy(baseline) if baseline is not None else None
        audio_by_id: dict[str, dict[str, Any]] = {}
        for operation in self.journal.letter_operations(letter_id):
            payload = operation["payload"]
            if operation["kind"] == "letter.create":
                if letter is not None:
                    raise ValueError("Локальное письмо конфликтует с серверной копией.")
                letter = {
                    "id": letter_id,
                    "displayNumber": None,
                    "outgoingNumber": None,
                    "yearSuffix": None,
                    "subject": payload["subject"],
                    "recipientOrganization": payload["recipientOrganization"],
                    "recipientAddress": payload["recipientAddress"],
                    "route": payload["route"],
                    "note": payload["note"],
                    "status": "draft",
                    "workflowKind": payload["workflowKind"],
                    "source": "telegram",
                    "createdByUserId": payload["actorUserId"],
                    "createdByName": payload["actorName"],
                    "reviewerUserId": payload["reviewerUserId"],
                    "reviewerName": self._reviewer_name(telegram_id, payload["reviewerUserId"]),
                    "finalReviewerUserId": payload["finalReviewerUserId"],
                    "finalReviewerName": self._reviewer_name(
                        telegram_id, payload["finalReviewerUserId"]
                    ),
                    "initialReviewerUserId": payload["reviewerUserId"],
                    "deliveryError": "",
                    "revision": 1,
                    "sentAt": None,
                    "createdAt": operation["occurred_at"],
                    "updatedAt": operation["occurred_at"],
                    "attachments": [],
                    "events": [],
                    "documentCheck": None,
                    "finalPdfFileId": None,
                }
            elif operation["kind"] == "letter.update":
                if letter is None or letter["revision"] != payload["expectedRevision"]:
                    raise ValueError("Локальные изменения письма потеряли порядок.")
                letter.update({key: payload[key] for key in _FIELDS})
                letter.update(
                    {
                        "route": payload["route"],
                        "reviewerUserId": payload["reviewerUserId"],
                        "reviewerName": self._reviewer_name(telegram_id, payload["reviewerUserId"]),
                        "finalReviewerUserId": payload["finalReviewerUserId"],
                        "finalReviewerName": self._reviewer_name(
                            telegram_id, payload["finalReviewerUserId"]
                        ),
                        "initialReviewerUserId": payload["reviewerUserId"],
                        "revision": letter["revision"] + 1,
                        "updatedAt": operation["occurred_at"],
                    }
                )
            elif operation["kind"] == "letter.attachment":
                if letter is None or letter["revision"] != payload["expectedRevision"]:
                    raise ValueError("Локальная загрузка потеряла версию письма.")
                if payload["role"] == "primary":
                    for attachment in letter["attachments"]:
                        if attachment["documentRole"] == "primary":
                            attachment["documentRole"] = "general"
                    letter["documentCheck"] = None
                letter["attachments"].append(
                    {
                        "id": str(
                            uuid5(
                                NAMESPACE_URL, "ai-offline-attachment:" + operation["operation_id"]
                            )
                        ),
                        "ownerType": "ai_referent_letter",
                        "ownerId": letter_id,
                        "fileName": payload["fileName"],
                        "contentType": "application/octet-stream",
                        "byteSize": payload["byteSize"],
                        "sha256": operation["blob_sha256"],
                        "uploadedByUserId": payload["actorUserId"],
                        "documentRole": payload["role"],
                        "mediaKind": "file",
                        "mediaDurationMs": None,
                        "mediaCodec": None,
                        "createdAt": operation["occurred_at"],
                    }
                )
                # The shared server increments the letter revision on every
                # new attachment. Keep local and replayed revisions identical.
                letter["revision"] += 1
                letter["updatedAt"] = operation["occurred_at"]
                continue
            elif operation["kind"] == "letter.document_check":
                if letter is None or letter["revision"] != payload["expectedRevision"]:
                    raise ValueError("Локальная проверка потеряла версию письма.")
                primary = next(
                    (
                        item
                        for item in reversed(letter["attachments"])
                        if item["documentRole"] == "primary"
                    ),
                    None,
                )
                if primary is None or primary["sha256"] != operation["blob_sha256"]:
                    raise ValueError("Локальная проверка относится к другому документу.")
                letter["documentCheck"] = {
                    "id": str(
                        uuid5(NAMESPACE_URL, "ai-offline-check:" + operation["operation_id"])
                    ),
                    "status": payload["status"],
                    "reviewerKeys": payload["reviewerKeys"],
                    "detail": payload["detail"],
                }
                continue
            elif operation["kind"] == "letter.comment_audio":
                if letter is None or letter["revision"] != payload["revision"]:
                    raise ValueError("Аудио относится к другой версии письма.")
                audio_id = str(
                    uuid5(NAMESPACE_URL, "ai-offline-audio:" + operation["operation_id"])
                )
                audio_by_id[audio_id] = {
                    "id": audio_id,
                    "contentType": payload["contentType"],
                    "durationMs": payload["durationMs"],
                    "byteSize": payload["byteSize"],
                }
                continue
            elif operation["kind"] == "letter.action":
                if (
                    letter is None
                    or letter["revision"] != payload["expectedRevision"]
                    or letter["status"] != payload["fromStatus"]
                ):
                    raise ValueError("Локальное решение потеряло порядок стадий.")
                letter["status"] = payload["toStatus"]
                letter["revision"] += 1
                letter["updatedAt"] = operation["occurred_at"]
                if payload["nextReviewerUserId"]:
                    letter["reviewerUserId"] = payload["nextReviewerUserId"]
                    letter["reviewerName"] = self._reviewer_name(
                        telegram_id, payload["nextReviewerUserId"]
                    )
                if payload["outgoingNumber"] is not None:
                    letter["outgoingNumber"] = payload["outgoingNumber"]
                    letter["yearSuffix"] = payload["yearSuffix"]
                    letter["displayNumber"] = (
                        f"{payload['outgoingNumber']:04d}/{payload['yearSuffix']}-AI"
                    )
                if letter["status"] == "needs_revision":
                    letter["finalPdfFileId"] = None
                audio_id = payload.get("commentAudioId")
                if audio_id is not None and audio_id not in audio_by_id:
                    raise ValueError("Голосовой комментарий не сохранён до решения.")
                letter["events"].append(
                    {
                        "id": str(
                            uuid5(NAMESPACE_URL, "ai-offline-event:" + operation["operation_id"])
                        ),
                        "eventType": "letter." + payload["action"],
                        "actorUserId": payload["actorUserId"],
                        "actorName": payload["actorName"],
                        "fromStatus": payload["fromStatus"],
                        "toStatus": payload["toStatus"],
                        "comment": payload["comment"],
                        "audio": audio_by_id.get(audio_id),
                        "createdAt": operation["occurred_at"],
                    }
                )
                continue
            elif operation["kind"] == "letter.prepared":
                if (
                    letter is None or letter["status"] != payload["fromStatus"]
                    or letter["revision"] != payload["expectedRevision"]
                ):
                    raise ValueError("Локальная подготовка потеряла порядок стадий.")
                letter["status"] = payload["toStatus"]
                letter["revision"] += 1
                letter["updatedAt"] = operation["occurred_at"]
                letter["finalPdfFileId"] = str(uuid5(
                    NAMESPACE_URL, "ai-offline-signed:" + operation["operation_id"]
                ))
                letter["events"].append({
                    "id": str(uuid5(
                        NAMESPACE_URL, "ai-offline-event:" + operation["operation_id"]
                    )),
                    "eventType": "agent.prepared", "actorUserId": None,
                    "actorName": "Робот", "fromStatus": payload["fromStatus"],
                    "toStatus": payload["toStatus"], "comment": "", "audio": None,
                    "createdAt": operation["occurred_at"],
                })
                continue
            else:
                continue  # Later reducers own worker receipts.
            letter["events"].append(
                {
                    "id": str(
                        uuid5(NAMESPACE_URL, "ai-offline-event:" + operation["operation_id"])
                    ),
                    "eventType": (
                        "letter.created"
                        if operation["kind"] == "letter.create"
                        else "letter.updated"
                    ),
                    "actorUserId": payload["actorUserId"],
                    "actorName": payload["actorName"],
                    "fromStatus": None
                    if operation["kind"] == "letter.create"
                    else letter["status"],
                    "toStatus": letter["status"],
                    "comment": "",
                    "audio": None,
                    "createdAt": operation["occurred_at"],
                }
            )
        if letter is None:
            raise WorkspaceError("Письмо не сохранено в локальной копии.", 404)
        participant_ids = {
            letter["createdByUserId"],
            letter.get("reviewerUserId"),
            letter.get("finalReviewerUserId"),
            letter.get("initialReviewerUserId"),
        }
        operator_statuses = {
            "referent_review_pending",
            "operator_revision",
            "delivery_unknown",
            "sent",
        }
        if letter["status"] == "sent":
            visible = bool(
                actor["userId"] == letter["createdByUserId"]
                or actor.get("role") in {"manager", "admin", "superadmin"}
                or "admin" in actor["moduleActions"]
            )
        else:
            visible = bool(
                actor["userId"] in participant_ids
                or ("admin" in actor["moduleActions"] and letter["status"] in operator_statuses)
            )
        if not visible:
            raise WorkspaceError("Письмо недоступно этому сотруднику.", 403)
        creator = letter["createdByUserId"] == actor["userId"]
        letter["canEdit"] = (
            creator and "edit" in actor["moduleActions"] and (letter["status"] in _EDITABLE)
        )
        letter["canDelete"] = creator and "edit" in actor["moduleActions"]
        letter["canReplaceDocument"] = False
        actions: list[str] = []
        if creator and "edit" in actor["moduleActions"]:
            if letter["status"] in _EDITABLE:
                catalog = self.journal.snapshot(telegram_id, "/reviewers")
                selected = letter["finalReviewerUserId"] or letter["reviewerUserId"]
                selected_key = (
                    next(
                        (
                            item.get("key")
                            for item in catalog["payload"].get("reviewers", [])
                            if isinstance(item, dict) and item.get("userId") == selected
                        ),
                        None,
                    )
                    if catalog is not None
                    else None
                )
                check = letter.get("documentCheck")
                primary_ready = any(
                    item["documentRole"] == "primary" and item["fileName"].lower().endswith(".docx")
                    for item in letter["attachments"]
                )
                recipient_ready = letter["workflowKind"] == "sign_only" or bool(
                    letter["recipientOrganization"] and letter["recipientAddress"]
                )
                if (
                    selected_key
                    and primary_ready
                    and recipient_ready
                    and check
                    and check["status"] == "passed"
                    and selected_key in check["reviewerKeys"]
                    and not (
                        letter["workflowKind"] == "delivery"
                        and selected_key == "bobur"
                        and not letter["finalReviewerUserId"]
                    )
                ):
                    actions.append("submit")
            if letter["status"] in _EDITABLE | {"pending_review"}:
                actions.append("cancel")
        if (
            actor["userId"] == letter["reviewerUserId"]
            and "approve" in actor["moduleActions"]
            and actor.get("reviewerKeys")
        ):
            if letter["status"] == "pending_review":
                actions.extend(("approve", "return_for_revision"))
            elif letter["status"] == "awaiting_final_send":
                actions.append("return_for_revision")
        if letter["status"] == "referent_review_pending" and "admin" in actor["moduleActions"]:
            actions.append("return_for_revision")
        letter["availableActions"] = actions
        return letter
