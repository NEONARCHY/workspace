"""Physical compose operations, on the single workspace-executor thread only."""

from __future__ import annotations

import re
from collections.abc import Callable
from contextlib import contextmanager
from email.utils import getaddresses
from typing import Any

from .client import WorkspaceError


@contextmanager
def prepare_only(service: Any):
    """Copy adapter flags temporarily; never change GUI configuration on disk."""
    exat = service.exat_compose.exat_send
    webmail = service.webmail_sender.webmail_send
    webmail_exat = service.webmail_sender.exat_send
    service.exat_compose.exat_send = {**exat, "allow_real_send": False}
    service.webmail_sender.webmail_send = {**webmail, "allow_real_send": False}
    service.webmail_sender.exat_send = {**webmail_exat, "allow_real_send": False}
    try:
        yield
    finally:
        service.exat_compose.exat_send = exat
        service.webmail_sender.webmail_send = webmail
        service.webmail_sender.exat_send = webmail_exat


def compose_identity(service: Any, row: Any) -> int | None:
    """Only reuse an exact prepared E-XAT window, never an arbitrary foreground window."""
    from pywinauto import Desktop
    from src.outgoing.exat_compose import (
        _active_or_latest_compose_window,
        _find_compose_recipient_control,
        _find_compose_subject_control,
    )

    window = _active_or_latest_compose_window(Desktop(backend="uia"))
    if window is None:
        return None

    def value(control: Any) -> str:
        if control is None:
            return ""
        return str(
            control.get_value() if hasattr(control, "get_value") else control.window_text()
        ).strip()

    subject = value(_find_compose_subject_control(window))
    recipient = value(_find_compose_recipient_control(window))
    if (
        subject != str(row["subject"]).strip()
        or recipient.casefold() != str(row["destination_address"]).strip().casefold()
    ):
        return None
    return int(window.handle)


def prepare_compose(service: Any, local_id: int) -> int | None:
    with prepare_only(service):
        service.retry_outgoing_send(local_id)
    row = service.database.get_outgoing_letter(local_id)
    if row["status"] not in {"exat_compose_prepared", "webmail_dry_run_prepared"}:
        raise WorkspaceError("Окно отправки не подготовлено полностью. Отправка остановлена.")
    return compose_identity(service, row) if row["destination_route"] == "exat" else None


def prepared_open(service: Any, row: Any, handle: int | None) -> bool:
    if row["destination_route"] == "webmail":
        return any(
            session.get("outgoing_id") == row["id"] and not session["page"].is_closed()
            for session in service.webmail_sender._manual_browser_sessions
        )
    return handle is not None and compose_identity(service, row) == handle


def _webmail_click_once(page: Any, row: Any, fence: Callable[[], None]) -> bool:
    fields = page.locator(
        "textarea#_to, input#_to, textarea#compose_to, input#compose_to, "
        "textarea[name='_to'], input[name='_to'], input[name='to']"
    )
    address = str(row["destination_address"]).casefold()
    values = [field.input_value().strip().casefold() for field in fields.all()]
    recipients = [
        [mailbox for _, mailbox in getaddresses([value])] for value in values if value
    ]
    if not recipients or any(field != [address] for field in recipients):
        raise WorkspaceError("Поле получателя Webmail отличается от утверждённого адреса.")
    controls = page.locator("[data-command='send'], #compose-send, #rcmbtn-send").all()
    controls += page.get_by_role("button", name=re.compile(r"^(Отправить|Send)$", re.I)).all()
    button = next((control for control in controls if control.is_visible()), None)
    if button is None:
        return False
    fence()
    button.click(timeout=10000)
    return True


def _exat_click_once(
    desktop: Any, window: Any, warnings: list[str], handle: int | None,
    fence: Callable[[], None], timeout: object,
) -> tuple[bool, str | None, int, bool]:
    from src.outgoing.exat_compose import (
        _click_control_body,
        _click_window_ok,
        _find_send_button,
        _positive_float,
        _wait_for_exat_send_outcome,
    )

    if handle is None or int(window.handle) != handle:
        raise WorkspaceError("Окно E-XAT изменилось перед отправкой.")
    button = _find_send_button(window)
    if button is None:
        return False, None, 0, False
    rectangle = str(button.rectangle())
    fence()
    _click_control_body(button)
    outcome, error = _wait_for_exat_send_outcome(
        desktop, handle, timeout_seconds=_positive_float(timeout, 3.0)
    )
    if outcome == "server_error" and error is not None:
        _click_window_ok(error)
    if outcome != "closed":
        warnings.append("E-XAT did not confirm the single send attempt.")
    return outcome == "closed", rectangle, 1, outcome == "server_error"


@contextmanager
def guarded_send(
    service: Any, row: Any, handle: int | None, fence: Callable[[], None],
    *, single_attempt: bool = False,
):
    """Run the final check inside the adapter's GUI lock, immediately before sending."""
    webmail = row["destination_route"] == "webmail"
    adapter = service.webmail_sender if webmail else service.exat_compose
    original = adapter.click_prepared_send

    def click(local_id: int, **kwargs: Any):
        if local_id != row["id"] or not prepared_open(service, row, handle):
            raise WorkspaceError("Подготовленное окно изменилось. Отправка остановлена.")
        if not single_attempt:
            fence()
            return original(local_id, **kwargs)

        def before_click() -> None:
            if not prepared_open(service, row, handle):
                raise WorkspaceError("Подготовленное окно изменилось. Отправка остановлена.")
            fence()

        invoked = False

        def once() -> None:
            nonlocal invoked
            if invoked:
                raise WorkspaceError("Повторное нажатие заблокировано. Сверьте журнал.")
            before_click()
            invoked = True

        if webmail:
            original_click = adapter._click_send
            adapter._click_send = lambda page: _webmail_click_once(page, row, once)
            try:
                return original(local_id, **kwargs)
            finally:
                adapter._click_send = original_click
        original_click = adapter._click_send_with_result_guard
        adapter._click_send_with_result_guard = lambda desktop, window, warnings: _exat_click_once(
            desktop, window, warnings, handle, once,
            adapter.exat_send.get("send_result_wait_seconds"),
        )
        try:
            return original(local_id, **kwargs)
        finally:
            adapter._click_send_with_result_guard = original_click

    adapter.click_prepared_send = click
    try:
        yield
    finally:
        adapter.click_prepared_send = original


def close_prepared(service: Any, row: Any, handle: int | None) -> None:
    local_id = int(row["id"])
    with service.automation.gui_lock(
        operation="workspace_close_prepared",
        priority=True,
        extra={"outgoing_id": local_id},
        timeout_seconds=45,
    ):
        if row["destination_route"] == "webmail":
            result = service.webmail_sender.cancel_prepared_send(local_id)
        else:
            from pywinauto import Desktop
            from src.outgoing.exat_compose import _active_or_latest_compose_window

            window = _active_or_latest_compose_window(Desktop(backend="uia"))
            if window is None:
                result = {"status": "not_open"}
            elif prepared_open(service, row, handle):
                result = service.exat_compose.cancel_prepared_send(
                    local_id, logs_root=service.diagnostics_root
                )
            else:
                raise WorkspaceError(
                    "Открытое окно E-XAT не соответствует ожидаемому письму. "
                    "Закройте окно вручную и повторите действие."
                )
        if result["status"] not in {"not_open", "cancelled", "cancelled_with_warnings"}:
            raise WorkspaceError(
                "Закрытие подготовленного письма не завершено. Проверьте окно E-XAT/Webmail."
            )
    service._clear_manual_send_hold(local_id)
