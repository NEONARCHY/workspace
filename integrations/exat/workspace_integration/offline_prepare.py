"""Prepare one signed PDF locally while the Workspace authority is offline."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from .client import WorkspaceError
from .offline_journal import OfflineJournal
from .offline_workflow import OfflineWorkflow
from .worker import DeliveryWorker


class OfflinePreparationWorker:
    def __init__(self, worker: DeliveryWorker, journal: OfflineJournal):
        self.worker, self.journal = worker, journal
        self.workflow = OfflineWorkflow(journal)

    def run_once(self) -> bool:
        state = self.journal.authority_state()
        if state is None or state["phase"] != "offline":
            return False
        approval = self.journal.next_unprepared_approval()
        if approval is None:
            return False
        actor_id, letter_id = approval["actor_id"], approval["letter_id"]
        letter = self.workflow.read(actor_id, letter_id)
        if letter["status"] != "queued":
            raise WorkspaceError("Письмо не ожидает автономной подготовки.", 409)
        actors = self.journal.verified_actors()
        sender_id = next(
            (item["telegramId"] for item in actors
             if item["userId"] == letter["createdByUserId"]), "",
        )
        command_id = str(uuid5(
            NAMESPACE_URL, "ai-offline-command:" + approval["operation_id"]
        ))
        job: dict[str, Any] = {
            "id": command_id,
            "leaseToken": "offline-only",
            "kind": "sign_only" if letter["workflowKind"] == "sign_only" else "prepare",
            "requiresFinalCheck": True,  # Do not open a delivery window before a human decision.
            "letterId": letter_id,
            "outgoingNumber": letter["outgoingNumber"],
            "yearSuffix": letter["yearSuffix"],
            "subject": letter["subject"] or letter["displayNumber"] or "",
            "recipientOrganization": letter["recipientOrganization"],
            "recipientAddress": letter["recipientAddress"],
            "route": letter["route"],
            "senderName": letter["createdByName"],
            "reviewerName": letter["reviewerName"],
            "senderTelegramId": sender_id,
            "reviewerTelegramId": actor_id,
            "files": [
                {
                    "id": item["id"], "name": item["fileName"],
                    "role": item["documentRole"], "sha256": item["sha256"],
                    "byteSize": item["byteSize"],
                }
                for item in letter["attachments"]
            ],
        }

        def load(_job: dict[str, Any], item: dict[str, Any], folder: Path) -> Path:
            file_id = str(UUID(item["id"]))
            name = item["name"]
            if (
                not isinstance(name, str) or name in {"", ".", ".."}
                or Path(name).name != name or ":" in name or "\\" in name
            ):
                raise WorkspaceError("Небезопасное имя автономного файла.", 422)
            try:
                content = self.journal.read_blob(item["sha256"])
            except (FileNotFoundError, ValueError) as error:
                raise WorkspaceError(
                    "Исходный документ ещё не сохранён на ПК референта.", 503
                ) from error
            if len(content) != item["byteSize"]:
                raise WorkspaceError("Размер исходного документа изменился.", 503)
            target = folder / file_id / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            return target

        def record(signed: Path) -> None:
            self.workflow.record_prepared(
                actor_id, letter_id, approval["operation_id"], signed.read_bytes()
            )

        if letter["workflowKind"] == "sign_only":
            self.worker.sign_only(
                job, file_loader=load,
                record_signed_pages=lambda pages: self.workflow.record_signed_pages(
                    actor_id, letter_id, approval["operation_id"], pages
                ),
            )
        else:
            self.worker.prepare(job, file_loader=load, record_signed=record)
        return True

    def run_dispatch_once(self) -> bool:
        """Prepare the confirmed PDF for an operator without clicking Send."""
        state = self.journal.authority_state()
        if state is None or state["phase"] != "offline":
            return False
        release = self.journal.next_undispatched_release()
        if release is None:
            return False
        actor_id, letter_id = release["actor_id"], release["letter_id"]
        letter = self.workflow.read(actor_id, letter_id)
        prepared = next(
            (item for item in reversed(self.journal.letter_operations(letter_id))
             if item["kind"] == "letter.prepared"), None,
        )
        if (
            letter["status"] != "queued" or prepared is None
            or prepared["blob_sha256"] is None
        ):
            raise WorkspaceError("Подписанный PDF для отправки не найден.", 409)
        job: dict[str, Any] = {
            "id": str(uuid5(
                NAMESPACE_URL, "ai-offline-command:" + release["operation_id"]
            )),
            "kind": "dispatch", "letterId": letter_id, "leaseToken": "offline-only",
            "signedFile": {"sha256": prepared["blob_sha256"]},
        }
        result = self.worker.dispatch(job)
        if result.get("outcome") != "ready":
            raise WorkspaceError("Окно отправки не подготовлено.", 503)
        self.workflow.record_dispatched(
            actor_id, letter_id, release["operation_id"],
            auto_send=bool(result.get("autoSend", False)),
        )
        return True

    def run_send_once(self) -> bool:
        """Send once behind an fsynced fence; never retry an uncertain click."""
        authority = self.journal.authority_state()
        if authority is None or authority["phase"] != "offline":
            return False
        source = self.journal.next_unsent_command()
        if source is None:
            return False
        actor_id, letter_id = source["actor_id"], source["letter_id"]
        letter = self.workflow.read(actor_id, letter_id)
        prepared = next(
            (item for item in reversed(self.journal.letter_operations(letter_id))
             if item["kind"] == "letter.prepared"), None,
        )
        if (
            letter["status"] != "queued" or prepared is None
            or prepared["blob_sha256"] is None
            or letter["workflowKind"] != "delivery"
        ):
            raise WorkspaceError("Подписанный PDF для отправки не найден.", 409)
        command_id = str(uuid5(
            NAMESPACE_URL,
            ("ai-offline-command:" if source["kind"] == "letter.action"
             else "ai-offline-send-command:") + source["operation_id"],
        ))
        effect_id = str(uuid5(
            NAMESPACE_URL, "ai-offline-effect:" + source["operation_id"]
        ))
        job: dict[str, Any] = {
            "id": command_id, "kind": "send", "letterId": letter_id,
            "leaseToken": "offline-only",
            "signedFile": {"sha256": prepared["blob_sha256"]},
        }

        def fence() -> None:
            current = self.journal.authority_state()
            if current is None or current["phase"] != "offline":
                raise WorkspaceError("Автономная аренда изменилась перед отправкой.", 409)
            if not self.journal.begin_external_effect(
                effect_id, letter_id, letter["route"] + "_send"
            ):
                raise WorkspaceError(
                    "Отправка уже начиналась. Повтор заблокирован до ручной сверки.", 409
                )

        result = self.worker.send(job, threading.Event(), offline_fence=fence)
        effect = self.journal.external_effect(effect_id)
        if effect is None:
            raise WorkspaceError("Робот не записал начало внешней отправки.", 409)
        if result.get("outcome") != "sent":
            raise WorkspaceError("Исход внешней отправки неизвестен. Нужна ручная сверка.", 409)
        evidence = str(result.get("detail") or "")
        self.journal.resolve_external_effect(effect_id, sent=True, evidence=evidence)
        self.workflow.record_external_result(
            actor_id, letter_id, source["operation_id"], sent=True, evidence=evidence
        )
        return True
