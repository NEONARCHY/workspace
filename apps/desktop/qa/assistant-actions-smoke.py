"""Only synthetic data: check real form handoff without a provider or live API."""
import json
from pathlib import Path

from playwright.sync_api import sync_playwright  # type: ignore[import-not-found]

OUT = Path(__file__).resolve().parents[3] / "tmp" / "assistant-actions"
OUT.mkdir(parents=True, exist_ok=True)
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=EDGE, headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    checks = [
        ("task", "Создать задачу", "Название задачи", "Тестовая задача: проверить отчёт"),
        ("project", "Начать проект", "Название проекта", "Тестовый форум"),
        ("trip", "Спланировать поездку", "Цель поездки", "Тестовая рабочая встреча"),
        ("absence", "Оформить отсутствие", "Причина", "Тестовый личный вопрос"),
    ]
    for kind, button, field, value in checks:
        page.goto("http://127.0.0.1:5177/qa/assistant-actions.html")
        page.get_by_role("button", name="Открыть ассистента Yuksalish").click()
        page.get_by_role("button", name=button, exact=True).click()
        page.get_by_role("button", name="Отправить сообщение").click()
        page.get_by_role("button", name="Открыть заполненную форму").wait_for()
        page.get_by_role("textbox", name="Сообщение ассистенту").fill("Да, открывай форму")
        page.get_by_role("button", name="Отправить сообщение").click()
        control = page.get_by_role("textbox", name=field, exact=True)
        control.wait_for()
        assert control.input_value() == value, (kind, control.input_value())
        assert not page.get_by_role("dialog", name="Ассистент Yuksalish").count()
        if kind == "project":
            assert page.get_by_role("spinbutton", name="Бюджет").input_value() == "2500000"
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / f"form-{kind}.png"))
        captured = page.get_by_role("status", name="Подтверждённые тестовые данные")
        assert not captured.count(), "Opening a form must not submit it"
        save_labels = {"task": "Добавить задачу", "project": "Сохранить проект",
                       "trip": "Сохранить", "absence": "Отправить руководителю"}
        page.get_by_role("button", name=save_labels[kind], exact=True).click()
        captured.wait_for()
        payload = json.loads(captured.locator("pre").inner_text())
        if kind == "task":
            assert payload["title"] == value and payload["priority"] == "high"
            assert payload["assigneeId"] == "baxtiyor"
            assert len(payload["checklist"]) == 2
        elif kind == "project":
            assert payload["budget"] == 2500000 and payload["managerUserId"] == "baxtiyor"
            assert payload["approverUserIds"] == ["dilshod", "baxtiyor"]
        elif kind == "trip":
            assert payload["purpose"] == value and payload["employeeIds"] == ["baxtiyor", "dilshod"]
        else:
            assert payload["reason"] == value and payload["kind"] == "personal_time"
            assert "T" in payload["startsAt"] and "T" in payload["endsAt"]
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto("http://127.0.0.1:5177/qa/assistant-actions.html")
    page.get_by_role("button", name="Открыть ассистента Yuksalish").click()
    page.get_by_role("button", name="Создать задачу", exact=True).click()
    page.get_by_role("button", name="Отправить сообщение").click()
    page.get_by_role("button", name="Открыть заполненную форму").click()
    page.get_by_role("textbox", name="Название задачи").wait_for()
    assert page.locator("body").evaluate("el => el.scrollWidth <= innerWidth")
    page.wait_for_timeout(400)
    page.screenshot(path=str(OUT / "form-task-390.png"))
    assert not errors, errors
    print({"forms": [check[0] for check in checks], "errors": errors, "screenshots": str(OUT)})
    browser.close()
