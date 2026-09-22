"""Synchronize the referent robot's incoming SQLite registry with Workspace.

This bridge is intentionally read-only toward the robot database. Run it on the
referent workstation after configuring the Workspace API URL and agent token.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import ssl
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

DEFAULT_DB_PATH = Path(r"C:\EXAT_ROBOT_MALUMOTLAR\holat\robot_state.sqlite")
DEFAULT_JOURNAL_PATH = Path(
    r"C:\EXAT_ROBOT_MALUMOTLAR\jurnallar\kiruvchi_xatlar\register.xlsx"
)


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync AI Referent incoming correspondence")
    parser.add_argument(
        "--api-url",
        default=os.environ.get("YUKSALISH_API_BASE_URL", ""),
        help="Workspace API root, for example https://workspace.example/api/v1",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("YUKSALISH_AI_REFERENT_AGENT_TOKEN", ""),
        help="Agent token. Prefer the environment variable over this argument.",
    )
    parser.add_argument(
        "--agent-id",
        default=os.environ.get("YUKSALISH_AI_REFERENT_AGENT_ID", "referent-pc"),
    )
    parser.add_argument(
        "--agent-name",
        default=os.environ.get("YUKSALISH_AI_REFERENT_AGENT_NAME", "ПК референта"),
    )
    parser.add_argument("--database", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--journal", type=Path, default=DEFAULT_JOURNAL_PATH)
    parser.add_argument("--ca-file", type=Path, default=None)
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--interval", type=int, default=60)
    return parser.parse_args()


def _text(value: Any) -> str:
    return str(value or "").strip()


def _timestamp(value: Any) -> str | None:
    text = _text(value)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise RuntimeError(f"Robot contains an invalid timestamp: {text}") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo("Asia/Tashkent"))
    return parsed.isoformat()


def _letter(row: sqlite3.Row) -> dict[str, Any]:
    sequence = int(row["sequence_number"])
    message_key = _text(row["exat_message_key"])
    content_hash = _text(row["content_hash"])
    return {
        "externalId": f"sha256:{content_hash}" if content_hash else f"sequence:{sequence}",
        "sequenceNumber": str(sequence).zfill(6),
        "platformIncomingNumber": _text(row["platform_incoming_number"]),
        "senderLetterNumber": _text(row["sender_letter_number"]),
        "platformIncomingDate": None,
        "platformOutgoingDate": None,
        "receivedAt": _timestamp(row["received_at"]),
        "processedAt": _timestamp(row["processed_at"]),
        "registeredAt": _timestamp(row["registered_at"]),
        "senderOrganization": _text(row["sender_organization"]),
        "senderPerson": _text(row["sender"]),
        "subject": _text(row["subject"]),
        "responsibleExternalId": _text(row["responsible_employee_id"]),
        "responsibleDisplayName": _text(row["responsible_display_name"]),
        "urgency": _text(row["urgency"]) or "normal",
        "hasAttachments": bool(row["has_attachments"]),
        "attachmentsCount": int(row["attachments_count"] or 0),
        "mainDocumentFilename": Path(_text(row["main_document_path"])).name,
        "platformRecordId": _text(row["platform_record_id"]),
        "status": _text(row["status"]) or "unknown",
        "fallbackUsed": False,
        "errorMessage": _text(row["error_message"]),
        "source": "webmail" if message_key.startswith("webmail:") else "exat",
    }


def _read_letters(database: Path) -> list[dict[str, Any]]:
    if not database.is_file():
        raise RuntimeError(f"Robot database was not found: {database}")
    uri = f"file:{database.resolve().as_posix()}?mode=ro"
    with sqlite3.connect(uri, uri=True, timeout=5) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT * FROM processed_emails ORDER BY sequence_number"
        ).fetchall()
    return [_letter(row) for row in rows]


def _context(ca_file: Path | None) -> ssl.SSLContext:
    if ca_file is not None:
        return ssl.create_default_context(cafile=str(ca_file))
    return ssl.create_default_context()


def _request(
    url: str,
    token: str,
    *,
    method: str,
    body: bytes,
    content_type: str,
    context: ssl.SSLContext,
) -> bytes:
    request = Request(
        url,
        method=method,
        data=body,
        headers={
            "Content-Type": content_type,
            "X-AI-Referent-Agent-Token": token,
            "User-Agent": "Yuksalish-AI-Referent-Bridge/1",
        },
    )
    try:
        with urlopen(request, timeout=30, context=context) as response:
            return bytes(response.read())
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:1000]
        raise RuntimeError(f"Workspace returned HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"Workspace is unavailable: {error.reason}") from error


def _sync_once(
    args: argparse.Namespace,
    last_journal_signature: tuple[int, int] | None,
) -> tuple[int, int] | None:
    api_url = args.api_url.rstrip("/")
    if not api_url or not args.token:
        raise RuntimeError("Set YUKSALISH_API_BASE_URL and YUKSALISH_AI_REFERENT_AGENT_TOKEN")
    context = _context(args.ca_file)
    letters = _read_letters(args.database)
    totals = {"createdCount": 0, "updatedCount": 0, "unchangedCount": 0}
    for offset in range(0, len(letters) or 1, 500):
        batch = letters[offset : offset + 500]
        payload = json.dumps(
            {"agentId": args.agent_id, "agentName": args.agent_name, "letters": batch},
            ensure_ascii=False,
        ).encode("utf-8")
        raw = _request(
            f"{api_url}/ai-referent/agent/incoming:sync",
            args.token,
            method="POST",
            body=payload,
            content_type="application/json; charset=utf-8",
            context=context,
        )
        result = json.loads(raw or b"{}")
        for key in totals:
            totals[key] += int(result.get(key, 0))

    next_signature = last_journal_signature
    if args.journal.is_file():
        stat = args.journal.stat()
        next_signature = (stat.st_mtime_ns, stat.st_size)
        if next_signature != last_journal_signature:
            query = urlencode(
                {
                    "agentId": args.agent_id,
                    "agentName": args.agent_name,
                    "fileName": args.journal.name,
                    "updatedAt": datetime.fromtimestamp(
                        stat.st_mtime,
                        tz=ZoneInfo("Asia/Tashkent"),
                    ).isoformat(),
                }
            )
            _request(
                f"{api_url}/ai-referent/agent/journal?{query}",
                args.token,
                method="PUT",
                body=args.journal.read_bytes(),
                content_type=(
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                ),
                context=context,
            )
    print(
        "AI Referent sync: "
        f"{len(letters)} rows; {totals['createdCount']} created, "
        f"{totals['updatedCount']} updated, {totals['unchangedCount']} unchanged",
        flush=True,
    )
    return next_signature


def main() -> int:
    args = _arguments()
    if args.interval < 15:
        print("--interval must be at least 15 seconds", file=sys.stderr)
        return 2
    signature: tuple[int, int] | None = None
    while True:
        try:
            signature = _sync_once(args, signature)
        except RuntimeError as error:
            print(f"AI Referent sync failed: {error}", file=sys.stderr, flush=True)
            if not args.watch:
                return 1
        if not args.watch:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
