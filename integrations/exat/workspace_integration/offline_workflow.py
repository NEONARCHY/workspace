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
_FIELDS = {
    "subject": 300,
    "recipientOrganization": 300,
    "recipientAddress": 500,
    "note": 5000,
}


class OfflineWorkflow:
    """Reduce immutable operations over the last verified per-actor server copy.

    This module currently handles drafts only. Approval, files and external
    effects must be implemented and tested before callers may enable it live.
    """

    def __init__(self, journal: OfflineJournal):
        self.journal = journal
        self._lock = RLock()

    def _actor(self, telegram_id: str, action: str) -> dict[str, Any]:
        actor = self.journal.offline_actor(telegram_id)
        if actor is None or action not in actor["moduleActions"]:
            raise WorkspaceError("Автономный доступ к AI Referent не подтверждён.", 403)
        return actor

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
            if existing_attachment is not None:
                return existing_attachment
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
                return self.read(telegram_id, letter_id)["documentCheck"]
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
        passed = bool(selected_key and selected_key in keys)
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
            return self.read(telegram_id, letter_id)["documentCheck"]

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
            else:
                continue  # Later reducers own decisions and worker receipts.
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
        if actor["userId"] not in participant_ids and not (
            "admin" in actor["moduleActions"] and letter["status"] in operator_statuses
        ):
            raise WorkspaceError("Письмо недоступно этому сотруднику.", 403)
        creator = letter["createdByUserId"] == actor["userId"]
        letter["canEdit"] = (
            creator and "edit" in actor["moduleActions"] and (letter["status"] in _EDITABLE)
        )
        letter["canDelete"] = creator and "edit" in actor["moduleActions"]
        letter["canReplaceDocument"] = False
        letter["availableActions"] = ["cancel"] if creator and letter["status"] == "draft" else []
        return letter
