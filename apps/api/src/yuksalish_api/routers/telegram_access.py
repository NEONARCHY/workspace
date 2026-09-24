"""Administrator-only hub for Telegram identities and per-bot access."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncConnection

from ..auth import AuthenticatedUser, require_user
from ..database import get_connection
from ..telegram_access_schemas import (
    TelegramAccessPerson,
    TelegramAccessRegistry,
    TelegramAccessUpdate,
    TelegramVerificationCode,
)
from ..telegram_access_service import (
    issue_admin_code,
    list_telegram_access,
    require_telegram_admin,
    save_telegram_access,
)

router = APIRouter(prefix="/telegram-access", tags=["telegram-access"])


@router.get("", response_model=TelegramAccessRegistry)
async def get_access(
    user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TelegramAccessRegistry:
    require_telegram_admin(user)
    return await list_telegram_access(connection)


@router.put("/{user_id}", response_model=TelegramAccessPerson)
async def put_access(
    user_id: UUID,
    payload: TelegramAccessUpdate,
    user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TelegramAccessPerson:
    return await save_telegram_access(connection, user, user_id, payload)


@router.post("/{user_id}/verification-code", response_model=TelegramVerificationCode)
async def post_verification_code(
    user_id: UUID,
    user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TelegramVerificationCode:
    return await issue_admin_code(connection, user, user_id)
