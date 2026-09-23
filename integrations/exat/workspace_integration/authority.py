# ruff: noqa: RUF001
"""Keep legacy GUI/bot mutators from bypassing the server workflow (Russian UI)."""

from contextvars import ContextVar

from .client import WorkspaceError, connection_settings

executing_server_job: ContextVar[bool] = ContextVar("executing_server_job", default=False)


def guard_legacy_mutation() -> None:
    if (
        connection_settings().get("shared_workflow", "false").lower() == "true"
        and not executing_server_job.get()
    ):
        raise WorkspaceError(
            "В общем режиме решение принимается в Workspace или Telegram. "
            "Старые локальные кнопки отправки отключены."
        )
