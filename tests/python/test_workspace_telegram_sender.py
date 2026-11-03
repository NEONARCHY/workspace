import asyncio
import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from integrations.workspace_telegram.delivery import Journal, Sender


@pytest.mark.parametrize("mode", ["preview", "ack_lost", "send_unknown"])
def test_sender_never_replays_a_possible_send_and_preview_never_contacts_telegram(tmp_path, mode):
    async def run():
        state = {"phase": "pending", "telegram": 0, "acks": 0}
        identifier = "00000000-0000-4000-8000-000000000001"
        lease = "00000000-0000-4000-8000-000000000002"

        def bridge(request):
            if request.url.path.endswith("/claim"):
                rows = (
                    [{"id": identifier, "leaseToken": lease}] if state["phase"] == "pending" else []
                )
                state["phase"] = "claimed" if rows else state["phase"]
                return httpx.Response(200, json=rows)
            if request.url.path.endswith("/prepare"):
                state["phase"] = "sending"
                return httpx.Response(
                    200,
                    json={
                        "id": identifier,
                        "telegramId": "900000001",
                        "text": "Synthetic task body",
                        "buttonText": "Открыть в Workspace",
                        "url": "https://test.invalid/?workspaceNotice=" + identifier,
                        "sendAllowed": mode != "preview",
                        "expiresAt": (datetime.now(UTC) + timedelta(minutes=1)).isoformat(),
                    },
                )
            state["acks"] += 1
            receipt = json.loads(request.content)
            if mode == "ack_lost" and state["acks"] == 1:
                raise httpx.ReadTimeout("Synthetic lost acknowledgment", request=request)
            state["phase"] = receipt["outcome"]
            return httpx.Response(204)

        def telegram(request):
            state["telegram"] += 1
            content = json.loads(request.content)
            assert content["chat_id"] == "900000001"
            assert content["reply_markup"]["inline_keyboard"][0][0]["url"].endswith(identifier)
            if mode == "send_unknown":
                raise httpx.ReadTimeout("Synthetic ambiguous send", request=request)
            return httpx.Response(200, json={"ok": True, "result": {"message_id": 55}})

        journal = Journal(tmp_path / "receipts.sqlite3")
        try:
            async with (
                httpx.AsyncClient(
                    base_url="https://test.invalid/bridge/", transport=httpx.MockTransport(bridge)
                ) as api,
                httpx.AsyncClient(transport=httpx.MockTransport(telegram)) as tg,
            ):
                sender = Sender(
                    api, tg, journal, live=mode != "preview", bot_token="synthetic-token"
                )
                previews = await sender.run_once()
                await sender.run_once()
                assert state["telegram"] == (0 if mode == "preview" else 1)
                assert len(previews) == (1 if mode == "preview" else 0)
                assert (
                    state["phase"]
                    == {"preview": "preview", "ack_lost": "sent", "send_unknown": "unknown"}[mode]
                )
        finally:
            journal.close()

    asyncio.run(run())


def test_crashed_send_intent_becomes_unknown_without_a_second_network_send(tmp_path):
    async def run():
        journal = Journal(tmp_path / "intent.sqlite3")
        journal.intent("notice", "lease")
        requests = []

        def bridge(request):
            requests.append(request)
            return (
                httpx.Response(204)
                if request.url.path.endswith("/ack")
                else httpx.Response(200, json=[])
            )

        def forbidden(request):
            raise AssertionError("A recovered send intent must never contact Telegram")

        try:
            async with (
                httpx.AsyncClient(
                    base_url="https://test.invalid/", transport=httpx.MockTransport(bridge)
                ) as api,
                httpx.AsyncClient(transport=httpx.MockTransport(forbidden)) as tg,
            ):
                await Sender(api, tg, journal, live=True, bot_token="synthetic").run_once()
                assert json.loads(requests[0].content)["outcome"] == "unknown"
        finally:
            journal.close()

    asyncio.run(run())


@pytest.mark.parametrize(
    "reply,expected",
    [
        ({"ok": False, "error_code": 429, "parameters": {"retry_after": 5}}, "retry"),
        ({"ok": False, "error_code": 403}, "blocked"),
        ({"ok": False, "error_code": 400}, "failed"),
        ({"ok": True, "result": None}, "unknown"),
        ({"ok": True, "result": {"message_id": True}}, "unknown"),
        ({"ok": False, "error_code": 500, "parameters": {"retry_after": "bad"}}, "retry"),
    ],
)
def test_telegram_responses_are_classified_without_ambiguous_replay(tmp_path, reply, expected):
    async def run():
        journal = Journal(tmp_path / "classified.sqlite3")
        try:
            async with (
                httpx.AsyncClient() as api,
                httpx.AsyncClient(
                    transport=httpx.MockTransport(lambda request: httpx.Response(200, json=reply))
                ) as tg,
            ):
                sender = Sender(api, tg, journal, live=True, bot_token="synthetic")
                result = await sender.send(
                    {
                        "sendAllowed": True,
                        "telegramId": "900000001",
                        "expiresAt": (datetime.now(UTC) + timedelta(minutes=1)).isoformat(),
                        "text": "Synthetic",
                        "buttonText": "Open",
                        "url": "https://test.invalid",
                    }
                )
                assert result["outcome"] == expected
        finally:
            journal.close()

    asyncio.run(run())


def test_definite_rejection_can_retry_a_new_lease_even_after_lost_ack(tmp_path):
    journal = Journal(tmp_path / "retry.sqlite3")
    try:
        assert journal.intent("notice", "lease1")
        journal.result("notice", {"leaseToken": "lease1", "outcome": "retry", "retryAfter": 1})
        assert not journal.intent("notice", "lease1")
        assert journal.intent("notice", "lease2")
        journal.result(
            "notice", {"leaseToken": "lease2", "outcome": "sent", "telegramMessageId": 42}
        )
        assert not journal.intent("notice", "lease3")
    finally:
        journal.close()
