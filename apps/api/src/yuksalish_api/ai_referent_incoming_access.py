# ruff: noqa: RUF001
"""Server-side incoming scope. Robot payloads and its local state are unchanged."""

import re
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import Field, model_validator
from sqlalchemy import and_, false, insert, or_, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.sql.elements import ColumnElement

from .access_control import ensure_module_action
from .auth import AuthenticatedUser
from .tables import (
    ai_referent_incoming_access as rules,
)
from .tables import (
    ai_referent_incoming_letters as incoming,
)
from .tables import (
    ai_referent_reviewers,
    audit_events,
    positions,
    users,
)
from .workspace_schemas import ApiModel

IncomingMode = Literal["none", "assigned", "all"]
IncomingRuleMode = Literal["default", "none", "assigned", "all"]

# Exact given-name/surname pairs, not substring/fuzzy matches. Additional patronymics
# are accepted only after the complete pair. Ambiguous accounts/robot IDs fail closed.
_RESPONSIBLE_NAMES = {
    "botir": (
        "ботир мардаев",
        "мардаев ботир",
        "botir mardaev",
        "mardaev botir",
        "botir mardayev",
        "mardayev botir",
    ),
    "saida": (
        "саида мустафаева",
        "мустафаева саида",
        "saida mustafaeva",
        "mustafaeva saida",
        "saida mustafayeva",
        "mustafayeva saida",
    ),
    "askar": (
        "аскар маматханов",
        "маматханов аскар",
        "askar mamatxanov",
        "mamatxanov askar",
        "askar mamatkhanov",
        "mamatkhanov askar",
    ),
}


class IncomingResponsible(ApiModel):
    agent_id: str = Field(min_length=1, max_length=128)
    external_id: str = Field(min_length=1, max_length=160)


class IncomingResponsibleOption(IncomingResponsible):
    display_name: str


class IncomingAccessRule(ApiModel):
    user_id: UUID
    mode: IncomingRuleMode = "default"
    effective_mode: IncomingMode
    responsibles: list[IncomingResponsible] = Field(default_factory=list)
    revision: int = 0


class IncomingAccessUpdate(ApiModel):
    expected_revision: int = Field(ge=0)
    mode: IncomingRuleMode
    responsibles: list[IncomingResponsible] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def validate_bindings(self) -> "IncomingAccessUpdate":
        keys = [(item.agent_id, item.external_id) for item in self.responsibles]
        if len(keys) != len(set(keys)):
            raise ValueError("Ответственный указан повторно.")
        if self.mode == "assigned" and not keys:
            raise ValueError("Выберите ответственного Exat для личного списка писем.")
        if self.mode != "assigned" and keys:
            raise ValueError("Привязки нужны только для назначенных писем.")
        return self


class IncomingAccessConfiguration(ApiModel):
    rules: list[IncomingAccessRule]
    responsibles: list[IncomingResponsibleOption]


class IncomingVisibility(ApiModel):
    incoming_mode: IncomingMode
    can_view_journals: bool
    can_manage_visibility: bool
    revision: int = 0


def named_responsible(value: str) -> str | None:
    name = " ".join(re.findall(r"[^\W\d_]+", value.casefold()))
    for key, aliases in _RESPONSIBLE_NAMES.items():
        if any(name == alias or name.startswith(f"{alias} ") for alias in aliases):
            return key
    return None


def is_leadership_title(value: str) -> bool:
    title = re.sub(r"['‘’ʻʼ`\"«»]", "", value.casefold())
    title = " ".join(title.split())
    return bool(
        re.match(
            r"^(?:(?:yuksalish harakati |yuksalish |harakat )?rais(?:i)?"
            r"(?:\s+orinbosari)?|(?:первый )?заместитель председателя|председатель)"
            r"(?:$|\s+yuksalish\b|\s+юксалиш\b)",
            title,
        )
    )


def require_visibility_admin(user: AuthenticatedUser) -> None:
    if user.role not in {"admin", "superadmin"}:
        raise HTTPException(403, "Видимость писем настраивает только администратор.")


async def default_incoming_mode(
    connection: AsyncConnection, user: AuthenticatedUser
) -> IncomingMode:
    if user.role in {"admin", "superadmin"}:
        return "all"
    if named_responsible(user.full_name):
        return "assigned"
    # Existing explicitly administered chair/deputy bindings; Askar remains scoped.
    leader = await connection.scalar(
        select(ai_referent_reviewers.c.key)
        .where(
            ai_referent_reviewers.c.user_id == user.id,
            ai_referent_reviewers.c.key.in_(("bobur", "umid", "davronbek")),
            ai_referent_reviewers.c.enabled.is_(True),
        )
        .limit(1)
    )
    if leader:
        return "all"
    title = (
        await connection.scalar(select(positions.c.name).where(positions.c.id == user.position_id))
        if user.position_id
        else user.job_title
    )
    return "all" if is_leadership_title(title or "") else "none"


async def effective_incoming_mode(
    connection: AsyncConnection, user: AuthenticatedUser, row: RowMapping | None = None
) -> IncomingMode:
    if user.role in {"admin", "superadmin"}:
        return "all"
    if row is None:
        row = (
            (await connection.execute(select(rules).where(rules.c.user_id == user.id)))
            .mappings()
            .one_or_none()
        )
    if row and row["mode"] != "default":
        if row["mode"] == "all":
            return "all"
        if row["mode"] == "assigned":
            return "assigned"
        return "none"
    return await default_incoming_mode(connection, user)


async def incoming_visibility(
    connection: AsyncConnection, user: AuthenticatedUser
) -> IncomingVisibility:
    await ensure_module_action(connection, user, "ai_referent", "view")
    rule = (
        (await connection.execute(select(rules).where(rules.c.user_id == user.id)))
        .mappings()
        .one_or_none()
    )
    mode = await effective_incoming_mode(connection, user, rule)
    return IncomingVisibility(
        incoming_mode=mode,
        can_view_journals=mode == "all",
        can_manage_visibility=user.role in {"admin", "superadmin"},
        revision=rule["revision"] if rule else 0,
    )


async def incoming_scope(
    connection: AsyncConnection, user: AuthenticatedUser
) -> tuple[IncomingMode, ColumnElement[bool] | None]:
    await ensure_module_action(connection, user, "ai_referent", "view")
    rule = (
        (await connection.execute(select(rules).where(rules.c.user_id == user.id)))
        .mappings()
        .one_or_none()
    )
    mode = await effective_incoming_mode(connection, user, rule)
    if mode == "none":
        raise HTTPException(403, "Доступ к входящим письмам закрыт администратором.")
    if mode == "all":
        return mode, None
    if rule and rule["mode"] == "assigned":
        bindings = [IncomingResponsible.model_validate(item) for item in rule["responsibles"]]
        return mode, or_(
            *[
                and_(
                    incoming.c.agent_id == item.agent_id,
                    incoming.c.responsible_external_id == item.external_id,
                )
                for item in bindings
            ]
        ) if bindings else false()
    identity = named_responsible(user.full_name)
    if not identity:
        return mode, false()
    accounts = (
        (
            await connection.execute(
                select(users.c.id, users.c.full_name).where(users.c.status == "active")
            )
        )
        .mappings()
        .all()
    )
    matches = [row["id"] for row in accounts if named_responsible(row["full_name"]) == identity]
    if matches != [user.id]:
        return mode, false()
    sources = (
        (
            await connection.execute(
                select(
                    incoming.c.agent_id,
                    incoming.c.responsible_external_id,
                    incoming.c.responsible_display_name,
                ).distinct()
            )
        )
        .mappings()
        .all()
    )
    matching = [
        row
        for row in sources
        if named_responsible(row["responsible_display_name"] or "") == identity
    ]
    # A homonym with another robot ID must be resolved explicitly by an admin.
    agents: dict[str, set[str]] = {}
    for row in matching:
        agents.setdefault(row["agent_id"], set()).add(row["responsible_external_id"])
    clauses = [
        and_(
            incoming.c.agent_id == row["agent_id"],
            incoming.c.responsible_external_id == row["responsible_external_id"],
            incoming.c.responsible_display_name == row["responsible_display_name"],
        )
        for row in matching
        if len(agents[row["agent_id"]]) == 1
    ]
    return mode, or_(*clauses) if clauses else false()


async def require_full_incoming_access(
    connection: AsyncConnection, user: AuthenticatedUser
) -> None:
    visibility = await incoming_visibility(connection, user)
    if not visibility.can_view_journals:
        raise HTTPException(403, "Общий архив и журналы доступны только с полным доступом.")


def _account(row: RowMapping) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=row["id"],
        username=row["username"],
        full_name=row["full_name"],
        role=row["role"],
        position_id=row["position_id"],
        department_id=row["department_id"],
        job_title=row["job_title"],
    )


async def _rule_response(
    connection: AsyncConnection, user: AuthenticatedUser, row: RowMapping | None
) -> IncomingAccessRule:
    return IncomingAccessRule(
        user_id=user.id,
        mode=row["mode"] if row else "default",
        effective_mode=await effective_incoming_mode(connection, user, row),
        responsibles=row["responsibles"] if row else [],
        revision=row["revision"] if row else 0,
    )


async def read_incoming_access(
    connection: AsyncConnection, user: AuthenticatedUser
) -> IncomingAccessConfiguration:
    require_visibility_admin(user)
    await ensure_module_action(connection, user, "ai_referent", "admin")
    accounts = (
        (await connection.execute(select(users).order_by(users.c.full_name))).mappings().all()
    )
    saved = {
        row["user_id"]: row for row in (await connection.execute(select(rules))).mappings().all()
    }
    sources = (
        (
            await connection.execute(
                select(
                    incoming.c.agent_id,
                    incoming.c.responsible_external_id,
                    incoming.c.responsible_display_name,
                )
                .where(incoming.c.responsible_external_id != "")
                .distinct()
                .order_by(incoming.c.responsible_display_name)
            )
        )
        .mappings()
        .all()
    )
    # One option per stable (agent, external ID); never expose letter contents here.
    options = {
        (row["agent_id"], row["responsible_external_id"]): IncomingResponsibleOption(
            agent_id=row["agent_id"],
            external_id=row["responsible_external_id"],
            display_name=row["responsible_display_name"] or row["responsible_external_id"],
        )
        for row in sources
    }
    return IncomingAccessConfiguration(
        rules=[
            await _rule_response(connection, _account(row), saved.get(row["id"]))
            for row in accounts
        ],
        responsibles=list(options.values()),
    )


async def save_incoming_access(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    user_id: UUID,
    payload: IncomingAccessUpdate,
) -> IncomingAccessRule:
    require_visibility_admin(actor)
    await ensure_module_action(connection, actor, "ai_referent", "admin")
    # Lock even an absent rule's owner to serialize first inserts (revision zero).
    account = (
        (await connection.execute(select(users).where(users.c.id == user_id).with_for_update()))
        .mappings()
        .one_or_none()
    )
    if account is None:
        raise HTTPException(404, "Сотрудник не найден.")
    if account["role"] in {"admin", "superadmin"}:
        raise HTTPException(422, "Администраторы всегда видят все письма.")
    previous = (
        (
            await connection.execute(
                select(rules).where(rules.c.user_id == user_id).with_for_update()
            )
        )
        .mappings()
        .one_or_none()
    )
    revision = previous["revision"] if previous else 0
    if revision != payload.expected_revision:
        raise HTTPException(409, "Видимость уже изменена. Обновите настройки и повторите.")
    for source in payload.responsibles:
        exists = await connection.scalar(
            select(incoming.c.id)
            .where(
                incoming.c.agent_id == source.agent_id,
                incoming.c.responsible_external_id == source.external_id,
            )
            .limit(1)
        )
        if exists is None:
            raise HTTPException(422, "Ответственный ещё не получен от Exat.")
    now = datetime.now(UTC)
    values = {
        "mode": payload.mode,
        "responsibles": [item.model_dump(mode="json") for item in payload.responsibles],
        "revision": revision + 1,
        "updated_by_user_id": actor.id,
        "updated_at": now,
    }
    if previous:
        await connection.execute(update(rules).where(rules.c.user_id == user_id).values(**values))
    else:
        await connection.execute(insert(rules).values(user_id=user_id, **values))
    await connection.execute(
        insert(audit_events).values(
            id=uuid4(),
            actor_user_id=actor.id,
            action="ai_referent.incoming_visibility_updated",
            target_type="user",
            target_id=user_id,
            details={
                "before": {
                    "mode": previous["mode"] if previous else "default",
                    "responsibles": previous["responsibles"] if previous else [],
                },
                "after": {"mode": payload.mode, "responsibles": values["responsibles"]},
            },
            created_at=now,
        )
    )
    saved = (
        (await connection.execute(select(rules).where(rules.c.user_id == user_id))).mappings().one()
    )
    return await _rule_response(connection, _account(account), saved)
