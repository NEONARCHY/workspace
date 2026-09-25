# ruff: noqa: RUF001
"""Telegram is a client of the shared API, never a second decision database (Russian UI)."""

from __future__ import annotations

import mimetypes
import re
import tempfile
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from uuid import NAMESPACE_URL, UUID, uuid5

from .client import WorkspaceClient, WorkspaceError, connection_path, connection_settings
from .state import State, single_instance
from .wizard import LetterWizard
from .worker import DeliveryWorker

ACTIONS = {
    "s": ("submit", "На согласование"),
    "a": ("approve", "Согласовать"),
    "r": ("return_for_revision", "Вернуть на доработку"),
    "c": ("cancel", "Отклонить отправку"),
    "p": ("queue_delivery", "Подготовить PDF"),
    "t": ("retry_delivery", "Повторить подготовку"),
    "l": ("release_delivery", "Отправить"),
    "d": ("send", "Отправить"),
    "y": ("confirm_sent", "Подтвердить: доставлено"),
    "n": ("confirm_not_sent", "Подтвердить: не доставлено"),
    "m": ("remind", "Напомнить согласующему"),
    "w": ("replace_document", "Заменить письмо"),
    "j": ("mark_sent", "Отправлено вручную"),
    "k": ("prepare_replacement", "Применить замену без согласования"),
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
    "signed": "Подписано · без отправки",
    "operator_revision": "Администратор заменяет файл",
}
CATEGORIES = {
    "": "Все",
    "ministries": "Министерства",
    "agencies": "Агентства",
    "committees": "Комитеты",
    "international": "Международные",
    "other": "Другие",
}
MENU = {
    "отправить письмо": "new",
    "xat yuborish": "new",
    "новое письмо": "new",
    "только подпись": "sign",
    "подписать без отправки": "sign",
    "история": "history",
    "tarix": "history",
    "архив": "archive",
    "arxiv": "archive",
    "отмена": "cancel",
    "bekor qilish": "cancel",
    "главное меню": "start",
    "согласование": "pending",
    "поиск": "history",
    "qidirish": "history",
    "открыть очередь": "pending",
    "navbatni ochish": "pending",
    "ошибки": "pending",
    "xatolar": "pending",
    "входящие на проверку": "legacy",
    "tekshiruvdagi kiruvchi": "legacy",
    "сменить язык": "legacy",
    "tilni almashtirish": "legacy",
}
EMAIL = re.compile(
    r"[A-Za-z0-9_][A-Za-z0-9._%+\-]*@[A-Za-z0-9][A-Za-z0-9.\-]*\.[A-Za-z]{2,}"
)


def menu_action(text: str) -> str | None:
    normalized = text.strip().casefold()
    for label, action in MENU.items():
        if normalized == label or normalized.endswith(" " + label):
            return action
    return None


def enabled() -> bool:
    return connection_settings().get("shared_workflow", "false").lower() == "true"


def button(text: str, data: str) -> dict[str, str]:
    return {"text": text, "callback_data": data}


class SharedBot:
    def __init__(self, telegram: Any, api: WorkspaceClient, state: State):
        self.telegram, self.api, self.state = telegram, api, state
        self.wizard = LetterWizard(self)

    def request(
        self, actor: str, path: str, payload: dict[str, Any] | None = None, method: str = "GET"
    ) -> dict[str, Any]:
        return self.api.request(
            "/ai-referent/agent" + path, payload, method=method, telegram_id=actor
        )

    def say(
        self, actor: str, text: str, rows: list[list[dict[str, str]]] | None = None
    ) -> int | None:
        menu = {
            "keyboard": [
                [{"text": "📤 Новое письмо"}, {"text": "✍️ Только подпись"}],
                [{"text": "📚 История"}, {"text": "🗂 Архив"}],
                [{"text": "📬 Согласование"}, {"text": "Главное меню"}],
            ],
            "resize_keyboard": True,
            "is_persistent": True,
        }
        result = self.telegram.send_message(
            actor, text, reply_markup={"inline_keyboard": rows} if rows else menu
        )
        if result.get("ok") is False:
            raise WorkspaceError("Telegram не подтвердил доставку сообщения.")
        return result.get("result", {}).get("message_id")

    def clear_system(self, actor: str, scope: str) -> None:
        key = f"system:{actor}:{scope}"
        record = self.state.get(key)
        if not record:
            return
        try:
            result = self.telegram.delete_message(actor, record["id"])
            if result.get("ok") is False:
                raise WorkspaceError("Telegram refused deletion")
        except Exception:
            # Telegram can forbid deletion of old messages. Remove controls instead;
            # server revision checks remain the authority even if this call also fails.
            try:
                result = self.telegram.edit_message_text(
                    actor,
                    record["id"],
                    "Этот этап завершён. Актуальное состояние — в «Согласование».",
                    reply_markup={"inline_keyboard": []},
                )
                if result.get("ok") is False:
                    return
            except Exception:
                return
        self.state.remove(key)

    def system(
        self,
        actor: str,
        scope: str,
        text: str,
        rows: list[list[dict[str, str]]] | None = None,
        *,
        letter_id: str | None = None,
        revision: int | None = None,
    ) -> None:
        message_id = self.say(actor, text, rows)
        self.clear_system(actor, scope)
        key = f"system:{actor}:{scope}"
        old = self.state.get(key)
        if old:
            self.state.put(f"system:{actor}:obsolete-{old['id']}", old)
        if message_id is not None:
            self.state.put(
                key, {"id": message_id, "actor": actor, "letterId": letter_id, "revision": revision}
            )

    def clean_obsolete_controls(self) -> None:
        for key, record in self.state.pending("system:"):
            actor = record["actor"]
            scope = key.split(":", 2)[2]
            if scope.startswith("obsolete-"):
                self.clear_system(actor, scope)
                continue
            if not record.get("letterId") or record.get("revision") is None:
                continue
            try:
                letter = self.request(actor, "/letters/" + record["letterId"])
                if letter["revision"] != record["revision"]:
                    self.clear_system(actor, scope)
            except WorkspaceError as error:
                if error.status in {403, 404}:
                    self.clear_system(actor, scope)

    def show(self, actor: str, letter_id: str) -> None:
        letter = self.request(actor, f"/letters/{UUID(letter_id)}")
        compact = UUID(letter["id"]).hex
        rows = [
            [button(label, f"a:{key}:{compact}:{letter['revision']}")]
            for key, (action, label) in ACTIONS.items()
            if action in letter["availableActions"]
        ]
        rows.append([button("Пакет документов", f"f:o:{compact}:0")])
        if letter.get("canDelete"):
            rows.append([button("Удалить письмо из базы", f"z:{compact}:{letter['revision']}")])
        if letter.get("canReplaceDocument"):
            rows.append([button("Загрузить новый DOCX или PDF", f"e:{compact}")])
        if letter["canEdit"]:
            rows.append([button("Продолжить письмо", f"w:resume:{compact}")])
            rows.append([button("Исправить письмо", f"w:edit:{compact}")])
            if letter.get("workflowKind") != "sign_only":
                rows.append([button("Добавить вложение", f"x:{compact}")])
        latest = next(
            (event["comment"] for event in letter.get("events", []) if event.get("comment")), ""
        )
        number = letter.get("displayNumber") or (
            "На подпись" if letter.get("workflowKind") == "sign_only" else "Без номера"
        )
        destination = (
            "Без отправки адресату\n" if letter.get("workflowKind") == "sign_only"
            else f"Кому: {letter['recipientOrganization']}\n"
        )
        self.system(
            actor,
            "letter-" + letter["id"],
            f"{number} · {STATUSES[letter['status']]}\n"
            f"{letter['subject'] or letter.get('displayNumber') or 'Тема — исходящий номер'}\n"
            f"{destination}"
            f"Согласующий: {letter.get('reviewerName') or 'Не назначен'}"
            + (f"\nКомментарий: {latest}" if latest else "")
            + (f"\nСлужебная заметка: {letter['note']}" if letter.get("note") else "")
            + (f"\n{letter['deliveryError']}" if letter.get("deliveryError") else ""),
            rows,
            letter_id=letter["id"],
            revision=letter["revision"],
        )

    def history(self, actor: str, kind: str, page: int) -> None:
        page = max(0, page)
        result = self.request(
            actor,
            f"/letters?offset={page * 10}&limit=10"
            + ("&activeOnly=true" if kind == "pending" else ""),
        )
        rows = [
            [
                button(
                    (letter.get("displayNumber") or STATUSES[letter["status"]])
                    + " · "
                    + (letter["subject"] or letter["recipientOrganization"] or "Новое письмо")[:45],
                    "o:" + UUID(letter["id"]).hex,
                )
            ]
            for letter in result["letters"]
        ]
        navigation = []
        if page:
            navigation.append(button("← Назад", f"list:{kind}:{page - 1}"))
        if len(result["letters"]) == 10:
            navigation.append(button("Далее →", f"list:{kind}:{page + 1}"))
        if navigation:
            rows.append(navigation)
        self.system(
            actor,
            "history",
            f"{'Согласование и черновики' if kind == 'pending' else 'История'} · "
            f"страница {page + 1}" + ("\nПисем пока нет." if not result["letters"] else ""),
            rows,
        )

    @staticmethod
    def current_documents(
        letter: dict[str, Any], files: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """History stays in the packet; decisions receive only the current document version."""
        roles = {item["id"]: item.get("documentRole") for item in letter.get("attachments", [])}
        final = letter["status"] in {"referent_review_pending", "awaiting_final_send", "sent"}
        selected = [
            entry
            for entry in files
            if entry["source"] == "attachment"
            and roles.get(entry["id"])
            in (
                set()
                if letter["status"] in {"awaiting_final_send", "sent"}
                else {"additional"}
                if final
                else {"primary", "additional"}
            )
        ]
        if final:
            signed = [
                entry
                for entry in files
                if entry["source"] == "packet"
                and entry["name"].startswith("signed/")
                and entry["name"].lower().endswith(".pdf")
                and (not letter.get("finalPdfFileId") or entry["id"] == letter["finalPdfFileId"])
            ]
            if signed:
                selected.insert(0, max(signed, key=lambda entry: entry["createdAt"]))
        return selected

    def deliver_comments(self, actor: str, letter: dict[str, Any]) -> None:
        for event in reversed(letter.get("events", [])):
            if event["eventType"] != "letter.return_for_revision":
                continue
            receipt = f"comment-delivered:{actor}:{event['id']}"
            if self.state.get(receipt):
                continue
            title = letter.get("displayNumber") or letter["subject"] or "без номера"
            caption = f"Комментарий к письму {title} · {event['actorName']}"
            audio = event.get("audio")
            if audio:
                content = self.api.transfer(
                    "/ai-referent/agent/comment-audio/" + audio["id"], telegram_id=actor
                )
                with tempfile.TemporaryDirectory(prefix="referent-voice-") as folder:
                    ogg = audio["contentType"] == "audio/ogg"
                    path = Path(folder) / ("Комментарий.ogg" if ogg else "Комментарий.webm")
                    path.write_bytes(content)
                    response = (
                        self.telegram._multipart_api(
                            "sendVoice", {"chat_id": actor, "caption": caption}, "voice", path
                        )
                        if ogg
                        else self.telegram.send_document(actor, path, caption=caption)
                    )
                    if response.get("ok") is False:
                        raise WorkspaceError("Telegram не принял голосовой комментарий.")
            if event.get("comment"):
                self.say(actor, caption + "\n" + event["comment"])
            self.state.put(receipt, True)

    def notifications(self) -> None:
        self.wizard.poll_checks()
        self.clean_obsolete_controls()
        for item in self.api.request("/ai-referent/agent/notifications/claim", method="POST").get(
            "notifications", []
        ):
            delivered, error = False, ""
            try:
                letter = self.api.request(
                    f"/ai-referent/agent/letters/{item['letterId']}",
                    telegram_id=item["telegramId"],
                )
                # Queued notifications may be older than the current decision. Show
                # current state; deliver substantive comments independently by event ID.
                text_receipt = f"notice-text:{item['id']}"
                if not self.state.get(text_receipt):
                    self.system(
                        item["telegramId"],
                        "notice-" + item["letterId"],
                        f"{letter.get('displayNumber') or letter['subject'] or 'Письмо'} · "
                        + STATUSES[letter["status"]],
                        [[button("Открыть актуальное письмо", "o:" + UUID(item["letterId"]).hex)]],
                        letter_id=letter["id"],
                        revision=letter["revision"],
                    )
                    self.state.put(text_receipt, True)
                self.deliver_comments(item["telegramId"], letter)
                action_receipt = f"notice-actions:{item['id']}"
                if not self.state.get(action_receipt):
                    if letter["status"] in {
                        "pending_review",
                        "needs_revision",
                        "referent_review_pending",
                        "awaiting_final_send",
                        "sent",
                    }:
                        packet = self.request(
                            item["telegramId"], f"/packets/outgoing/{item['letterId']}"
                        )
                        candidates = self.current_documents(letter, packet["files"])
                        for entry in candidates:
                            file_receipt = (
                                f"notice-file:{item['telegramId']}:{letter['id']}:"
                                f"{letter['status']}:{entry['id']}"
                            )
                            if self.state.get(file_receipt):
                                continue
                            if int(entry.get("byteSize", 0)) > 20 * 1024 * 1024:
                                continue
                            content = self.api.transfer(
                                f"/ai-referent/agent/packets/outgoing/{item['letterId']}/files/"
                                f"{entry['id']}?source={entry['source']}",
                                telegram_id=item["telegramId"],
                            )
                            if len(content) > 20 * 1024 * 1024:
                                continue
                            with tempfile.TemporaryDirectory(prefix="referent-review-") as folder:
                                name = Path(entry["name"]).name
                                if entry["source"] == "packet":
                                    title = (
                                        letter.get("displayNumber") or letter["subject"] or "letter"
                                    )
                                    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", title)[:100]
                                    name += ".pdf"
                                path = Path(folder) / name
                                path.write_bytes(content)
                                response = self.telegram.send_document(
                                    item["telegramId"], path, caption="Документ письма"
                                )
                                if response.get("ok") is False:
                                    raise WorkspaceError(
                                        "Telegram не подтвердил доставку документа."
                                    )
                            self.state.put(file_receipt, True)
                    self.show(item["telegramId"], item["letterId"])
                    self.state.put(action_receipt, True)
                if letter.get("workflowKind") == "sign_only" and letter["status"] == "signed":
                    packet = self.api.request(
                        f"/ai-referent/agent/packets/outgoing/{item['letterId']}",
                        telegram_id=item["telegramId"],
                    )
                    signed = sorted(
                        (entry for entry in packet["files"]
                         if entry["source"] == "packet"
                         and entry["name"].startswith("signed/")),
                        key=lambda entry: entry["name"],
                    )
                    for entry in signed:
                        receipt_key = f"signed-notice:{item['id']}:{entry['id']}"
                        if self.state.get(receipt_key):
                            continue
                        content = self.api.transfer(
                            f"/ai-referent/agent/packets/outgoing/{item['letterId']}/files/"
                            f"{entry['id']}?source=packet",
                            telegram_id=item["telegramId"],
                        )
                        if len(content) > 20 * 1024 * 1024:
                            raise WorkspaceError(
                                "PDF больше лимита Telegram; откройте его в Workspace."
                            )
                        with tempfile.TemporaryDirectory(prefix="signed-letter-") as directory:
                            path = Path(directory) / Path(entry["name"]).name
                            path.write_bytes(content)
                            response = self.telegram.send_document(
                                item["telegramId"], path, caption="Подписанное письмо"
                            )
                            if response.get("ok") is False:
                                raise WorkspaceError("Telegram не подтвердил доставку PDF.")
                        self.state.put(receipt_key, True)
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

    def recipients(self, actor: str, context: dict[str, Any]) -> None:
        params = urlencode({
            "query": context.get("query", ""), "category": context.get("category", ""),
            "offset": context.get("offset", 0), "limit": 8,
        })
        registry = self.request(actor, "/recipients?" + params)
        entries = registry["entries"]
        context.update(step="recipient", options=entries)
        self.state.put("conversation:" + actor, context)
        rows = [[button("🔎 Поиск по названию или адресу", "h:search")]]
        rows.extend(
            [button(label, "c:" + (category or "all"))]
            for category, label in CATEGORIES.items()
        )
        rows.extend(
            [button(entry["name"][:55], f"u:{index}")]
            for index, entry in enumerate(entries)
        )
        if context.get("offset", 0) > 0:
            rows.append([button("← Назад", f"p:{max(0, context['offset'] - 8)}")])
        if context.get("offset", 0) + len(entries) < registry["totalCount"]:
            rows.append([button("Далее →", f"p:{context['offset'] + 8}")])
        rows.append([button("Другая организация", "m:organization")])
        summary = "Выберите получателя из общего справочника Exat."
        if registry["updatedAt"] is None:
            summary = "Справочник ещё не синхронизирован. Укажите получателя вручную."
        elif not entries:
            summary = "Ничего не найдено. Измените поиск или укажите вручную."
        self.say(actor, summary, rows)

    def addresses(self, actor: str, context: dict[str, Any]) -> None:
        rows = [
            [button(str(address)[:55], f"b:{index}")]
            for index, address in enumerate(context["addresses"])
        ]
        rows.append([button("Ввести свой адрес", "b:custom")])
        self.say(actor, f"{context['recipientOrganization']}\nВыберите адрес доставки.", rows)

    def reviewers(self, actor: str, context: dict[str, Any]) -> None:
        context["step"] = "reviewer"
        self.state.put("conversation:" + actor, context)
        reviewers = self.request(actor, "/reviewers")["reviewers"]
        self.say(actor, "Выберите первого согласующего.", [
            [button(entry["fullName"], "r:" + entry["key"])]
            for entry in reviewers if entry["canApprove"]
        ])

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
                if self.wizard.callback(actor, str(callback.get("data") or ""), operation):
                    return
                if data[0] == "o":
                    self.state.remove("wizard:" + actor)
                    self.show(actor, data[1])
                elif data[0] == "list":
                    self.history(actor, data[1], int(data[2]))
                elif data[0] in {"c", "p", "h", "m", "u", "b", "r", "z", "q"} and self.state.get(
                    "wizard:" + actor
                ):
                    active = self.state.get("wizard:" + actor)
                    self.wizard.resume(actor, active["letterId"])
                    self.say(
                        actor,
                        "Меню обновлено. Продолжите письмо кнопками под последним сообщением.",
                    )
                elif data[0] == "c" and context.get("step") == "recipient":
                    category = "" if data[1] == "all" else data[1]
                    if category not in CATEGORIES:
                        raise WorkspaceError("Эта категория недоступна.")
                    context.update(category=category, offset=0)
                    self.recipients(actor, context)
                elif data[0] == "p" and context.get("step") == "recipient":
                    context["offset"] = max(0, int(data[1]))
                    self.recipients(actor, context)
                elif data[0] == "h" and data[1] == "search" and context.get("step") == "recipient":
                    context["step"] = "recipient_search"
                    self.state.put(key, context)
                    self.say(actor, "Напишите название организации или адрес для поиска.")
                elif (data[0] == "m" and data[1] == "organization"
                      and context.get("step") == "recipient"):
                    context["step"] = "custom_organization"
                    self.state.put(key, context)
                    self.say(actor, "Напишите название организации-получателя.")
                elif data[0] == "u" and context.get("step") == "recipient":
                    entry = context["options"][int(data[1])]
                    context.update(
                        recipientOrganization=entry.get("addressBookOrganization") or entry["name"],
                        addresses=entry["addresses"], route=entry["route"],
                        step="address_choice",
                    )
                    self.state.put(key, context)
                    self.addresses(actor, context)
                elif data[0] == "b" and context.get("step") == "address_choice":
                    if data[1] == "custom":
                        context["step"] = "custom_address"
                        self.state.put(key, context)
                        self.say(actor, "Введите свой адрес получателя.")
                    else:
                        context["recipientAddress"] = context["addresses"][int(data[1])]
                        self.reviewers(actor, context)
                elif data[0] == "q":
                    reviewers = self.request(actor, "/reviewers")["reviewers"]
                    selected = next(
                        (entry for entry in reviewers
                         if entry["key"] == data[1] and entry["canApprove"]), None
                    )
                    if context.get("step") != "sign_reviewer" or selected is None:
                        raise WorkspaceError("Начните новую заявку командой /sign.")
                    letter = self.request(actor, "/letters", {
                        "workflowKind": "sign_only",
                        "subject": context["subject"],
                        "recipientOrganization": "Подписание без отправки",
                        "recipientAddress": "",
                        "route": "exat",
                        "note": "",
                        "reviewerUserId": selected["userId"],
                        "finalReviewerUserId": None,
                        "operationId": context["createOperation"],
                    }, "POST")
                    self.state.put(key, {"step": "upload", "role": "primary",
                                         "letterId": letter["id"]})
                    self.say(
                        actor,
                        "Заявка создана. Пришлите DOCX: каждая страница — отдельное письмо.",
                    )
                elif data[0] == "z":
                    self.system(
                        actor,
                        "delete-" + str(UUID(data[1])),
                        "Удалить письмо из общей базы? Оно исчезнет и в Workspace, и в Telegram. "
                        "Отправленные письма и выполняемую отправку удалять нельзя. "
                        "Сохраняется журнал удаления.",
                        [
                            [
                                button("Да, удалить", f"v:z:{data[1]}:{data[2]}"),
                                button("Не удалять", "o:" + data[1]),
                            ]
                        ],
                        letter_id=str(UUID(data[1])),
                        revision=int(data[2]),
                    )
                elif data[0] == "v" and data[1] == "z":
                    letter_id = str(UUID(data[2]))
                    result = self.request(
                        actor,
                        f"/letters/{letter_id}?expectedRevision={int(data[3])}",
                        method="DELETE",
                    )
                    self.state.remove("wizard:" + actor)
                    self.state.remove("conversation:" + actor)
                    self.clear_system(actor, "wizard")
                    self.clear_system(actor, "delete-" + letter_id)
                    self.clear_system(actor, "letter-" + letter_id)
                    self.say(
                        actor,
                        "Робот закроет подготовленное окно и удалит запись."
                        if result.get("queued")
                        else "Письмо удалено из общей базы.",
                    )
                elif data[0] == "a":
                    self.state.remove("wizard:" + actor)
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
                        self.system(
                            actor,
                            "comment-" + str(UUID(data[2])),
                            "Напишите комментарий (не менее 3 символов) "
                            "или отправьте голосовое сообщение. "
                            "/cancel — отменить ввод.",
                            letter_id=str(UUID(data[2])),
                            revision=int(data[3]),
                        )
                    elif action in {"send", "cancel", "mark_sent", "replace_document"}:
                        self.system(
                            actor,
                            "confirm-" + str(UUID(data[2])),
                            "Подтвердите действие: "
                            + ACTIONS[data[1]][1]
                            + (
                                ". Вы заменяете файл как администратор, без нового согласования."
                                if action == "replace_document"
                                else ""
                            ),
                            [[button("Подтвердить", f"v:{data[1]}:{data[2]}:{data[3]}")]],
                            letter_id=str(UUID(data[2])), revision=int(data[3]),
                        )
                    else:
                        self.request(actor, f"/letters/{UUID(data[2])}/actions", payload, "POST")
                        self.show(actor, data[2])
                elif data[0] == "v" and data[1] in {"d", "c", "j", "w"}:
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
                    self.state.remove("wizard:" + actor)
                    letter = self.request(actor, f"/letters/{UUID(data[1])}")
                    if not letter["canEdit"] and not (
                        letter.get("canReplaceDocument") and data[0] == "e"
                    ):
                        raise WorkspaceError("На текущем этапе файлы менять нельзя.")
                    self.state.put(
                        key,
                        {
                            "step": "upload",
                            "letterId": letter["id"],
                            "role": "primary" if data[0] == "e" else "additional",
                            "revision": letter["revision"],
                            "operator": bool(letter.get("canReplaceDocument")),
                        },
                    )
                    self.say(
                        actor,
                        "Отправьте DOCX или готовый подписанный PDF. "
                        "DOCX получит прежний номер и подпись; PDF используется как есть. "
                        "Повторного согласования не будет. Проверьте номер и подпись."
                        if letter.get("canReplaceDocument")
                        else "Отправьте основной DOCX.",
                    )
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
                    "Telegram ID подтверждён. Доступ к письмам включается "
                    "администратором отдельно. Если доступ уже выдан: "
                    "/new — письмо, /history — общая очередь.",
                )
                return
            menu = menu_action(text)
            if menu == "legacy":
                self.say(actor, "Эта кнопка осталась от прежнего режима. Откройте «История» "
                         "или «Архив»; для нового письма нажмите «Новое письмо».")
                return
            if menu:
                text = "/" + menu
            if self.wizard.message(actor, message, text, operation):
                return
            if text in {"/start", "/help"}:
                self.state.remove(key)
                self.say(
                    actor,
                    "AI Referent · общая база Workspace\n/new — новое письмо\n"
                    "/history — письма и согласования\n/sign — подписать без отправки\n"
                    "/archive — архив Exat\n"
                    "/cancel — отменить ввод\nДоступ выдаёт администратор Workspace: "
                    "он указывает ваш Telegram ID и разрешает AI Referent. "
                    "Код привязки не требуется.",
                )
                return
            # Any further data request is authenticated and authorized by the server.
            if text == "/cancel":
                context = self.state.get(key) or {}
                if context.get("letterId"):
                    self.clear_system(actor, "comment-" + context["letterId"])
                self.state.remove(key)
                self.say(actor, "Ввод отменён. Сохранённые письма не удалены.")
            elif text.startswith("/pending"):
                self.history(actor, "pending", 0)
            elif text.startswith("/history") or text.startswith("/archive"):
                archive = text.startswith("/archive")
                parts = text.split()
                page = max(0, int(parts[1]) - 1) if len(parts) > 1 else 0
                route = "/archive" if archive else "/letters"
                letters = self.request(actor, route + f"?offset={page * 12}&limit=12")["letters"]
                rows = [
                    [
                        button(
                            (letter.get("displayNumber") or (
                                "На подпись" if letter.get("workflowKind") == "sign_only"
                                else "Черновик"
                            ))
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
            elif text == "/sign":
                self.request(actor, "/reviewers")
                self.state.put(key, {"step": "sign_subject", "createOperation": operation})
                self.say(
                    actor,
                    "Укажите тему пакета для подписи. Каждая страница DOCX станет отдельным PDF.",
                )
            elif context.get("step") == "sign_subject":
                if not 1 <= len(text) <= 300:
                    raise WorkspaceError("Тема должна содержать от 1 до 300 символов.")
                context.update(subject=text, step="sign_reviewer")
                self.state.put(key, context)
                reviewers = self.request(actor, "/reviewers")["reviewers"]
                self.say(actor, "Кто подпишет письма?", [
                    [button(entry["fullName"], "q:" + entry["key"])]
                    for entry in reviewers if entry["canApprove"]
                ])
            elif context.get("step") == "comment":
                audio_id = None
                if message.get("voice") and context["payload"]["action"] == "return_for_revision":
                    voice = message["voice"]
                    duration = int(voice.get("duration") or 0) * 1000
                    if (
                        not 1 <= duration <= 300000
                        or int(voice.get("file_size") or 0) > 10 * 1024 * 1024
                    ):
                        raise WorkspaceError("Запишите комментарий до 5 минут и 10 МБ.")
                    metadata = self.telegram.get_file(voice["file_id"])
                    with tempfile.TemporaryDirectory(prefix="referent-comment-") as folder:
                        path = Path(folder) / "comment.ogg"
                        self.telegram.download_file(metadata["result"]["file_path"], path)
                        if path.stat().st_size > 10 * 1024 * 1024:
                            raise WorkspaceError("Голосовой комментарий слишком большой.")
                        response = self.api.transfer(
                            f"/ai-referent/agent/letters/{context['letterId']}/comment-audio?"
                            + urlencode(
                                {
                                    "expectedRevision": context["payload"]["expectedRevision"],
                                    "durationMs": duration,
                                }
                            ),
                            path.read_bytes(),
                            method="PUT",
                            telegram_id=actor,
                            content_type="audio/ogg",
                        )
                        import json

                        audio_id = json.loads(response)["id"]
                if len(text) < 3 and audio_id is None:
                    raise WorkspaceError("Комментарий должен содержать не менее 3 символов.")
                payload = {
                    **context["payload"],
                    "comment": text,
                    "operationId": operation,
                    "commentAudioId": audio_id,
                }
                self.request(actor, f"/letters/{context['letterId']}/actions", payload, "POST")
                self.state.remove(key)
                self.clear_system(actor, "comment-" + context["letterId"])
                self.show(actor, context["letterId"])
            elif context.get("step") == "upload" and message.get("document"):
                document = message["document"]
                name = Path(str(document.get("file_name") or "attachment.bin")).name
                if int(document.get("file_size") or 0) > 20 * 1024 * 1024:
                    raise WorkspaceError(
                        "Через Telegram доступны документы до 20 МБ; "
                        "больший файл загрузите в Workspace."
                    )
                extensions = {".docx", ".pdf"} if context.get("operator") else {".docx"}
                if context["role"] == "primary" and Path(name).suffix.lower() not in extensions:
                    raise WorkspaceError(
                        "Основной документ должен быть DOCX для подготовки подписи."
                    )
                metadata = self.telegram.get_file(document["file_id"])
                with tempfile.TemporaryDirectory(prefix="workspace-upload-") as directory:
                    path = Path(directory) / "document"
                    self.telegram.download_file(metadata["result"]["file_path"], path)
                    if path.stat().st_size > 20 * 1024 * 1024:
                        raise WorkspaceError("Файл превышает лимит Telegram.")
                    query = urlencode(
                        {
                            "fileName": name,
                            "role": context["role"],
                            **(
                                {"expectedRevision": context["revision"]}
                                if "revision" in context
                                else {}
                            ),
                        }
                    )
                    self.api.transfer(
                        f"/ai-referent/agent/letters/{context['letterId']}/attachment?{query}",
                        path.read_bytes(),
                        method="PUT",
                        telegram_id=actor,
                        content_type=mimetypes.guess_type(name)[0] or "application/octet-stream",
                    )
                self.state.remove(key)
                self.show(actor, context["letterId"])
            elif context.get("step") == "subject":
                if not 1 <= len(text) <= 300:
                    raise WorkspaceError("Тема должна содержать от 1 до 300 символов.")
                context.update(subject=text, category="", query="", offset=0)
                self.recipients(actor, context)
            elif context.get("step") == "recipient_search":
                if not 1 <= len(text) <= 160:
                    raise WorkspaceError("Поиск должен содержать от 1 до 160 символов.")
                context.update(query=text, offset=0)
                self.recipients(actor, context)
            elif context.get("step") == "custom_organization":
                if not 1 <= len(text) <= 300:
                    raise WorkspaceError("Название должно содержать от 1 до 300 символов.")
                context.update(recipientOrganization=text, step="custom_address")
                self.state.put(key, context)
                self.say(actor, "Введите адрес получателя.")
            elif context.get("step") == "custom_address":
                if not EMAIL.fullmatch(text):
                    raise WorkspaceError("Укажите полный email-адрес. Например: name@example.org.")
                context["recipientAddress"] = text
                context["route"] = "exat" if text.lower().endswith("@exat.uz") else "webmail"
                self.reviewers(actor, context)
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


def safe_error_text(error: Exception) -> str:
    """Log diagnostic text without token-bearing URLs or credential-like strings."""
    text = re.sub(r"https?://\S+", "[URL]", str(error))
    text = re.sub(r"[A-Za-z0-9_\-]{32,}", "[redacted]", text)
    return text[:1500]


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
    try:
        bot.client.set_my_commands(
            [
                {"command": "start", "description": "Открыть меню"},
                {"command": "new", "description": "Новое исходящее письмо"},
                {"command": "sign", "description": "Подписать DOCX без отправки"},
                {"command": "history", "description": "История писем"},
                {"command": "pending", "description": "Согласование и черновики"},
                {"command": "archive", "description": "Архив документов"},
                {"command": "cancel", "description": "Отмена текущего действия"},
            ]
        )
    except Exception as error:
        bot._status_log("workspace_commands_failed", error=type(error).__name__)
    done = threading.Event()

    def execute() -> None:
        ready = False
        attempts = 0
        next_sync = 0.0
        while not done.is_set():
            if not ready:
                if time.monotonic() < next_sync:
                    done.wait(1)
                    continue
                attempts += 1
                next_sync = time.monotonic() + 60
                try:
                    worker.bootstrap()
                except Exception as error:
                    bot._status_log(
                        "workspace_bootstrap_failed",
                        error=type(error).__name__,
                        detail=safe_error_text(error),
                        attempts=attempts,
                    )
                    continue
                ready = True
                next_sync = time.monotonic() + 60
                bot._status_log("workspace_bootstrap_completed", attempts=attempts)
            try:
                worker.tick()
                if time.monotonic() >= next_sync:
                    # Advance before the attempt: a failed archive must not retry every tick.
                    next_sync = time.monotonic() + 60
                    worker.sync.run()
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
            except Exception as error:
                bot._status_log("workspace_notifications_failed", error=type(error).__name__)
            try:
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
