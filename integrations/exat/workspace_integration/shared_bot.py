# ruff: noqa: RUF001
"""Telegram is a client of the shared API, never a second decision database (Russian UI)."""

from __future__ import annotations

import mimetypes
import tempfile
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from uuid import NAMESPACE_URL, UUID, uuid5

from .client import WorkspaceClient, WorkspaceError, connection_path, connection_settings
from .state import State, single_instance
from .worker import DeliveryWorker

ACTIONS = {
    "s": ("submit", "На согласование"),
    "a": ("approve", "Согласовать"),
    "r": ("return_for_revision", "Вернуть с комментарием"),
    "c": ("cancel", "Отменить письмо"),
    "p": ("queue_delivery", "Подготовить PDF"),
    "t": ("retry_delivery", "Повторить подготовку"),
    "l": ("release_delivery", "Разрешить отправку"),
    "d": ("send", "Отправить референтом"),
    "y": ("confirm_sent", "Подтвердить: доставлено"),
    "n": ("confirm_not_sent", "Подтвердить: не доставлено"),
}
STATUSES = {
    "draft": "Черновик",
    "pending_review": "На согласовании",
    "needs_revision": "На доработке",
    "approved": "Согласовано",
    "queued": "В очереди робота",
    "sending": "Робот выполняет задание",
    "awaiting_final_send": "Подписанный PDF ожидает финального решения",
    "referent_review_pending": "Готово к отправке референтом",
    "delivery_unknown": "Результат доставки требует проверки",
    "sent": "Отправлено",
    "failed": "Ошибка подготовки",
    "cancelled": "Отменено",
}


def enabled() -> bool:
    return connection_settings().get("shared_workflow", "false").lower() == "true"


def button(text: str, data: str) -> dict[str, str]:
    return {"text": text, "callback_data": data}


class SharedBot:
    def __init__(self, telegram: Any, api: WorkspaceClient, state: State):
        self.telegram, self.api, self.state = telegram, api, state

    def request(
        self, actor: str, path: str, payload: dict[str, Any] | None = None, method: str = "GET"
    ) -> dict[str, Any]:
        return self.api.request(
            "/ai-referent/agent" + path, payload, method=method, telegram_id=actor
        )

    def say(self, actor: str, text: str, rows: list[list[dict[str, str]]] | None = None) -> None:
        result = self.telegram.send_message(
            actor, text, reply_markup={"inline_keyboard": rows} if rows else None
        )
        if result.get("ok") is False:
            raise WorkspaceError("Telegram не подтвердил доставку сообщения.")

    def show(self, actor: str, letter_id: str) -> None:
        letter = self.request(actor, f"/letters/{UUID(letter_id)}")
        compact = UUID(letter["id"]).hex
        rows = [
            [button(label, f"a:{key}:{compact}:{letter['revision']}")]
            for key, (action, label) in ACTIONS.items()
            if action in letter["availableActions"]
        ]
        rows.append([button("Пакет документов", f"f:o:{compact}:0")])
        if letter["canEdit"]:
            rows.append([button("Заменить основной DOCX", f"e:{compact}")])
            rows.append([button("Добавить вложение", f"x:{compact}")])
        latest = next(
            (event["comment"] for event in letter.get("events", []) if event.get("comment")), ""
        )
        self.say(
            actor,
            f"{letter.get('displayNumber') or 'Без номера'} · {STATUSES[letter['status']]}\n"
            f"{letter['subject']}\nКому: {letter['recipientOrganization']}\n"
            f"Согласующий: {letter.get('reviewerName') or 'Не назначен'}"
            + (f"\nКомментарий: {latest}" if latest else "")
            + (f"\n{letter['deliveryError']}" if letter.get("deliveryError") else ""),
            rows,
        )

    def notifications(self) -> None:
        for item in self.api.request("/ai-referent/agent/notifications/claim", method="POST").get(
            "notifications", []
        ):
            delivered, error = False, ""
            try:
                self.say(
                    item["telegramId"],
                    item["text"],
                    [[button("Открыть актуальное письмо", "o:" + UUID(item["letterId"]).hex)]],
                )
                delivered = True
            except Exception as exc:
                error = type(
                    exc
                ).__name__  # Never put Telegram's token-containing URL in server logs.
            self.api.request(
                f"/ai-referent/agent/notifications/{item['id']}/ack",
                {
                    "leaseToken": item["leaseToken"],
                    "delivered": delivered,
                    "error": error,
                },
                method="POST",
            )

    def files(self, actor: str, kind: str, owner: str, offset: int = 0) -> None:
        packet = self.request(actor, f"/packets/{kind}/{UUID(owner)}")
        rows = []
        for item in packet["files"][offset : offset + 12]:
            reference = uuid5(NAMESPACE_URL, f"{actor}:{kind}:{owner}:{item['id']}").hex
            self.state.put(
                f"file-button:{actor}:{reference}",
                {"kind": kind, "owner": str(UUID(owner)), "file": item},
            )
            rows.append([button(item["name"].split("/")[-1][:45], f"g:{reference}")])
        if offset + 12 < len(packet["files"]):
            rows.append([button("Далее", f"f:{kind[0]}:{UUID(owner).hex}:{offset + 12}")])
        self.say(actor, "Пакет документов" if rows else "Файлы пока не синхронизированы.", rows)

    def handle(self, update: dict[str, Any]) -> None:
        callback = update.get("callback_query")
        message = update.get("message") or (callback or {}).get("message") or {}
        sender = (callback or message).get("from") or {}
        actor = str(sender.get("id") or "")
        chat = message.get("chat") or {}
        if chat.get("type") != "private" or str(chat.get("id")) != actor:
            return  # Never use a group ID or forward's author as the acting identity.
        operation = str(uuid5(NAMESPACE_URL, f"ai-telegram:{actor}:{update['update_id']}"))
        text = str(message.get("text") or "").strip()
        key = "conversation:" + actor
        context = self.state.get(key, {})
        try:
            if callback:
                self.telegram.answer_callback_query(callback["id"])
                data = str(callback.get("data") or "").split(":")
                if data[0] == "o":
                    self.show(actor, data[1])
                elif data[0] == "a":
                    action = ACTIONS[data[1]][0]
                    payload = {
                        "action": action,
                        "expectedRevision": int(data[3]),
                        "operationId": operation,
                    }
                    if action in {"return_for_revision", "confirm_sent", "confirm_not_sent"}:
                        self.state.put(
                            key,
                            {"step": "comment", "letterId": str(UUID(data[2])), "payload": payload},
                        )
                        self.say(
                            actor,
                            "Напишите комментарий или основание проверки (не менее 3 символов). "
                            "/cancel — отменить ввод.",
                        )
                    elif action in {"send", "cancel"}:
                        self.say(
                            actor,
                            "Подтвердите действие: " + ACTIONS[data[1]][1],
                            [[button("Подтвердить", f"v:{data[1]}:{data[2]}:{data[3]}")]],
                        )
                    else:
                        self.request(actor, f"/letters/{UUID(data[2])}/actions", payload, "POST")
                        self.show(actor, data[2])
                elif data[0] == "v" and data[1] in {"d", "c"}:
                    self.request(
                        actor,
                        f"/letters/{UUID(data[2])}/actions",
                        {
                            "action": ACTIONS[data[1]][0],
                            "expectedRevision": int(data[3]),
                            "operationId": operation,
                        },
                        "POST",
                    )
                    self.show(actor, data[2])
                elif data[0] in {"e", "x"}:
                    letter = self.request(actor, f"/letters/{UUID(data[1])}")
                    if not letter["canEdit"]:
                        raise WorkspaceError("На текущем этапе файлы менять нельзя.")
                    self.state.put(
                        key,
                        {
                            "step": "upload",
                            "letterId": letter["id"],
                            "role": "primary" if data[0] == "e" else "additional",
                        },
                    )
                    self.say(actor, "Отправьте документ. Основной файл должен быть DOCX.")
                elif data[0] == "f":
                    kind = {"o": "outgoing", "i": "incoming", "a": "archive", "j": "journal"}[
                        data[1]
                    ]
                    self.files(actor, kind, data[2], int(data[3]))
                elif data[0] == "g":
                    reference = self.state.get(f"file-button:{actor}:{data[1]}")
                    if not reference:
                        raise WorkspaceError("Откройте пакет документов заново.")
                    item = reference["file"]
                    base = f"/ai-referent/agent/packets/{reference['kind']}/{reference['owner']}"
                    content = self.api.transfer(
                        f"{base}/files/{item['id']}?source={item['source']}", telegram_id=actor
                    )
                    with tempfile.TemporaryDirectory(prefix="workspace-letter-") as directory:
                        path = Path(directory) / Path(item["name"]).name
                        path.write_bytes(content)
                        self.telegram.send_document(actor, path, caption="Документ из общей базы")
                elif data[0] in {"r", "z"} and context.get("step") in {"reviewer", "final"}:
                    reviewers = self.request(actor, "/reviewers")["reviewers"]
                    selected = next(
                        (
                            entry
                            for entry in reviewers
                            if entry["key"] == data[1] and entry["canApprove"]
                        ),
                        None,
                    )
                    if data[0] == "r" and selected:
                        context["reviewerUserId"] = selected["userId"]
                        context["step"] = "final"
                        self.state.put(key, context)
                        rows = [
                            [button(entry["fullName"], "z:" + entry["key"])]
                            for entry in reviewers
                            if entry["canApprove"] and entry["userId"] != selected["userId"]
                        ]
                        rows.append([button("Без второго согласующего", "z:none")])
                        self.say(actor, "Кто согласует после первого руководителя?", rows)
                    elif data[0] == "z" and (selected or data[1] == "none"):
                        context["finalReviewerUserId"] = selected["userId"] if selected else None
                        payload = {
                            field: context[field]
                            for field in (
                                "subject",
                                "recipientOrganization",
                                "recipientAddress",
                                "route",
                                "reviewerUserId",
                                "finalReviewerUserId",
                            )
                        }
                        payload.update(note="", operationId=context["createOperation"])
                        letter = self.request(actor, "/letters", payload, "POST")
                        self.state.put(
                            key, {"step": "upload", "role": "primary", "letterId": letter["id"]}
                        )
                        self.say(actor, "Черновик сохранён. Пришлите основной DOCX письма.")
                else:
                    self.say(
                        actor,
                        "Это кнопка прежнего режима. Откройте /history для актуального состояния.",
                    )
                return
            if text.startswith("/link "):
                self.api.request(
                    "/ai-referent/agent/telegram-link",
                    {"telegramId": actor, "code": text.split(maxsplit=1)[1]},
                    method="POST",
                )
                self.say(
                    actor,
                    "Telegram привязан к вашему аккаунту Workspace. "
                    "/new — письмо, /history — общая очередь.",
                )
                return
            if text in {"/start", "/help"}:
                self.say(
                    actor,
                    "AI Referent · общая база Workspace\n/new — новое письмо\n"
                    "/history — письма и согласования\n/archive — архив Exat\n"
                    "/cancel — отменить ввод\nДля привязки получите код в "
                    "Workspace → AI Referent → Мой Telegram и отправьте /link КОД.",
                )
                return
            # Any further data request is authenticated and authorized by the server.
            if text == "/cancel":
                self.state.remove(key)
                self.say(actor, "Ввод отменён. Сохранённые письма не удалены.")
            elif text.startswith("/history") or text.startswith("/archive"):
                archive = text.startswith("/archive")
                parts = text.split()
                page = max(0, int(parts[1]) - 1) if len(parts) > 1 else 0
                route = "/archive" if archive else "/letters"
                letters = self.request(actor, route + f"?offset={page * 12}&limit=12")["letters"]
                rows = [
                    [
                        button(
                            (letter.get("displayNumber") or "Черновик")
                            + " · "
                            + letter["subject"][:40],
                            f"f:a:{UUID(letter['id']).hex}:0"
                            if archive
                            else "o:" + UUID(letter["id"]).hex,
                        )
                    ]
                    for letter in letters
                ]
                self.say(
                    actor,
                    f"{'Архив' if archive else 'Общие письма'} · страница {page + 1}.\n"
                    f"Следующая: {'/archive' if archive else '/history'} {page + 2}",
                    rows,
                )
            elif text == "/new":
                self.request(actor, "/reviewers")
                self.state.put(key, {"step": "subject", "createOperation": operation})
                self.say(actor, "Укажите тему письма.")
            elif context.get("step") == "comment":
                if len(text) < 3:
                    raise WorkspaceError("Комментарий должен содержать не менее 3 символов.")
                payload = {**context["payload"], "comment": text, "operationId": operation}
                self.request(actor, f"/letters/{context['letterId']}/actions", payload, "POST")
                self.state.remove(key)
                self.show(actor, context["letterId"])
            elif context.get("step") == "upload" and message.get("document"):
                document = message["document"]
                name = Path(str(document.get("file_name") or "attachment.bin")).name
                if int(document.get("file_size") or 0) > 20 * 1024 * 1024:
                    raise WorkspaceError(
                        "Через Telegram доступны документы до 20 МБ; "
                        "больший файл загрузите в Workspace."
                    )
                if context["role"] == "primary" and Path(name).suffix.lower() != ".docx":
                    raise WorkspaceError(
                        "Основной документ должен быть DOCX для подготовки подписи."
                    )
                metadata = self.telegram.get_file(document["file_id"])
                with tempfile.TemporaryDirectory(prefix="workspace-upload-") as directory:
                    path = Path(directory) / "document"
                    self.telegram.download_file(metadata["result"]["file_path"], path)
                    if path.stat().st_size > 20 * 1024 * 1024:
                        raise WorkspaceError("Файл превышает лимит Telegram.")
                    query = urlencode({"fileName": name, "role": context["role"]})
                    self.api.transfer(
                        f"/ai-referent/agent/letters/{context['letterId']}/attachment?{query}",
                        path.read_bytes(),
                        method="PUT",
                        telegram_id=actor,
                        content_type=mimetypes.guess_type(name)[0] or "application/octet-stream",
                    )
                self.state.remove(key)
                self.show(actor, context["letterId"])
            elif context.get("step") in {"subject", "organization", "route"}:
                if not text or len(text) > 300:
                    raise WorkspaceError("Введите текст длиной от 1 до 300 символов.")
                if context["step"] == "subject":
                    context.update(subject=text, step="organization")
                    self.say(
                        actor,
                        "Укажите точное название получателя или адрес из адресной книги Exat.",
                    )
                elif context["step"] == "organization":
                    context.update(recipientOrganization=text, recipientAddress="", step="route")
                    self.say(actor, "Введите канал: exat или webmail.")
                else:
                    if text.lower() not in {"exat", "webmail"}:
                        raise WorkspaceError("Укажите exat или webmail.")
                    context.update(route=text.lower(), step="reviewer")
                    reviewers = self.request(actor, "/reviewers")["reviewers"]
                    self.say(
                        actor,
                        "Выберите первого согласующего.",
                        [
                            [button(entry["fullName"], "r:" + entry["key"])]
                            for entry in reviewers
                            if entry["canApprove"]
                        ],
                    )
                self.state.put(key, context)
            else:
                self.say(actor, "Откройте /history или начните письмо командой /new.")
        except (WorkspaceError, ValueError, KeyError, IndexError) as error:
            if isinstance(error, WorkspaceError) and error.status == 0:
                # Validation errors have no status too: expose only our sanitized message.
                self.say(actor, str(error))
            else:
                self.say(
                    actor,
                    str(error)
                    if isinstance(error, WorkspaceError)
                    else "Кнопка устарела или данные некорректны. Откройте /history.",
                )


def run_shared(
    bot: Any, *, max_updates: int | None = None, stop_after_idle_seconds: int | None = None
) -> Any:
    with single_instance(connection_path().parent / "shared-bot.lock"):
        return _run_shared(
            bot, max_updates=max_updates, stop_after_idle_seconds=stop_after_idle_seconds
        )


def _run_shared(
    bot: Any, *, max_updates: int | None = None, stop_after_idle_seconds: int | None = None
) -> Any:
    from src.outgoing.telegram_bot import PollingResult

    client = WorkspaceClient()
    state = State(connection_path().parent / "shared-state.sqlite")
    controller = SharedBot(bot.client, client, state)
    worker = DeliveryWorker(bot.service, client, state)
    worker.bootstrap()  # Fail closed; do not fall back to independent legacy mutations.
    done = threading.Event()

    def execute() -> None:
        last_sync = time.monotonic()
        while not done.is_set():
            try:
                worker.tick()
                if time.monotonic() - last_sync > 60:
                    worker.sync.run()
                    last_sync = time.monotonic()
            except Exception as error:
                bot._status_log("workspace_worker_error", error=type(error).__name__)
            done.wait(5)

    thread = threading.Thread(target=execute, name="workspace-executor", daemon=True)
    thread.start()
    seen, handled = 0, 0
    idle = time.monotonic()
    try:
        while max_updates is None or seen < max_updates:
            try:
                controller.notifications()
                response = bot.client.get_updates(offset=state.get("telegram-offset"))
                for update in response.get("result", []):
                    controller.handle(update)
                    state.put("telegram-offset", int(update["update_id"]) + 1)
                    seen += 1
                    handled += 1
                    idle = time.monotonic()
                    if max_updates is not None and seen >= max_updates:
                        break
            except Exception as error:
                bot._status_log("workspace_poll_error", error=type(error).__name__)
                done.wait(5)
            if (
                stop_after_idle_seconds is not None
                and time.monotonic() - idle >= stop_after_idle_seconds
            ):
                break
    finally:
        done.set()
        thread.join(timeout=45)
    return PollingResult("stopped", seen, handled, [])
