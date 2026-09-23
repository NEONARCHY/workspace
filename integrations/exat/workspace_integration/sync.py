"""Read-only archive export; existing folders and SQLite records stay on the referent PC."""

from __future__ import annotations

import hashlib
import json
import mimetypes
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from uuid import NAMESPACE_URL, uuid5
from zipfile import BadZipFile, ZipFile
from zoneinfo import ZoneInfo

from .client import WorkspaceClient, WorkspaceError
from .state import State


def timestamp(value: Any) -> str | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return (
        parsed if parsed.tzinfo else parsed.replace(tzinfo=ZoneInfo("Asia/Tashkent"))
    ).isoformat()


def incoming_payload(row: dict[str, Any]) -> dict[str, Any]:
    sequence = int(row["sequence_number"])
    result = {
        "externalId": f"sha256:{row['content_hash']}"
        if row.get("content_hash")
        else f"sequence:{sequence}",
        "sequenceNumber": str(sequence).zfill(6),
        "status": str(row.get("status") or "unknown"),
        "source": "webmail"
        if str(row.get("exat_message_key") or "").startswith("webmail:")
        else "exat",
        "hasAttachments": bool(row.get("has_attachments")),
        "attachmentsCount": int(row.get("attachments_count") or 0),
        "mainDocumentFilename": Path(str(row.get("main_document_path") or "")).name,
        "urgency": str(row.get("urgency") or "normal"),
    }
    for api, local in {
        "platformIncomingNumber": "platform_incoming_number",
        "senderLetterNumber": "sender_letter_number",
        "senderOrganization": "sender_organization",
        "senderPerson": "sender",
        "subject": "subject",
        "responsibleExternalId": "responsible_employee_id",
        "responsibleDisplayName": "responsible_display_name",
        "platformRecordId": "platform_record_id",
        "errorMessage": "error_message",
    }.items():
        result[api] = str(row.get(local) or "")
    for api, local in {
        "receivedAt": "received_at",
        "processedAt": "processed_at",
        "registeredAt": "registered_at",
    }.items():
        result[api] = timestamp(row.get(local))
    return result


class ArchiveSync:
    def __init__(self, service: Any, client: WorkspaceClient, state: State):
        self.service, self.client, self.state = service, client, state

    def upload(self, kind: str, owner: str, path: Path, name: str, **extra: str) -> None:
        if not path.is_file():
            raise WorkspaceError("Файл пакета отсутствует на ПК референта; восстановите архив.")
        if path.stat().st_size > 50 * 1024 * 1024:
            raise WorkspaceError(
                "Файл пакета превышает 50 МБ. Нужна отдельная загрузка большого файла."
            )
        before = path.stat()
        content = path.read_bytes()
        after = path.stat()
        if (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
            raise WorkspaceError("Файл обновляется роботом. Синхронизация повторится позже.")
        if path.suffix.lower() == ".xlsx":
            try:
                with ZipFile(BytesIO(content)) as workbook:
                    if workbook.testzip() is not None:
                        raise BadZipFile("Invalid workbook CRC")
            except BadZipFile as error:
                raise WorkspaceError("Журнал ещё записывается или повреждён.") from error
        digest = hashlib.sha256(content).hexdigest()
        key = f"file:{kind}:{owner}:{name}"
        if self.state.get(key) == digest:
            return
        query = urlencode({"agentId": self.client.agent_id, "name": name, **extra})
        self.client.transfer(
            f"/ai-referent/agent/files/{kind}/{owner}?{query}",
            content,
            method="PUT",
            content_type=mimetypes.guess_type(name)[0] or "application/octet-stream",
        )
        self.state.put(key, digest)

    def folder(self, kind: str, owner: str, folder: Path, roots: list[Path]) -> None:
        resolved = folder.resolve()
        if not any(
            resolved.is_relative_to(root.resolve()) and resolved != root.resolve() for root in roots
        ):
            raise WorkspaceError(
                "Каталог письма находится вне настроенного архива. Проверьте пути робота."
            )
        if not resolved.is_dir():
            raise WorkspaceError(
                "Каталог письма отсутствует. Архив не удаляется при синхронизации."
            )
        for path in sorted(resolved.rglob("*")):
            if not path.is_file():
                continue
            if not path.resolve().is_relative_to(resolved):
                raise WorkspaceError("Ссылка внутри архива выходит за каталог письма.")
            self.upload(kind, owner, path, path.relative_to(resolved).as_posix())

    def run(self) -> None:
        service = self.service
        for raw in service.database.list_outgoing_letters():
            row = dict(raw)
            extra = json.loads(row.get("dry_run_json") or "{}")
            if extra.get("workspace_letter_id"):
                # Shared letters already have canonical packets, not duplicate archive rows.
                continue
            payload = {
                "externalId": str(row["id"]),
                "displayNumber": f"{row['outgoing_number']}/{row['year_suffix']}-AI",
                "outgoingNumber": int(row["outgoing_number"]),
                "yearSuffix": str(row["year_suffix"]),
                "subject": str(row["subject"] or ""),
                "senderName": str(row["sender_name"] or ""),
                "recipientOrganization": str(row["destination_organization"] or ""),
                "route": str(row["destination_route"] or ""),
                "status": str(row["status"] or ""),
                "sentAt": timestamp(row.get("sent_at")),
            }
            result = self.client.request(
                "/ai-referent/agent/archive?" + urlencode({"agentId": self.client.agent_id}),
                payload,
                method="PUT",
            )
            primary = row.get("signed_file_path") or row.get("draft_file_path")
            if primary:
                self.folder("archive", result["id"], Path(primary).parent, [service.archive_root])
        with service.database.connect() as connection:
            rows = [
                dict(row)
                for row in connection.execute(
                    "SELECT * FROM processed_emails ORDER BY sequence_number"
                ).fetchall()
            ]
        for start in range(0, len(rows) or 1, 500):
            self.client.request(
                "/ai-referent/agent/incoming:sync",
                {
                    "agentId": self.client.agent_id,
                    "agentName": "ПК референта · Exat",
                    "letters": [incoming_payload(row) for row in rows[start : start + 500]],
                },
                method="POST",
            )
        paths = service.settings.get("paths", {})
        webmail = service.settings.get("webmail", {})
        roots = [
            Path(value)
            for value in (paths.get("archive_root"), webmail.get("archive_root"))
            if value
        ]
        for row in rows:
            if not row.get("archive_folder"):
                continue
            payload = incoming_payload(row)
            owner = self.client.request(
                "/ai-referent/agent/incoming/lookup?"
                + urlencode(
                    {
                        "agentId": self.client.agent_id,
                        "externalId": payload["externalId"],
                    }
                )
            )["id"]
            self.folder("incoming", owner, Path(row["archive_folder"]), roots)
        self.journals()

    def journals(self) -> None:
        from src.app.log_paths import incoming_logs_root

        owner = str(uuid5(NAMESPACE_URL, f"ai-journal:{self.client.agent_id}"))
        incoming = incoming_logs_root(self.service.settings) / "register.xlsx"
        for name, path in (
            ("incoming/register.xlsx", incoming),
            ("outgoing/outgoing_register.xlsx", self.service.journal.xlsx_path),
        ):
            if path.is_file():
                self.upload("journal", owner, path, name)
        # Preserve compatibility with the incoming table's existing Excel download action.
        if incoming.is_file():
            content = incoming.read_bytes()
            digest = hashlib.sha256(content).hexdigest()
            if self.state.get("latest-incoming-journal") != digest:
                query = urlencode({"agentId": self.client.agent_id, "fileName": "register.xlsx"})
                self.client.transfer(
                    "/ai-referent/agent/journal?" + query,
                    content,
                    method="PUT",
                    content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
                self.state.put("latest-incoming-journal", digest)

    def assert_no_legacy_pending(self) -> None:
        terminal = {
            "sent",
            "exat_sent",
            "webmail_sent",
            "edo_sent",
            "rejected",
            "cancelled",
            "deleted",
            "cancelled_by_sender",
            "rejected_by_referent",
        }
        for raw in self.service.database.list_outgoing_review_requests():
            row = dict(raw)
            if row.get("outgoing_id"):
                outgoing = self.service.database.get_outgoing_letter(row["outgoing_id"])
                if outgoing is not None and str(outgoing["status"]) in terminal:
                    continue
            if str(raw["status"]) not in terminal:
                raise WorkspaceError(
                    "Есть незавершённые старые согласования. "
                    "Завершите их в прежнем боте перед включением общего режима."
                )
        for raw in self.service.database.list_outgoing_letters():
            row = dict(raw)
            if json.loads(row.get("dry_run_json") or "{}").get("workspace_letter_id"):
                continue
            if str(row["status"]) not in terminal:
                raise WorkspaceError(
                    "Есть незавершённая старая отправка. "
                    "Сначала проверьте её в Exat, чтобы исключить дубль."
                )
