"""Resumable outgoing composer. Every document and field lives in Workspace."""

# ruff: noqa: RUF001
from __future__ import annotations

import mimetypes
import re
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from uuid import UUID, uuid4

from .button_labels import button_label
from .client import WorkspaceError

CATEGORIES = {
    "": "Все",
    "ministries": "Министерства",
    "agencies": "Агентства",
    "committees": "Комитеты",
    "international": "Международные",
    "other": "Другие",
}
EMAIL = re.compile(r"[A-Za-z0-9_][A-Za-z0-9._%+\-]*@[A-Za-z0-9][A-Za-z0-9.\-]*\.[A-Za-z]{2,}")
FIELDS = (
    "subject",
    "recipientOrganization",
    "recipientAddress",
    "route",
    "note",
    "workflowKind",
    "reviewerUserId",
    "finalReviewerUserId",
)


class LetterWizard:
    def __init__(self, bot: Any):
        self.bot = bot
        self.state = bot.state

    def save(self, actor: str, context: dict[str, Any]) -> None:
        self.state.put("wizard:" + actor, context)

    def option(
        self, actor: str, context: dict[str, Any], label: str, action: str, value: Any = None
    ) -> dict[str, str]:
        # Immutable button payload, not an index into a subsequently replaced page.
        token = uuid4().hex
        self.state.put(
            f"wizard-button:{actor}:{token}",
            {
                "letterId": context["letterId"],
                "revision": context["revision"],
                "action": action,
                "value": value,
            },
        )
        return {"text": button_label(label, action), "callback_data": "w:" + token}

    def letter(self, actor: str, context: dict[str, Any]) -> dict[str, Any]:
        letter = self.bot.request(actor, "/letters/" + context["letterId"])
        if not letter["canEdit"]:
            self.state.remove("wizard:" + actor)
            self.bot.show(actor, letter["id"])
            raise WorkspaceError(
                "Письмо уже перешло на другой этап. Используйте актуальные действия."
            )
        if letter["revision"] != context["revision"]:
            context.update(revision=letter["revision"], step="resume")
            self.save(actor, context)
            raise WorkspaceError(
                "Письмо изменилось в Workspace или Telegram. Откройте его через «Согласование» "
                "и продолжите с актуальной версией; ваши изменения не перезаписаны."
            )
        return letter

    def patch(
        self, actor: str, context: dict[str, Any], changes: dict[str, Any], operation: str
    ) -> dict[str, Any]:
        letter = self.letter(actor, context)
        payload = {field: letter[field] for field in FIELDS}
        # After a return the server resets the current reviewer to the initial stage.
        payload.update(changes, expectedRevision=letter["revision"], operationId=operation)
        result = self.bot.request(actor, "/letters/" + letter["id"], payload, "PATCH")
        context["revision"] = result["revision"]
        self.save(actor, context)
        return result

    def resume(self, actor: str, letter_id: str, *, edit_document: bool = False) -> None:
        letter = self.bot.request(actor, f"/letters/{UUID(letter_id)}")
        if not letter["canEdit"]:
            self.bot.show(actor, letter["id"])
            return
        primary = any(item.get("documentRole") == "primary" for item in letter["attachments"])
        step = "document" if edit_document or not primary else "recipient"
        if primary and letter["workflowKind"] == "sign_only" and not edit_document:
            step = "reviewer"
        if (
            primary
            and not edit_document
            and (letter.get("documentCheck") or {}).get("status") != "passed"
        ):
            step = "checking"
        context = {
            "letterId": letter["id"],
            "revision": letter["revision"],
            "step": step,
            "correction": letter["status"] == "needs_revision",
        }
        self.prompt(actor, context)

    def prompt(self, actor: str, context: dict[str, Any]) -> None:
        letter = self.letter(actor, context)
        step = context["step"]
        if (
            step not in {"subject", "document", "checking"}
            and (letter.get("documentCheck") or {}).get("status") != "passed"
        ):
            step = context["step"] = "checking"
        rows: list[list[dict[str, str]]] = []

        def opt(label: str, action: str, value: Any = None) -> dict[str, str]:
            return self.option(actor, context, label, action, value)

        if step == "subject":
            text = (
                "Напишите тему письма или пропустите. "
                "Без своей темы будет использован исходящий номер."
            )
            rows.append([opt("Пропустить", "skip")])
            back = "menu"
        elif step == "checking":
            check = letter.get("documentCheck") or {}
            text = (
                (
                    check.get("detail")
                    or "Проверка не пройдена. Обратитесь к IT-специалисту "
                    "и загрузите исправленный DOCX."
                )
                if check.get("status") == "failed"
                else "Подождите: робот проверяет форматирование письма и место для подписи. "
                "Можно оставить этот чат — проверка продолжится."
            )
            back = "document"
        elif step == "document":
            text = (
                "Пришлите основной файл DOCX. Проверьте макет и поля нумерации: "
                "робот сам проставит исходящий номер при подготовке PDF."
                if letter["workflowKind"] == "delivery"
                else (
                    "Пришлите DOCX: каждая страница — отдельное письмо. "
                    "Вернём отдельные подписанные PDF."
                )
            )
            if any(item.get("documentRole") == "primary" for item in letter["attachments"]):
                rows.append([opt("Оставить загруженный файл", "next_document")])
            back = "subject"
        elif step == "attachments":
            count = sum(item.get("documentRole") == "additional" for item in letter["attachments"])
            text = f"Пришлите приложения отдельными файлами. Загружено: {count}. Это необязательно."
            rows.append([opt("Далее" if count else "Без приложений", "go", "recipient")])
            back = "document"
        elif step == "recipient":
            text = (
                "Кому отправить письмо? Выберите из справочника, "
                "найдите организацию или введите адрес."
            )
            rows = [
                [opt("Справочник", "directory", {"category": "", "offset": 0})],
                [opt("Поиск", "go", "search"), opt("Свой адрес", "go", "custom")],
            ]
            if letter["recipientAddress"]:
                rows.insert(
                    0, [opt("Оставить: " + letter["recipientAddress"][:45], "go", "reviewer")]
                )
            back = "attachments"
        elif step == "directory":
            query = context.get("query", "")
            category = context.get("category", "")
            offset = context.get("offset", 0)
            result = self.bot.request(
                actor,
                "/recipients?"
                + urlencode(
                    {
                        "query": query,
                        "category": category,
                        "offset": offset,
                        "limit": 6,
                    }
                ),
            )
            text = (
                "Выберите организацию и адрес."
                if result["entries"]
                else "Ничего не найдено. Измените поиск."
            )
            rows = [
                [opt(label, "directory", {"category": key, "query": "", "offset": 0})]
                for key, label in CATEGORIES.items()
            ]
            for entry in result["entries"]:
                label = entry["name"][:42] + " · " + ", ".join(entry["addresses"])[:35]
                rows.append([opt(label, "organization", entry)])
            pages = []
            if offset:
                pages.append(opt("← Предыдущие", "directory", {"offset": max(0, offset - 6)}))
            if offset + 6 < result["totalCount"]:
                pages.append(opt("Следующие →", "directory", {"offset": offset + 6}))
            if pages:
                rows.append(pages)
            rows.append([opt("Поиск", "go", "search"), opt("Свой адрес", "go", "custom")])
            back = "recipient"
        elif step == "address":
            entry = context["organization"]
            text = entry["name"] + "\nВыберите адрес."
            rows = [
                [opt(address, "address", {"address": address, "entry": entry})]
                for address in entry["addresses"]
            ]
            rows.append([opt("Свой адрес", "go", "custom")])
            back = "recipient"
        elif step == "search":
            text = (
                "Напишите часть названия или адреса. Можно кириллицей или латиницей. "
                "Поиск — по общему справочнику."
            )
            back = "recipient"
        elif step == "custom":
            text = (
                "Введите адрес получателя. @exat.uz — через E-XAT, "
                "остальные адреса — через Webmail."
            )
            back = "recipient"
        elif step in {"reviewer", "preliminary"}:
            reviewers = self.bot.request(actor, "/reviewers")["reviewers"]
            text = (
                "Выберите согласующего."
                if step == "reviewer"
                else "Кто согласует до Бобура Бекмуродова?"
            )
            for reviewer in reviewers:
                if reviewer["canApprove"] and (step == "reviewer" or reviewer["key"] != "bobur"):
                    rows.append(
                        [
                            opt(
                                reviewer["fullName"],
                                step,
                                {
                                    "key": reviewer["key"],
                                    "userId": reviewer["userId"],
                                },
                            )
                        ]
                    )
            back = (
                "reviewer"
                if step == "preliminary"
                else ("document" if letter["workflowKind"] == "sign_only" else "recipient")
            )
        elif step == "confirm":
            text = (
                f"Проверьте перед согласованием:\n{letter['subject'] or 'Тема — исходящий номер'}\n"
                f"Кому: {letter['recipientOrganization']}\n{letter['recipientAddress']}\n"
                f"Согласующий: {letter.get('reviewerName') or 'Не назначен'}"
                + (f" → {letter['finalReviewerName']}" if letter.get("finalReviewerName") else "")
            )
            rows.append([opt("Отправить на согласование", "submit")])
            back = "preliminary" if letter.get("finalReviewerUserId") else "reviewer"
        else:
            self.bot.show(actor, letter["id"])
            return
        rows.append([opt("Назад", "go", back)])
        self.save(actor, context)
        self.bot.system(
            actor, "wizard", text, rows, letter_id=letter["id"], revision=letter["revision"],
            edit_existing=step == "checking",
        )

    def poll_checks(self) -> None:
        for key, context in self.state.pending("wizard:"):
            if context.get("step") != "checking":
                continue
            actor = key.split(":", 1)[1]
            try:
                letter = self.letter(actor, context)
                check = letter.get("documentCheck") or {}
                if check.get("status") == "passed":
                    context["step"] = (
                        "reviewer" if letter["workflowKind"] == "sign_only" else "attachments"
                    )
                    self.prompt(actor, context)
                elif check.get("status") == "failed" and not context.get("checkFailedShown"):
                    context["checkFailedShown"] = True
                    self.prompt(actor, context)
            except WorkspaceError as error:
                if error.status in {403, 404}:
                    self.state.remove(key)
                    self.bot.clear_system(actor, "wizard")

    def submit(self, actor: str, context: dict[str, Any], operation: str) -> None:
        letter = self.letter(actor, context)
        self.bot.request(
            actor,
            f"/letters/{letter['id']}/actions",
            {
                "action": "submit",
                "expectedRevision": letter["revision"],
                "operationId": operation,
            },
            "POST",
        )
        self.state.remove("wizard:" + actor)
        self.bot.clear_system(actor, "wizard")
        self.bot.show(actor, letter["id"])

    def callback(self, actor: str, data: str, operation: str) -> bool:
        if not data.startswith("w:"):
            return False
        parts = data.split(":")
        if len(parts) == 3 and parts[1] in {"resume", "edit"}:
            self.resume(actor, parts[2], edit_document=parts[1] == "edit")
            return True
        choice = self.state.get(f"wizard-button:{actor}:{parts[1]}")
        if not choice:
            raise WorkspaceError(
                "Откройте письмо через «Согласование»: эта кнопка больше недоступна."
            )
        context = self.state.get("wizard:" + actor, {})
        if context.get("letterId") != choice["letterId"]:
            self.resume(actor, choice["letterId"])
            return True
        if context["revision"] != choice["revision"]:
            self.resume(actor, context["letterId"])
            self.bot.say(actor, "Показана актуальная версия. Выберите действие заново.")
            return True
        letter = self.letter(actor, context)
        action, value = choice["action"], choice["value"]
        if action == "go":
            if value == "menu":
                self.state.remove("wizard:" + actor)
                self.bot.say(
                    actor, "Черновик сохранён в «Согласование». Можно продолжить в Workspace."
                )
                return True
            context["step"] = value
        elif action == "skip":
            self.patch(actor, context, {"subject": ""}, operation)
            context["step"] = "document"
        elif action == "next_document":
            context["step"] = (
                ("reviewer" if letter["workflowKind"] == "sign_only" else "attachments")
                if (letter.get("documentCheck") or {}).get("status") == "passed"
                else "checking"
            )
        elif action == "submit":
            self.submit(actor, context, operation)
            return True
        elif action == "directory":
            context.update(value, step="directory")
        elif action == "organization":
            context.update(organization=value, step="address")
        elif action == "address":
            entry, address = value["entry"], value["address"]
            route = (
                ("exat" if address.lower().endswith("@exat.uz") else "webmail")
                if "@" in address
                else entry["route"]
            )
            self.patch(
                actor,
                context,
                {
                    "recipientOrganization": entry.get("addressBookOrganization") or entry["name"],
                    "recipientAddress": address,
                    "route": route,
                },
                operation,
            )
            context["step"] = "reviewer"
        elif action in {"reviewer", "preliminary"}:
            reviewers = self.bot.request(actor, "/reviewers")["reviewers"]
            if value and not any(
                r["userId"] == value["userId"] and r["key"] == value["key"] and r["canApprove"]
                for r in reviewers
            ):
                raise WorkspaceError("Назначение согласующего изменилось. Выберите его заново.")
            if action == "reviewer":
                fields = {"reviewerUserId": value["userId"], "finalReviewerUserId": None}
                self.patch(actor, context, fields, operation)
                if value["key"] == "bobur" and letter["workflowKind"] == "delivery":
                    context["step"] = "preliminary"
                else:
                    context["step"] = "confirm"
            else:
                bobur = next(
                    (r for r in reviewers if r["key"] == "bobur" and r["canApprove"]), None
                )
                if bobur is None or not value or value["key"] == "bobur":
                    raise WorkspaceError("Маршрут изменился. Выберите согласующего заново.")
                self.patch(
                    actor,
                    context,
                    {
                        "reviewerUserId": value["userId"] if value else bobur["userId"],
                        "finalReviewerUserId": bobur["userId"] if value else None,
                    },
                    operation,
                )
                context["step"] = "confirm"
        self.prompt(actor, context)
        return True

    def message(self, actor: str, message: dict[str, Any], text: str, operation: str) -> bool:
        if text in {"/new", "/sign"}:
            letter = self.bot.request(
                actor,
                "/letters",
                {
                    "workflowKind": "sign_only" if text == "/sign" else "delivery",
                    "subject": "",
                    "recipientOrganization": "",
                    "route": "exat",
                    "operationId": operation,
                },
                "POST",
            )
            self.state.remove("conversation:" + actor)
            self.prompt(
                actor, {"letterId": letter["id"], "revision": letter["revision"], "step": "subject"}
            )
            return True
        if text.startswith("/"):
            # Menu navigation suspends input, never deletes a submitted letter or draft.
            self.state.remove("wizard:" + actor)
            self.bot.clear_system(actor, "wizard")
            return False
        context = self.state.get("wizard:" + actor)
        if not context:
            return False
        letter = self.letter(actor, context)
        step = context["step"]
        if text in {"Назад", "← Назад"}:
            context["step"] = {
                "subject": "subject",
                "document": "subject",
                "attachments": "document",
                "recipient": "attachments",
                "reviewer": "document" if letter["workflowKind"] == "sign_only" else "recipient",
                "preliminary": "reviewer",
                "checking": "document",
                "confirm": "preliminary" if letter.get("finalReviewerUserId") else "reviewer",
            }.get(step, "recipient")
        elif step == "subject":
            if not text or len(text) > 300:
                raise WorkspaceError("Введите тему до 300 символов или нажмите «Пропустить».")
            self.patch(actor, context, {"subject": text}, operation)
            context["step"] = "document"
        elif step in {"document", "attachments"} and message.get("document"):
            document = message["document"]
            name = str(document.get("file_name") or "attachment.bin")
            if Path(name).name != name or any(c in name for c in ("\\", "/", ":")):
                raise WorkspaceError("Переименуйте файл: имя не должно содержать путь.")
            role = "primary" if step == "document" else "additional"
            if role == "primary" and not name.lower().endswith(".docx"):
                raise WorkspaceError("Основной файл должен быть DOCX.")
            if int(document.get("file_size") or 0) > 20 * 1024 * 1024:
                raise WorkspaceError(
                    "Файл больше 20 МБ — загрузите его в это же письмо через Workspace."
                )
            if role == "primary":
                self.bot.system(
                    actor,
                    "wizard",
                    "Подождите: робот проверяет форматирование письма и место для подписи.",
                )
            metadata = self.bot.telegram.get_file(document["file_id"])
            with tempfile.TemporaryDirectory(prefix="referent-upload-") as directory:
                path = Path(directory) / "document"
                self.bot.telegram.download_file(metadata["result"]["file_path"], path)
                if path.stat().st_size > 20 * 1024 * 1024:
                    raise WorkspaceError("Файл больше лимита Telegram.")
                query = urlencode(
                    {
                        "fileName": name,
                        "role": role,
                        "operationId": operation,
                        "expectedRevision": letter["revision"],
                    }
                )
                self.bot.api.transfer(
                    f"/ai-referent/agent/letters/{letter['id']}/attachment?{query}",
                    path.read_bytes(),
                    method="PUT",
                    telegram_id=actor,
                    content_type=mimetypes.guess_type(name)[0] or "application/octet-stream",
                )
            updated = self.bot.request(actor, "/letters/" + letter["id"])
            context["revision"] = updated["revision"]
            context["step"] = "checking" if role == "primary" else "attachments"
            context.pop("checkFailedShown", None)
        elif step == "search":
            if not text or len(text) > 160:
                raise WorkspaceError("Введите поисковый запрос до 160 символов.")
            context.update(step="directory", query=text, category="", offset=0)
        elif step == "custom":
            if not EMAIL.fullmatch(text):
                raise WorkspaceError(
                    "Введите адрес, например organization@exat.uz или office@example.org."
                )
            self.patch(
                actor,
                context,
                {
                    "recipientOrganization": text,
                    "recipientAddress": text,
                    "route": "exat" if text.lower().endswith("@exat.uz") else "webmail",
                },
                operation,
            )
            context["step"] = "reviewer"
        else:
            self.bot.say(actor, "Выберите действие кнопкой ниже; файл отправляйте как документ.")
        self.prompt(actor, context)
        return True
