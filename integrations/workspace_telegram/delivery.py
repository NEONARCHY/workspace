"""Send-only companion for the existing Hisobot bot; never calls getUpdates.

Default preview mode cannot contact Telegram. The durable journal fences sends
across a lost acknowledgment or process restart. It contains private receipts;
keep it on the bot PC, outside Git and shared folders.
"""

import argparse
import asyncio
import json
import logging
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx


class Journal:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS deliveries "
            "(id TEXT PRIMARY KEY, lease TEXT NOT NULL, phase TEXT NOT NULL, receipt TEXT)"
        )
        self.db.commit()

    def intent(self, identifier: str, lease: str) -> bool:
        row = self.db.execute("SELECT * FROM deliveries WHERE id=?", (identifier,)).fetchone()
        if row is not None and not (
            row["phase"] in {"result", "acked"}
            and row["lease"] != lease
            and row["receipt"]
            and json.loads(row["receipt"])["outcome"] == "retry"
        ):
            return False
        self.db.execute(
            "INSERT OR REPLACE INTO deliveries VALUES (?,?,'intent',NULL)", (identifier, lease)
        )
        self.db.commit()
        return True

    def result(self, identifier: str, receipt: dict[str, Any]) -> None:
        self.db.execute(
            "UPDATE deliveries SET phase='result',receipt=? WHERE id=?",
            (json.dumps(receipt), identifier),
        )
        self.db.commit()

    def close(self) -> None:
        self.db.close()


class Sender:
    def __init__(
        self,
        bridge: httpx.AsyncClient,
        telegram: httpx.AsyncClient,
        journal: Journal,
        *,
        live: bool = False,
        bot_token: str = "",
    ) -> None:
        self.bridge, self.telegram, self.journal = bridge, telegram, journal
        self.live, self.bot_token = live, bot_token

    async def flush_receipts(self) -> None:
        for row in self.journal.db.execute(
            "SELECT * FROM deliveries WHERE phase!='acked'"
        ).fetchall():
            if row["phase"] == "intent":
                self.journal.result(row["id"], {"leaseToken": row["lease"], "outcome": "unknown"})
            receipt = self.journal.db.execute(
                "SELECT receipt FROM deliveries WHERE id=?", (row["id"],)
            ).fetchone()[0]
            try:
                response = await self.bridge.post(f"{row['id']}/ack", json=json.loads(receipt))
            except httpx.HTTPError:
                continue
            if response.status_code == 204:
                self.journal.db.execute(
                    "UPDATE deliveries SET phase='acked' WHERE id=?", (row["id"],)
                )
                self.journal.db.commit()

    async def send(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.live or not payload["sendAllowed"] or not self.bot_token:
            return {"outcome": "unknown"}
        if datetime.fromisoformat(payload["expiresAt"].replace("Z", "+00:00")) <= datetime.now(UTC):
            return {"outcome": "retry", "retryAfter": 30}
        try:
            response = await self.telegram.post(
                f"https://api.telegram.org/bot{self.bot_token}/sendMessage",
                json={
                    "chat_id": payload["telegramId"],
                    "text": payload["text"],
                    "link_preview_options": {"is_disabled": True},
                    "reply_markup": {
                        "inline_keyboard": [
                            [{"text": payload["buttonText"], "url": payload["url"]}]
                        ]
                    },
                },
            )
            result = response.json()
        except (httpx.HTTPError, ValueError):
            return {"outcome": "unknown"}
        if not isinstance(result, dict):
            return {"outcome": "unknown"}
        if result.get("ok") is True:
            details = result.get("result")
            message_id = details.get("message_id") if isinstance(details, dict) else None
            if type(message_id) is int and message_id > 0:
                return {"outcome": "sent", "telegramMessageId": message_id}
            return {"outcome": "unknown"}
        if result.get("ok") is False:
            code = result.get("error_code", response.status_code)
            if code == 429 or (isinstance(code, int) and code >= 500):
                parameters = result.get("parameters")
                delay = parameters.get("retry_after", 30) if isinstance(parameters, dict) else 30
                if type(delay) is not int:
                    delay = 30
                return {"outcome": "retry", "retryAfter": min(3600, max(1, int(delay)))}
            return {"outcome": "blocked" if code == 403 else "failed"}
        return {"outcome": "unknown"}

    async def run_once(self) -> list[dict[str, Any]]:
        await self.flush_receipts()
        response = await self.bridge.post(
            "claim", json={"mode": "live" if self.live else "preview"}
        )
        if response.status_code != 200:
            raise RuntimeError("Notification bridge is unavailable or has another mode")
        previews: list[dict[str, Any]] = []
        for lease in response.json():
            identifier, token = lease["id"], lease["leaseToken"]
            prepared = await self.bridge.post(f"{identifier}/prepare", json={"leaseToken": token})
            if prepared.status_code != 200 or prepared.json() is None:
                continue
            payload = prepared.json()
            if not self.journal.intent(identifier, token):
                continue
            if not self.live and not payload["sendAllowed"]:
                previews.append(payload)
                outcome: dict[str, Any] = {"outcome": "preview"}
            else:
                outcome = await self.send(payload)
                await asyncio.sleep(1.05)
            self.journal.result(identifier, {"leaseToken": token, **outcome})
            await self.flush_receipts()
        return previews


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Explicitly allow real Telegram sends")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--test-local", action="store_true")
    parser.add_argument("--journal", type=Path, default=Path("var/workspace-telegram.sqlite3"))
    args = parser.parse_args()
    base = os.environ.get("WORKSPACE_NOTIFICATION_API_URL", "").rstrip("/")
    parsed = urlsplit(base)
    local = (
        args.test_local and not args.live and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    )
    if parsed.scheme != "https" and not (local and parsed.scheme == "http"):
        raise RuntimeError("Use Workspace HTTPS; local HTTP is restricted to test preview")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise RuntimeError("Use a plain Workspace origin without credentials")
    token = os.environ.get("WORKSPACE_NOTIFICATION_BRIDGE_TOKEN", "")
    bot_token = os.environ.get("WORKSPACE_TELEGRAM_BOT_TOKEN", "")
    if len(token) < 32 or (args.live and not bot_token):
        raise RuntimeError("Configure the delivery-only bridge credential and live bot credential")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    journal = Journal(args.journal)
    verify: bool | str = os.environ.get("WORKSPACE_NOTIFICATION_CA_FILE") or True
    try:
        async with (
            httpx.AsyncClient(
                base_url=base + "/api/v1/telegram-notifications/bridge/",
                headers={"Authorization": "Bearer " + token},
                verify=verify,
                timeout=20,
            ) as bridge_client,
            httpx.AsyncClient(timeout=20) as telegram_client,
        ):
            sender = Sender(
                bridge_client, telegram_client, journal, live=args.live, bot_token=bot_token
            )
            while True:
                previews = await sender.run_once()
                print(json.dumps({"previewed": len(previews)}, ensure_ascii=False), flush=True)
                if args.once:
                    break
                await asyncio.sleep(5)
    finally:
        journal.close()


if __name__ == "__main__":
    asyncio.run(main())
