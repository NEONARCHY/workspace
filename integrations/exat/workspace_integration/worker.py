"""One physical Exat executor. Only explicit server jobs can sign or send."""

from __future__ import annotations

import hashlib
import json
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from uuid import UUID

from .authority import executing_server_job
from .client import WorkspaceClient, WorkspaceError
from .delivery import close_prepared, guarded_send, prepare_compose, prepared_open
from .state import State
from .sync import ArchiveSync


class DeliveryWorker:
    def __init__(self, service: Any, client: WorkspaceClient, state: State):
        self.service, self.client, self.state = service, client, state
        self.sync = ArchiveSync(service, client, state)
        self.root = Path(service.archive_root) / "workspace"
        self.prepared_handles: dict[int, int | None] = {}

    def bootstrap(self) -> None:
        self.sync.assert_no_legacy_pending()
        self.sync.run()  # Numbers are registered before the server can allocate new ones.
        self.client.request(
            "/ai-referent/agent/ready?" + urlencode({"agentId": self.client.agent_id}),
            method="POST",
        )

    def receipt(self, job: dict[str, Any], outcome: str, detail: str) -> dict[str, Any]:
        return {
            "agentId": self.client.agent_id,
            "leaseToken": job["leaseToken"],
            "outcome": outcome,
            "detail": detail[:2000],
        }

    def flush_results(self) -> None:
        for key, record in self.state.pending("result:"):
            try:
                self.client.request(
                    f"/ai-referent/agent/jobs/{key.split(':', 1)[1]}/result", record, method="POST"
                )
            except WorkspaceError as error:
                if error.status != 409:
                    raise
                # The server expired the lease. Retain evidence; never execute it again.
                self.state.put("unconfirmed:" + key, record)
            self.state.remove(key)

    def tick(self) -> None:
        # Shared mode reads assignments from the API on every action; acknowledge liveness
        # without rewriting the legacy SQLite reviewer history.
        configuration = self.client.configuration()
        self.client.acknowledge(configuration["revision"])
        self.flush_results()
        from .preflight import run_preflight

        if run_preflight(self.service, self.client, self.state):
            return
        job = self.client.request(
            "/ai-referent/agent/jobs/claim?" + urlencode({"agentId": self.client.agent_id}),
            method="POST",
        ).get("job")
        if not job:
            return
        job_id = str(UUID(job["id"]))
        if not self.state.claim("started:" + job_id, job):
            # A persisted start with no acknowledged result must not repeat a GUI click.
            self.state.put(
                "result:" + job_id,
                self.receipt(
                    job,
                    "unknown",
                    "Исполнение уже начиналось. Проверьте журнал Exat; "
                    "автоматический повтор заблокирован.",
                ),
            )
            self.flush_results()
            return
        stop = threading.Event()
        lost = threading.Event()

        def heartbeat() -> None:
            while not stop.wait(25):
                try:
                    self.client.request(
                        f"/ai-referent/agent/jobs/{job_id}/heartbeat",
                        {
                            "agentId": self.client.agent_id,
                            "leaseToken": job["leaseToken"],
                        },
                        method="POST",
                    )
                except WorkspaceError:
                    lost.set()
                    return

        thread = threading.Thread(target=heartbeat, name="workspace-job-heartbeat", daemon=True)
        thread.start()
        authority = executing_server_job.set(True)
        try:
            if job["kind"] in {"prepare", "reprepare"}:
                result = self.prepare(job)
            elif job["kind"] == "sign_only":
                result = self.sign_only(job)
            elif job["kind"] == "send":
                result = self.send(job, lost)
            elif job["kind"] == "dispatch":
                result = self.dispatch(job)
            elif job["kind"] in {"cancel", "replace", "record_sent", "delete"}:
                result = self.finish_local(job)
            else:
                raise WorkspaceError("Неизвестный вид задания. Исполнение остановлено.")
        except Exception as error:
            # Boundary around existing GUI/Office libraries: persist an explicit failure,
            # not a swallowed exception or automatic retry of a possibly delivered letter.
            result = self.receipt(
                job,
                "unknown" if job["kind"] in {"send", "record_sent"} else "failed",
                (
                    str(error)[:1500]
                    if isinstance(error, WorkspaceError)
                    else f"{type(error).__name__}: ошибка обработки на ПК референта."
                ),
            )
        finally:
            executing_server_job.reset(authority)
            stop.set()
            thread.join(timeout=45)
        self.state.put("result:" + job_id, result)
        self.flush_results()
        self.sync.journals()

    def download(self, job: dict[str, Any], item: dict[str, Any], folder: Path) -> Path:
        file_id = str(UUID(item["id"]))
        name = Path(item["name"]).name
        if name != item["name"] or name in {"", ".", ".."} or ":" in name or "\\" in name:
            raise WorkspaceError("Небезопасное имя файла задания.")
        query = urlencode({"leaseToken": job["leaseToken"], "agentId": self.client.agent_id})
        content = self.client.transfer(
            f"/ai-referent/agent/jobs/{job['id']}/files/{file_id}?{query}"
        )
        if (
            len(content) != item["byteSize"]
            or hashlib.sha256(content).hexdigest() != item["sha256"]
        ):
            raise WorkspaceError("Контрольная сумма файла задания не совпала.")
        target = folder / file_id / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        return target

    def prepare(self, job: dict[str, Any]) -> dict[str, Any]:
        from src.outgoing.service import OutgoingReviewDecision

        folder = self.root / str(UUID(job["letterId"])) / str(UUID(job["id"]))
        files = job["files"]
        primary = next((item for item in reversed(files) if item["role"] == "primary"), None)
        accepted = {".docx", ".pdf"} if job["kind"] == "reprepare" else {".docx"}
        if primary is None or Path(primary["name"]).suffix.lower() not in accepted:
            raise WorkspaceError("Для подготовки подписанного PDF требуется основной DOCX.")
        draft = self.download(job, primary, folder)
        extra = [
            str(self.download(job, item, folder)) for item in files if item["role"] == "additional"
        ]
        entry = self.service._resolve_destination_entry(
            job["recipientAddress"] or job["recipientOrganization"]
        )
        if entry.route != job["route"]:
            raise WorkspaceError(
                "Канал получателя в адресной книге отличается от согласованного. "
                "Верните письмо на доработку."
            )
        # A crash between insertion and local receipt can be recovered by the embedded ID.
        existing = None
        for raw in self.service.database.list_outgoing_letters():
            row = dict(raw)
            metadata = json.loads(row.get("dry_run_json") or "{}")
            if (
                row["outgoing_number"] == job["outgoingNumber"]
                and str(row["year_suffix"]) == job["yearSuffix"]
            ):
                if metadata.get("workspace_letter_id") != job["letterId"]:
                    raise WorkspaceError(
                        "Номер уже занят другим письмом в Exat. Отправка остановлена."
                    )
                existing = row
        metadata = json.dumps(
            {"workspace_letter_id": job["letterId"], "workspace_prepare_job": job["id"]}
        )
        values = {
            "outgoing_number": job["outgoingNumber"],
            "year_suffix": job["yearSuffix"],
            "subject": job["subject"],
            "sender_telegram_id": job["senderTelegramId"] or "",
            "sender_name": job["senderName"],
            "reviewer_telegram_id": job["reviewerTelegramId"] or "",
            "reviewer_name": job["reviewerName"],
            "destination_organization": entry.organization,
            "destination_address": entry.primary_address,
            "destination_route": entry.route,
            "draft_file_path": str(draft),
            "attachment_paths_json": json.dumps(extra),
            "status": "waiting_review",
            "review_status": "waiting_review",
            "dry_run_json": metadata,
        }
        if existing:
            local_id = int(existing["id"])
            if existing["status"] in {"exat_sent", "webmail_sent", "edo_sent"}:
                raise WorkspaceError("Exat уже считает письмо отправленным. Нужна ручная сверка.")
            with self.service.database.connect() as connection:
                columns = ", ".join(f"{key} = ?" for key in values)
                connection.execute(
                    f"UPDATE outgoing_letters SET {columns}, signed_file_path = NULL WHERE id = ?",
                    (*values.values(), local_id),
                )
        else:
            local_id = self.service.database.insert_outgoing_letter(values)
        self.state.put("letter:" + job["letterId"], local_id)
        if draft.suffix.lower() == ".pdf":
            if not draft.read_bytes().startswith(b"%PDF-"):
                raise WorkspaceError("Замена не является PDF. Отправка остановлена.")
            self.service.database.update_outgoing_letter(
                local_id,
                signed_file_path=str(draft),
                status="approved",
                review_status="approved",
            )
            result = self.service.database.get_outgoing_letter(local_id)
        else:
            result = self.service.handle_review(
                OutgoingReviewDecision(local_id, "approve"), defer_send=True
            )
        signed = Path(result["signed_file_path"])
        self.sync.upload(
            "outgoing",
            job["letterId"],
            signed,
            f"signed/{job['id']}.pdf",
            jobId=job["id"],
            leaseToken=job["leaseToken"],
        )
        if not job.get("requiresFinalCheck"):
            self.prepared_handles[local_id] = prepare_compose(self.service, local_id)
        receipt = self.receipt(
            job,
            "prepared",
            "Подписанный PDF подготовлен. Отправка не выполнялась.",
        )
        receipt["autoSend"] = job["kind"] == "prepare" and bool(
            (self.service.outgoing_settings.get("exat_send", {}) or {}).get(
                "allow_real_send", False
            )
        )
        return receipt

    def dispatch(self, job: dict[str, Any]) -> dict[str, Any]:
        local_id = self.state.get("letter:" + job["letterId"])
        row = self.service.database.get_outgoing_letter(local_id) if local_id is not None else None
        if row is None or not job.get("signedFile"):
            raise WorkspaceError("Нет локального пакета подтверждённого письма.")
        signed = Path(str(row["signed_file_path"] or ""))
        if (
            not signed.is_file()
            or hashlib.sha256(signed.read_bytes()).hexdigest() != job["signedFile"]["sha256"]
        ):
            raise WorkspaceError("Итоговый PDF изменился. Отправка заблокирована.")
        self.prepared_handles[local_id] = prepare_compose(self.service, local_id)
        return {
            **self.receipt(job, "ready", "Подтверждённый PDF передан в окно отправки."),
            "autoSend": bool(
                (self.service.outgoing_settings.get("exat_send", {}) or {}).get(
                    "allow_real_send", False
                )
            ),
        }

    def sign_only(self, job: dict[str, Any]) -> dict[str, Any]:
        from .sign_only import sign_document_pages

        folder = self.root / "sign-only" / str(UUID(job["letterId"])) / str(UUID(job["id"]))
        primary = next(
            (item for item in reversed(job["files"]) if item["role"] == "primary"), None
        )
        if primary is None or Path(primary["name"]).suffix.lower() != ".docx":
            raise WorkspaceError("Для подписи нужен основной DOCX.")
        draft = self.download(job, primary, folder)
        pages = sign_document_pages(
            self.service.facsimile, draft, folder / "signed", str(job["reviewerName"])
        )
        for page in pages:
            self.sync.upload(
                "outgoing", job["letterId"], page,
                f"signed/{job['id']}/{page.name}",
                jobId=job["id"], leaseToken=job["leaseToken"],
            )
        return {
            **self.receipt(
                job, "prepared",
                f"Подписано {len(pages)} отдельных PDF; отправка не выполнялась.",
            ),
            "signedPages": len(pages),
        }

    def send(self, job: dict[str, Any], lost: threading.Event) -> dict[str, Any]:
        local_id = self.state.get("letter:" + job["letterId"])
        if local_id is None:
            raise WorkspaceError(
                "Локальный пакет подготовки отсутствует. Автоматическая отправка запрещена."
            )
        row = self.service.database.get_outgoing_letter(local_id)
        if row is None:
            raise WorkspaceError("Локальная запись письма отсутствует.")
        if row["status"] in {"exat_sent", "webmail_sent"}:
            return self.receipt(
                job, "sent", f"Подтверждено журналом Exat: {row['status']}, запись {local_id}"
            )
        if not job.get("signedFile"):
            raise WorkspaceError("Согласованный PDF отсутствует на сервере.")
        signed = Path(str(row["signed_file_path"] or ""))
        if (
            not signed.is_file()
            or hashlib.sha256(signed.read_bytes()).hexdigest() != job["signedFile"]["sha256"]
        ):
            raise WorkspaceError(
                "Локальный PDF отличается от согласованного. Отправка заблокирована."
            )
        if lost.is_set():
            raise WorkspaceError("Потеряна связь перед отправкой.")
        # Check ownership immediately before the irreversible external operation.
        self.client.request(
            f"/ai-referent/agent/jobs/{job['id']}/heartbeat",
            {
                "agentId": self.client.agent_id,
                "leaseToken": job["leaseToken"],
            },
            method="POST",
        )
        if not prepared_open(self.service, row, self.prepared_handles.get(local_id)):
            self.prepared_handles[local_id] = prepare_compose(self.service, local_id)
        current = self.service.database.get_outgoing_letter(local_id)
        if current["status"] in {"exat_compose_prepared", "webmail_dry_run_prepared"}:
            if lost.is_set():
                raise WorkspaceError("Связь потеряна перед подтверждением отправки.")
            self.client.request(
                f"/ai-referent/agent/jobs/{job['id']}/heartbeat",
                {
                    "agentId": self.client.agent_id,
                    "leaseToken": job["leaseToken"],
                },
                method="POST",
            )

            def fence() -> None:
                if (
                    lost.is_set()
                    or hashlib.sha256(signed.read_bytes()).hexdigest()
                    != job["signedFile"]["sha256"]
                ):
                    raise WorkspaceError("Связь или подписанный файл изменились перед отправкой.")
                self.client.request(
                    f"/ai-referent/agent/jobs/{job['id']}/heartbeat",
                    {"agentId": self.client.agent_id, "leaseToken": job["leaseToken"]},
                    method="POST",
                )

            with guarded_send(self.service, row, self.prepared_handles.get(local_id), fence):
                self.service.confirm_manual_send(local_id)
        current = self.service.database.get_outgoing_letter(local_id)
        if current["status"] not in {"exat_sent", "webmail_sent"}:
            raise WorkspaceError("Exat не подтвердил отправку. Проверьте открытое окно и журнал.")
        return self.receipt(
            job, "sent", f"Подтверждено Exat: {current['status']}, запись {local_id}"
        )

    def finish_local(self, job: dict[str, Any]) -> dict[str, Any]:
        local_id = self.state.get("letter:" + job["letterId"])
        row = self.service.database.get_outgoing_letter(local_id) if local_id is not None else None
        if job["kind"] == "delete" and row is None:
            # Reconcile the durable local registry after a state-file restore. Never
            # report deletion merely because an in-memory/state mapping is missing.
            matches = [
                item
                for item in self.service.database.list_outgoing_letters()
                if json.loads(item.get("dry_run_json") or "{}").get("workspace_letter_id")
                == job["letterId"]
            ]
            if len(matches) > 1:
                raise WorkspaceError("Найдены дубли локального письма. Нужна сверка референта.")
            if matches:
                row = matches[0]
                local_id = row["id"]
            elif not self.state.get("deleted-local:" + job["letterId"]):
                raise WorkspaceError(
                    "Локальная запись не найдена. Удаление требует сверки референта."
                )
        if job["kind"] == "record_sent":
            if row is None:
                raise WorkspaceError("Локальный журнал письма отсутствует. Нужна ручная сверка.")
            if row["status"] not in {"exat_sent", "webmail_sent"}:
                # Explicit human attestation; do not click Send or reuse the number.
                self.service.database.update_outgoing_letter(
                    local_id,
                    status="webmail_sent" if row["destination_route"] == "webmail" else "exat_sent",
                    review_status="approved",
                    sent_at=datetime.now(UTC).isoformat(),
                )
                self.service.database.write_outgoing_event(
                    local_id,
                    "workspace_manual_sent",
                    "Workspace operator confirmed manual delivery.",
                )
                self.service._clear_manual_send_hold(local_id)
                self.service._rewrite_journal()
            return self.receipt(
                job, "sent", "Ручная отправка подтверждена референтом; робот не нажимал Отправить."
            )
        if row is not None:
            if row["status"] in {"exat_sent", "webmail_sent"}:
                raise WorkspaceError(
                    "Локальный журнал уже содержит отправку. Отмена заблокирована."
                )
            close_prepared(self.service, row, self.prepared_handles.get(local_id))
            if job["kind"] == "delete":
                self.service.database.delete_outgoing_letter(local_id)
                self.state.put("deleted-local:" + job["letterId"], {"localId": local_id})
                self.service._clear_manual_send_hold(local_id)
                self.service._rewrite_journal()
                self.state.remove("letter:" + job["letterId"])
                return self.receipt(
                    job, "deleted", "Локальная запись удалена. Номер повторно не используется."
                )
            self.service.database.update_outgoing_letter(
                local_id,
                status="cancelled" if job["kind"] == "cancel" else "operator_revision",
                review_status="cancelled" if job["kind"] == "cancel" else "operator_revision",
            )
            self.service._rewrite_journal()
        return self.receipt(
            job,
            "deleted"
            if job["kind"] == "delete"
            else "cancelled"
            if job["kind"] == "cancel"
            else "revision_needed",
            "Подготовленное окно закрыто. Запись исключена из очереди отправки.",
        )
