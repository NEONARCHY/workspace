from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .errors import WorkspaceRepositoryError
from .tables import chat_members, personal_preferences
from .workspace_schemas import (
    DEFAULT_NAVIGATION,
    NavigationOrder,
    PersonalPreferencesResponse,
    PinnedChatOrder,
)


async def get_preferences(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    *,
    lock: bool = False,
) -> PersonalPreferencesResponse:
    if lock:
        await connection.execute(
            pg_insert(personal_preferences)
            .values(user_id=user.id)
            .on_conflict_do_nothing(index_elements=[personal_preferences.c.user_id])
        )
    statement = select(personal_preferences).where(personal_preferences.c.user_id == user.id)
    if lock:
        statement = statement.with_for_update()
    row = (await connection.execute(statement)).mappings().first()
    if row is None:
        return PersonalPreferencesResponse()
    accessible = {
        str(chat_id)
        for chat_id in (
            await connection.execute(
                select(chat_members.c.chat_id).where(chat_members.c.user_id == user.id)
            )
        ).scalars()
    }
    # Never expose stale identifiers after someone removes a user from a private group.
    archived = [chat_id for chat_id in row["archived_chat_ids"] if chat_id in accessible]
    pinned = [
        chat_id
        for chat_id in row["pinned_chat_ids"]
        if chat_id in accessible and chat_id not in archived
    ]
    navigation = [key for key in row["navigation_order"] if key in DEFAULT_NAVIGATION]
    navigation += [key for key in DEFAULT_NAVIGATION if key not in navigation]
    return PersonalPreferencesResponse(
        pinned_chat_ids=pinned,
        archived_chat_ids=archived,
        navigation_order=navigation,
        revision=row["revision"],
    )


async def save_preferences(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    value: PersonalPreferencesResponse,
) -> PersonalPreferencesResponse:
    value.revision += 1
    await connection.execute(
        update(personal_preferences)
        .where(personal_preferences.c.user_id == user.id)
        .values(**value.model_dump())
    )
    return value


async def change_chat(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    chat_id: str,
    action: str,
) -> PersonalPreferencesResponse:
    value = await get_preferences(connection, user, lock=True)
    accessible = await connection.scalar(
        select(chat_members.c.chat_id).where(
            chat_members.c.user_id == user.id,
            chat_members.c.chat_id == chat_id,
        )
    )
    if accessible is None:
        raise WorkspaceRepositoryError(404, "Чат недоступен")
    if action == "pin":
        if chat_id in value.archived_chat_ids:
            raise WorkspaceRepositoryError(409, "Сначала верните чат из архива")
        if chat_id not in value.pinned_chat_ids:
            if len(value.pinned_chat_ids) >= 100:
                raise WorkspaceRepositoryError(422, "Можно закрепить не более 100 чатов")
            value.pinned_chat_ids.insert(0, chat_id)
    elif action == "unpin":
        value.pinned_chat_ids = [item for item in value.pinned_chat_ids if item != chat_id]
    elif action == "archive":
        value.pinned_chat_ids = [item for item in value.pinned_chat_ids if item != chat_id]
        if chat_id not in value.archived_chat_ids:
            value.archived_chat_ids.append(chat_id)
    elif action == "unarchive":
        value.archived_chat_ids = [item for item in value.archived_chat_ids if item != chat_id]
    else:
        raise WorkspaceRepositoryError(422, "Неизвестное действие")
    return await save_preferences(connection, user, value)


def check_revision(value: PersonalPreferencesResponse, revision: int) -> None:
    if value.revision != revision:
        raise WorkspaceRepositoryError(
            409, "Настройки изменились в другом окне. Обновите данные и повторите действие."
        )


async def reorder_pins(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    payload: PinnedChatOrder,
) -> PersonalPreferencesResponse:
    value = await get_preferences(connection, user, lock=True)
    check_revision(value, payload.revision)
    order = [str(chat_id) for chat_id in payload.chat_ids]
    if set(order) != set(value.pinned_chat_ids):
        raise WorkspaceRepositoryError(409, "Список закреплённых чатов изменился. Обновите данные.")
    value.pinned_chat_ids = order
    return await save_preferences(connection, user, value)


async def reorder_navigation(
    connection: AsyncConnection,
    user: AuthenticatedUser,
    payload: NavigationOrder,
) -> PersonalPreferencesResponse:
    value = await get_preferences(connection, user, lock=True)
    check_revision(value, payload.revision)
    value.navigation_order = payload.order
    return await save_preferences(connection, user, value)
