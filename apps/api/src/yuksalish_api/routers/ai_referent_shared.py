# ruff: noqa: RUF001
"""Narrow agent API with Russian errors; Telegram is never a general Workspace session."""

import hashlib
from collections.abc import Callable, Coroutine
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from urllib.parse import quote
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.routing import APIRoute
from pydantic import Field
from sqlalchemy import String, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from ..access_control import ensure_module_action
from ..ai_referent_agent_service import claim_job, complete_job, heartbeat_job
from ..ai_referent_configuration_schemas import ReviewerConfigurationResponse
from ..ai_referent_configuration_service import read_configuration
from ..ai_referent_files_service import (
    file_metadata,
    packet_download_filename,
    packet_entries,
    packet_zip,
    read_limited_packet,
    require_packet_access,
    store_packet_file,
)
from ..ai_referent_recipient_service import (
    RecipientRegistry,
    RecipientSnapshot,
    load_recipients,
    sync_recipients,
)
from ..ai_referent_schemas import (
    AIReferentActionRequest,
    AIReferentLetterResponse,
    AIReferentRegistryResponse,
    CreateAIReferentLetterRequest,
    UpdateAIReferentLetterRequest,
)
from ..ai_referent_service import (
    AIReferentServiceError,
    act_on_letter,
    create_letter,
    load_letter,
    load_letters,
    update_letter,
)
from ..ai_referent_shared_service import (
    claim_notifications,
    consume_link_code,
    issue_link_code,
    telegram_actor,
    telegram_id_for,
)
from ..auth import AuthenticatedUser, require_user
from ..database import get_connection
from ..object_storage import ObjectStorageError
from ..tables import (
    ai_referent_archive,
    ai_referent_configuration,
    ai_referent_files,
    ai_referent_incoming_letters,
    ai_referent_letters,
    ai_referent_number_counters,
    ai_referent_telegram_links,
    ai_referent_telegram_outbox,
    attachments,
)
from ..tables import (
    ai_referent_delivery_commands as commands,
)
from ..workspace_schemas import ApiModel, AttachmentResponse
from .ai_referent import _storage, require_agent_token
from .workspace import put_attachment


class SharedRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[object, object, Response]]:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            try:
                return await original(request)
            except AIReferentServiceError as error:
                raise HTTPException(error.status_code, error.detail) from error
            except ObjectStorageError as error:
                raise HTTPException(503, "Хранилище файлов временно недоступно.") from error

        return handler


router = APIRouter(prefix="/ai-referent", tags=["ai-referent-shared"], route_class=SharedRoute)
Connection = Annotated[AsyncConnection, Depends(get_connection)]
User = Annotated[AuthenticatedUser, Depends(require_user)]
Kind = Literal["outgoing", "incoming", "archive", "journal"]


class LinkRequest(ApiModel):
    telegram_id: str = Field(pattern=r"^[1-9][0-9]{0,15}$")
    code: str = Field(min_length=20, max_length=100)


class AgentLease(ApiModel):
    agent_id: str = Field(pattern=r"^[A-Za-z0-9_.-]{1,128}$")
    lease_token: UUID


class AgentResult(AgentLease):
    outcome: Literal["prepared", "sent", "failed", "unknown"]
    detail: str = Field(default="", max_length=2000)


class NotificationAck(ApiModel):
    lease_token: UUID
    delivered: bool
    error: str = Field(default="", max_length=500)


class ArchiveItem(ApiModel):
    external_id: str = Field(min_length=1, max_length=160)
    display_number: str = Field(max_length=100)
    outgoing_number: int = Field(ge=1, le=99999999)
    year_suffix: str = Field(pattern=r"^[0-9]{2}$")
    subject: str = Field(max_length=500)
    sender_name: str = Field(max_length=300)
    recipient_organization: str = Field(max_length=500)
    route: str = Field(max_length=32)
    status: str = Field(max_length=64)
    sent_at: datetime | None = None


async def agent_actor(
    connection: Connection,
    telegram_id: Annotated[
        str, Header(alias="X-AI-Referent-Telegram-Id", pattern=r"^[1-9][0-9]{0,15}$")
    ],
    _: Annotated[None, Depends(require_agent_token)],
) -> AuthenticatedUser:
    return await telegram_actor(connection, telegram_id)


Actor = Annotated[AuthenticatedUser, Depends(agent_actor)]


@router.put("/agent/recipients", dependencies=[Depends(require_agent_token)])
async def put_agent_recipients(
    payload: RecipientSnapshot, connection: Connection
) -> dict[str, str]:
    return {"revision": await sync_recipients(connection, payload)}


@router.get("/recipients", response_model=RecipientRegistry)
async def get_recipients(
    connection: Connection,
    user: User,
    query: Annotated[str, Query(max_length=160)] = "",
    category: Annotated[
        str, Query(pattern=r"^(|ministries|agencies|committees|other|international)$")
    ] = "",
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=30)] = 8,
) -> RecipientRegistry:
    await ensure_module_action(connection, user, "ai_referent", "view")
    return await load_recipients(connection, query, category, offset, limit)


@router.get("/agent/reviewers", response_model=ReviewerConfigurationResponse)
async def agent_reviewers(connection: Connection, actor: Actor) -> ReviewerConfigurationResponse:
    result = await read_configuration(connection)
    result.reviewers = [item.model_copy(update={"telegram_id": None}) for item in result.reviewers]
    return result.model_copy(update={"runtimes": []})


@router.get("/telegram-link")
async def get_link(connection: Connection, user: User) -> dict[str, object]:
    return {"telegramId": await telegram_id_for(connection, user.id)}


@router.post("/telegram-link")
async def post_link(connection: Connection, user: User) -> dict[str, object]:
    return await issue_link_code(connection, user)


@router.delete("/telegram-link", status_code=204)
async def delete_link(connection: Connection, user: User) -> Response:
    await connection.execute(
        update(ai_referent_telegram_links)
        .where(
            ai_referent_telegram_links.c.user_id == user.id,
        )
        .values(telegram_id=None, code_hash=None, code_expires_at=None)
    )
    return Response(status_code=204)


@router.post("/agent/telegram-link", status_code=204, dependencies=[Depends(require_agent_token)])
async def bind_link(payload: LinkRequest, connection: Connection) -> Response:
    await consume_link_code(connection, payload.telegram_id, payload.code)
    return Response(status_code=204)


@router.get("/agent/letters", response_model=AIReferentRegistryResponse)
async def get_agent_letters(
    connection: Connection,
    actor: Actor,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> AIReferentRegistryResponse:
    return await load_letters(connection, actor, offset=offset, limit=limit)


@router.get("/agent/letters/{letter_id}", response_model=AIReferentLetterResponse)
async def get_agent_letter(
    letter_id: UUID, connection: Connection, actor: Actor
) -> AIReferentLetterResponse:
    return await load_letter(connection, actor, letter_id)


@router.post("/agent/letters", response_model=AIReferentLetterResponse)
async def create_agent_letter(
    payload: CreateAIReferentLetterRequest, request: Request, connection: Connection, actor: Actor
) -> AIReferentLetterResponse:
    result = await create_letter(connection, actor, payload)
    if result.source == "workspace":
        await connection.execute(
            update(ai_referent_letters)
            .where(ai_referent_letters.c.id == UUID(result.id))
            .values(source="telegram")
        )
        result.source = "telegram"
    await request.app.state.event_bus.publish(
        {"type": "ai_referent.updated", "entityId": result.id}
    )
    return result


@router.patch("/agent/letters/{letter_id}", response_model=AIReferentLetterResponse)
async def patch_agent_letter(
    letter_id: UUID,
    payload: UpdateAIReferentLetterRequest,
    request: Request,
    connection: Connection,
    actor: Actor,
) -> AIReferentLetterResponse:
    result = await update_letter(connection, actor, letter_id, payload)
    await request.app.state.event_bus.publish(
        {"type": "ai_referent.updated", "entityId": result.id}
    )
    return result


@router.post("/agent/letters/{letter_id}/actions", response_model=AIReferentLetterResponse)
async def agent_letter_action(
    letter_id: UUID,
    payload: AIReferentActionRequest,
    request: Request,
    connection: Connection,
    actor: Actor,
) -> AIReferentLetterResponse:
    result = await act_on_letter(connection, actor, letter_id, payload)
    await request.app.state.event_bus.publish(
        {"type": "ai_referent.updated", "entityId": result.id}
    )
    return result


@router.put("/agent/letters/{letter_id}/attachment", response_model=AttachmentResponse)
async def agent_attachment(
    letter_id: UUID,
    request: Request,
    connection: Connection,
    actor: Actor,
    file_name: Annotated[str, Query(alias="fileName", min_length=1, max_length=500)],
    role: Literal["primary", "additional"] = "primary",
) -> AttachmentResponse:
    # Exact-content retry does not create a second attachment. Stream bounds and
    # owner/permission checks are shared with the regular upload endpoint.
    return await put_attachment(
        "ai_referent_letter",
        letter_id,
        request,
        actor,
        connection,
        file_name,
        role,
        "file",
        None,
        None,
    )


@router.get("/packets/{kind}/{owner_id}")
async def get_packet(
    kind: Kind, owner_id: UUID, connection: Connection, user: User
) -> dict[str, object]:
    await require_packet_access(connection, user, kind, owner_id)
    return {"files": await packet_entries(connection, kind, owner_id)}


@router.get("/agent/packets/{kind}/{owner_id}")
async def agent_packet(
    kind: Kind, owner_id: UUID, connection: Connection, actor: Actor
) -> dict[str, object]:
    return await get_packet(kind, owner_id, connection, actor)


@router.get("/packets/{kind}/{owner_id}/zip")
async def download_packet(
    kind: Kind, owner_id: UUID, request: Request, connection: Connection, user: User
) -> Response:
    await require_packet_access(connection, user, kind, owner_id)
    filename = await packet_download_filename(connection, kind, owner_id)
    return Response(
        await packet_zip(connection, _storage(request), kind, owner_id),
        media_type="application/zip",
        headers={
            "Content-Disposition": "attachment; filename=\"letter.zip\"; filename*=UTF-8''"
            + quote(filename),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/packets/{kind}/{owner_id}/files/{file_id}")
async def download_packet_file(
    kind: Kind,
    owner_id: UUID,
    file_id: UUID,
    request: Request,
    connection: Connection,
    user: User,
    source: Literal["packet", "attachment"] = "packet",
) -> Response:
    await require_packet_access(connection, user, kind, owner_id)
    row = await file_metadata(connection, kind, owner_id, file_id, source)
    content = await _storage(request).get(row["storage_key"])
    if hashlib.sha256(content).hexdigest() != row["sha256"]:
        raise HTTPException(503, "Контрольная сумма файла не совпала.")
    name = row.get("file_name") or row.get("relative_path")
    return Response(
        content,
        media_type=row["content_type"],
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''"
            + quote(str(name).split("/")[-1]),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/agent/packets/{kind}/{owner_id}/files/{file_id}")
async def agent_download_file(
    kind: Kind,
    owner_id: UUID,
    file_id: UUID,
    request: Request,
    connection: Connection,
    actor: Actor,
    source: Literal["packet", "attachment"] = "packet",
) -> Response:
    return await download_packet_file(kind, owner_id, file_id, request, connection, actor, source)


@router.put("/agent/files/{kind}/{owner_id}", dependencies=[Depends(require_agent_token)])
async def upload_packet_file(
    kind: Kind,
    owner_id: UUID,
    request: Request,
    connection: Connection,
    name: Annotated[str, Query(min_length=1, max_length=500)],
    agent_id: Annotated[str, Query(alias="agentId", pattern=r"^[A-Za-z0-9_.-]{1,128}$")],
    job_id: Annotated[UUID | None, Query(alias="jobId")] = None,
    lease_token: Annotated[UUID | None, Query(alias="leaseToken")] = None,
) -> dict[str, object]:
    if kind == "outgoing":
        if job_id is None or lease_token is None:
            raise HTTPException(403, "Требуется действующее задание.")
        await heartbeat_job(connection, job_id, lease_token, agent_id)
        job_owner = await connection.scalar(
            select(commands.c.letter_id).where(commands.c.id == job_id)
        )
        if job_owner != owner_id:
            raise HTTPException(403, "Файл не относится к заданию.")
    elif kind == "journal":
        if owner_id != uuid5(NAMESPACE_URL, f"ai-journal:{agent_id}"):
            raise HTTPException(403, "Неверный владелец журнала.")
    else:
        table = ai_referent_incoming_letters if kind == "incoming" else ai_referent_archive
        exists = await connection.scalar(
            select(table.c.id).where(table.c.id == owner_id, table.c.agent_id == agent_id)
        )
        if not exists:
            raise HTTPException(404, "Сначала синхронизируйте запись реестра.")
    content = await read_limited_packet(
        request.stream(), request.app.state.settings.ai_referent_packet_max_bytes
    )
    if kind == "outgoing" and name.startswith("signed/") and not content.startswith(b"%PDF-"):
        raise HTTPException(422, "Ожидается подписанный PDF.")
    return await store_packet_file(
        connection,
        _storage(request),
        kind=kind,
        owner_id=owner_id,
        name=name,
        content=content,
        content_type=request.headers.get("content-type", "application/octet-stream")[:160],
    )


@router.post("/agent/jobs/claim", dependencies=[Depends(require_agent_token)])
async def post_claim(
    connection: Connection,
    agent_id: Annotated[str, Query(alias="agentId", pattern=r"^[A-Za-z0-9_.-]{1,128}$")],
) -> dict[str, object]:
    return {"job": await claim_job(connection, agent_id)}


@router.post("/agent/ready", status_code=204, dependencies=[Depends(require_agent_token)])
async def agent_ready(
    connection: Connection,
    agent_id: Annotated[str, Query(alias="agentId", pattern=r"^[A-Za-z0-9_.-]{1,128}$")],
) -> Response:
    assigned = await connection.scalar(
        select(ai_referent_configuration.c.execution_agent_id).with_for_update()
    )
    if assigned and assigned != agent_id:
        raise HTTPException(
            409, "Другой агент уже отвечает за отправку. Не запускайте второй робот."
        )
    await connection.execute(
        update(ai_referent_configuration)
        .where(ai_referent_configuration.c.id == 1)
        .values(execution_agent_id=agent_id)
    )
    return Response(status_code=204)


@router.post(
    "/agent/jobs/{job_id}/heartbeat", status_code=204, dependencies=[Depends(require_agent_token)]
)
async def job_heartbeat(job_id: UUID, payload: AgentLease, connection: Connection) -> Response:
    await heartbeat_job(connection, job_id, payload.lease_token, payload.agent_id)
    return Response(status_code=204)


@router.post(
    "/agent/jobs/{job_id}/result", status_code=204, dependencies=[Depends(require_agent_token)]
)
async def job_result(
    job_id: UUID, payload: AgentResult, request: Request, connection: Connection
) -> Response:
    await complete_job(
        connection, job_id, payload.lease_token, payload.agent_id, payload.outcome, payload.detail
    )
    await request.app.state.event_bus.publish(
        {"type": "ai_referent.updated", "entityId": str(job_id)}
    )
    return Response(status_code=204)


@router.get("/agent/jobs/{job_id}/files/{file_id}", dependencies=[Depends(require_agent_token)])
async def job_file(
    job_id: UUID,
    file_id: UUID,
    request: Request,
    connection: Connection,
    lease: Annotated[UUID, Query(alias="leaseToken")],
    agent_id: Annotated[str, Query(alias="agentId")],
) -> Response:
    await heartbeat_job(connection, job_id, lease, agent_id)
    owner = await connection.scalar(select(commands.c.letter_id).where(commands.c.id == job_id))
    row = (
        (
            await connection.execute(
                select(attachments).where(
                    attachments.c.id == file_id,
                    attachments.c.owner_type == "ai_referent_letter",
                    attachments.c.owner_id == owner,
                )
            )
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise HTTPException(404, "Файл задания не найден.")
    return Response(await _storage(request).get(row["storage_key"]), media_type=row["content_type"])


@router.post("/agent/notifications/claim", dependencies=[Depends(require_agent_token)])
async def notification_claim(connection: Connection) -> dict[str, object]:
    return {"notifications": await claim_notifications(connection)}


@router.post(
    "/agent/notifications/{notification_id}/ack",
    status_code=204,
    dependencies=[Depends(require_agent_token)],
)
async def notification_ack(
    notification_id: UUID, payload: NotificationAck, connection: Connection
) -> Response:
    result = await connection.execute(
        update(ai_referent_telegram_outbox)
        .where(
            ai_referent_telegram_outbox.c.id == notification_id,
            ai_referent_telegram_outbox.c.lease_token == payload.lease_token,
        )
        .values(
            delivered_at=datetime.now(UTC) if payload.delivered else None,
            last_error=payload.error,
            lease_until=datetime.now(UTC) + timedelta(minutes=2),
        )
    )
    if result.rowcount != 1:
        raise HTTPException(409, "Устаревшее подтверждение уведомления.")
    return Response(status_code=204)


@router.get("/archive")
async def get_archive(
    connection: Connection,
    user: User,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    query: Annotated[str, Query(max_length=200)] = "",
) -> dict[str, object]:
    await ensure_module_action(connection, user, "ai_referent", "view")
    statement = select(ai_referent_archive)
    if query.strip():
        statement = statement.where(
            ai_referent_archive.c.payload.cast(String).ilike(f"%{query.strip()}%")
        )
    rows = (
        (
            await connection.execute(
                statement.order_by(ai_referent_archive.c.updated_at.desc())
                .offset(offset)
                .limit(limit)
            )
        )
        .mappings()
        .all()
    )
    return {"letters": [{"id": str(row["id"]), **row["payload"]} for row in rows]}


@router.get("/agent/archive")
async def agent_archive(
    connection: Connection,
    actor: Actor,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> dict[str, object]:
    return await get_archive(connection, actor, offset, limit)


@router.put("/agent/archive", dependencies=[Depends(require_agent_token)])
async def sync_archive(
    payload: ArchiveItem,
    connection: Connection,
    agent_id: Annotated[str, Query(alias="agentId", pattern=r"^[A-Za-z0-9_.-]{1,128}$")],
) -> dict[str, object]:
    await connection.execute(select(ai_referent_configuration).with_for_update())
    record_id = uuid5(NAMESPACE_URL, f"ai-archive:{agent_id}:{payload.external_id}")
    statement = pg_insert(ai_referent_archive).values(
        id=record_id,
        agent_id=agent_id,
        external_id=payload.external_id,
        payload=payload.model_dump(mode="json", by_alias=True),
        updated_at=datetime.now(UTC),
    )
    await connection.execute(
        statement.on_conflict_do_update(
            index_elements=[ai_referent_archive.c.id],
            set_={
                "payload": statement.excluded.payload,
                "updated_at": statement.excluded.updated_at,
            },
            where=ai_referent_archive.c.payload != statement.excluded.payload,
        )
    )
    counter = pg_insert(ai_referent_number_counters).values(
        year_suffix=payload.year_suffix,
        last_number=payload.outgoing_number,
        updated_at=datetime.now(UTC),
    )
    await connection.execute(
        counter.on_conflict_do_update(
            index_elements=[ai_referent_number_counters.c.year_suffix],
            set_={
                "last_number": func.greatest(
                    ai_referent_number_counters.c.last_number, payload.outgoing_number
                )
            },
        )
    )
    return {"id": str(record_id)}


@router.get("/agent/incoming/lookup", dependencies=[Depends(require_agent_token)])
async def incoming_lookup(
    connection: Connection,
    agent_id: Annotated[str, Query(alias="agentId")],
    external_id: Annotated[str, Query(alias="externalId")],
) -> dict[str, object]:
    record_id = await connection.scalar(
        select(ai_referent_incoming_letters.c.id).where(
            ai_referent_incoming_letters.c.agent_id == agent_id,
            ai_referent_incoming_letters.c.external_id == external_id,
        )
    )
    if record_id is None:
        raise HTTPException(404, "Входящее ещё не синхронизировано.")
    return {"id": str(record_id)}


@router.get("/journals")
async def journals(connection: Connection, user: User) -> dict[str, object]:
    await ensure_module_action(connection, user, "ai_referent", "view")
    rows = (
        (
            await connection.execute(
                select(ai_referent_files)
                .where(ai_referent_files.c.kind == "journal")
                .order_by(ai_referent_files.c.created_at.desc())
                .limit(200)
            )
        )
        .mappings()
        .all()
    )
    return {
        "files": [
            {
                "id": str(row["id"]),
                "ownerId": str(row["owner_id"]),
                "name": row["relative_path"],
                "byteSize": row["byte_size"],
                "createdAt": row["created_at"].isoformat(),
            }
            for row in rows
        ]
    }
