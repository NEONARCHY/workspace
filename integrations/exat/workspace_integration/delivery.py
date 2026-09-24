"""Physical compose operations, on the single workspace-executor thread only."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import contextmanager
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


@contextmanager
def guarded_send(service: Any, row: Any, handle: int | None, fence: Callable[[], None]):
    """The service calls this adapter inside gui_lock: recheck there, not before waiting."""
    adapter = (
        service.webmail_sender if row["destination_route"] == "webmail" else service.exat_compose
    )
    original = adapter.click_prepared_send

    def click(local_id: int, **kwargs: Any):
        if local_id != row["id"] or not prepared_open(service, row, handle):
            raise WorkspaceError("Подготовленное окно изменилось. Отправка остановлена.")
        fence()
        return original(local_id, **kwargs)

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
