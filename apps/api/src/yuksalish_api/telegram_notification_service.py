"""Leased delivery with explicit send fencing; ambiguous sends are never replayed."""

from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import or_, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action
from .auth import AuthenticatedUser, load_authenticated_user
from .errors import WorkspaceRepositoryError as Error
from .settings import Settings
from .telegram_notification_events import current_payment_stage, task_access
from .telegram_notification_schemas import (
    DeliveryAck,
    DeliveryClaim,
    PreparedDelivery,
    WorkspaceNoticeTarget,
)
from .telegram_notification_scope import recipient
from .telegram_notification_tables import deliveries as d


async def valid(c: AsyncConnection, row: RowMapping) -> bool:
    user = await load_authenticated_user(c, row["user_id"])
    if user is None:
        return False
    try:
        if row["kind"] == "task_assigned":
            return await task_access(c, user, row["entity_id"])
        return await current_payment_stage(
            c, row["entity_id"], row["stage_key"], row["entity_version"], user
        )
    except (Error, HTTPException) as error:
        if error.status_code not in {403, 404}:
            raise
        return False


async def claim(c: AsyncConnection) -> list[DeliveryClaim]:
    now = datetime.now(UTC)
    await c.execute(
        update(d)
        .where(d.c.state == "leased", d.c.lease_until <= now)
        .values(state="pending", lease_token=None, lease_until=None)
    )
    await c.execute(
        update(d)
        .where(d.c.state == "sending", d.c.lease_until <= now)
        .values(state="unknown", last_error="send_result_unknown")
    )
    rows = (
        (
            await c.execute(
                select(d)
                .where(d.c.state == "pending", or_(d.c.retry_at.is_(None), d.c.retry_at <= now))
                .order_by(d.c.created_at)
                .limit(30)
                .with_for_update(skip_locked=True)
            )
        )
        .mappings()
        .all()
    )
    result: list[DeliveryClaim] = []
    for row in rows:
        target = await recipient(c, row["user_id"])
        if target is None or not await valid(c, row) or row["created_at"] < now - timedelta(days=7):
            await c.execute(
                update(d)
                .where(d.c.id == row["id"])
                .values(state="skipped", last_error="no_longer_eligible", finished_at=now)
            )
            continue
        token = uuid4()
        await c.execute(
            update(d)
            .where(d.c.id == row["id"])
            .values(
                state="leased",
                lease_token=token,
                lease_until=now + timedelta(minutes=2),
                telegram_id=target[0],
                identity_revision=target[1],
            )
        )
        result.append(DeliveryClaim(id=row["id"], lease_token=token))
    return result


async def locked(c: AsyncConnection, identifier: UUID, token: UUID) -> RowMapping:
    row = (
        (await c.execute(select(d).where(d.c.id == identifier).with_for_update()))
        .mappings()
        .first()
    )
    if row is None or row["lease_token"] != token:
        raise Error(409, "Delivery lease is no longer current")
    return row


def notice_url(settings: Settings, identifier: UUID) -> str:
    base = settings.telegram_notifications_workspace_url.rstrip("/")
    parsed = urlsplit(base)
    local = settings.environment == "test" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if (
        (parsed.scheme != "https"
        and not (local and parsed.scheme == "http"))
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise Error(409, "Configure the public Workspace HTTPS origin")
    return f"{base}/?workspaceNotice={identifier}"


async def prepare(
    c: AsyncConnection, identifier: UUID, token: UUID, settings: Settings
) -> PreparedDelivery | None:
    if settings.telegram_notifications_mode == "off":
        raise Error(409, "Workspace Telegram delivery is disabled")
    row = await locked(c, identifier, token)
    now = datetime.now(UTC)
    if row["state"] != "leased" or row["lease_until"] <= now:
        raise Error(409, "Delivery is not available for a new send")
    target = await recipient(c, row["user_id"])
    if target != (row["telegram_id"], row["identity_revision"]) or not await valid(c, row):
        await c.execute(
            update(d)
            .where(d.c.id == identifier)
            .values(state="skipped", last_error="access_changed", finished_at=now)
        )
        return None
    url = notice_url(settings, identifier)
    expires = now + timedelta(minutes=2)
    await c.execute(
        update(d)
        .where(d.c.id == identifier)
        .values(
            state="sending",
            delivery_mode=settings.telegram_notifications_mode,
            attempts=d.c.attempts + 1,
            lease_until=expires,
        )
    )
    return PreparedDelivery(
        id=identifier,
        telegram_id=row["telegram_id"],
        text=f"{row['title']}\n\n{row['body']}"[:3500],
        button_text="Открыть в Workspace",
        url=url,
        send_allowed=settings.telegram_notifications_mode == "live",
        expires_at=expires,
    )


async def acknowledge(c: AsyncConnection, identifier: UUID, ack: DeliveryAck) -> None:
    row = await locked(c, identifier, ack.lease_token)
    now = datetime.now(UTC)
    final = "sent" if ack.outcome == "sent" else "previewed" if ack.outcome == "preview" else None
    if final and row["state"] == final and row["telegram_message_id"] == ack.telegram_message_id:
        return
    if (
        ack.outcome == "retry"
        and row["state"] in {"pending", "failed"}
        and row["last_error"] == "telegram_rejected"
    ):
        return
    if ack.outcome in {"blocked", "failed"} and row["state"] == "failed":
        return
    if row["state"] not in {"sending", "unknown"}:
        raise Error(409, "Delivery result cannot change this state")
    if final:
        if (
            (ack.outcome == "sent"
            and row["delivery_mode"] != "live")
            or (ack.outcome == "preview"
            and row["delivery_mode"] != "preview")
        ):
            raise Error(409, "A preview cannot become a Telegram send receipt")
        values = dict(
            state=final,
            telegram_message_id=ack.telegram_message_id,
            finished_at=now,
            last_error=None,
        )
    elif ack.outcome == "retry":
        # Only a definite rejection (e.g. rate limiting) may be retried automatically.
        if row["state"] == "unknown":
            raise Error(409, "An ambiguous result needs operator review")
        values = dict(
            state="pending" if row["attempts"] < 5 else "failed",
            retry_at=now + timedelta(seconds=ack.retry_after),
            last_error="telegram_rejected",
            lease_until=None,
        )
    else:
        values = dict(
            state="failed" if ack.outcome in {"blocked", "failed"} else "unknown",
            last_error="telegram_blocked"
            if ack.outcome == "blocked"
            else "telegram_rejected"
            if ack.outcome == "failed"
            else "send_result_unknown",
        )
    await c.execute(update(d).where(d.c.id == identifier).values(**values))


async def open_notice(
    c: AsyncConnection, user: AuthenticatedUser, identifier: UUID
) -> WorkspaceNoticeTarget:
    row = (
        (await c.execute(select(d).where(d.c.id == identifier, d.c.user_id == user.id)))
        .mappings()
        .first()
    )
    if row is None:
        raise Error(404, "Уведомление недоступно этому аккаунту")
    if row["kind"] == "task_assigned":
        from .repository import _task_access_row

        await ensure_module_action(c, user, "tasks", "view")
        await _task_access_row(c, user, row["entity_id"])
        return WorkspaceNoticeTarget(section="tasks", entity_id=str(row["entity_id"]))
    from .repository import validate_attachment_owner

    await ensure_module_action(c, user, "payment_requests", "view")
    await validate_attachment_owner(
        c, user, "approval_request", row["entity_id"], write=False,
    )
    return WorkspaceNoticeTarget(section="payment_requests", entity_id=str(row["entity_id"]))
