# ruff: noqa: RUF001 - Russian user-facing copy is intentional.
"""Authenticated assistant, birthday settings and greetings."""

from datetime import date
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.assistant_service import (
    AssistantModel,
    ask_assistant,
    generate_text,
    message_history,
)
from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.birthday_service import get_birthday, set_birthday
from yuksalish_api.database import get_connection
from yuksalish_api.tables import feed_posts, users

router = APIRouter(prefix="/assistant", tags=["assistant"])
User = Annotated[AuthenticatedUser, Depends(require_user)]
Connection = Annotated[AsyncConnection, Depends(get_connection)]


class AskRequest(BaseModel):
    model: AssistantModel = "flash"
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("message")
    @classmethod
    def nonblank_message(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Напишите сообщение")
        return value.strip()


class BirthdayRequest(BaseModel):
    month: int | None = Field(default=None, ge=1, le=12)
    day: int | None = Field(default=None, ge=1, le=31)

    @model_validator(mode="after")
    def valid_day(self) -> "BirthdayRequest":
        if self.month is None and self.day is None:
            return self
        if self.month is None or self.day is None:
            raise ValueError("Укажите и день, и месяц")
        try:
            date(2000, self.month, self.day)
        except ValueError as error:
            raise ValueError("Несуществующая дата рождения") from error
        return self


class GreetingRequest(BaseModel):
    post_id: UUID
    language: Annotated[str, Field(pattern="^(ru|uz_latn|uz_cyrl)$")]


@router.get("/messages")
async def get_messages(user: User, connection: Connection) -> list[dict[str, str]]:
    return await message_history(connection, user.id)


@router.post("/messages")
async def post_message(
    payload: AskRequest, user: User, connection: Connection, request: Request,
) -> dict[str, str]:
    key = request.app.state.settings.gemini_api_key.get_secret_value()
    try:
        return await ask_assistant(connection, user, key, payload.model, payload.message.strip())
    except OverflowError as error:
        raise HTTPException(429, str(error)) from error
    except ValueError as error:
        raise HTTPException(503 if not key else 502, str(error)) from error
    except (httpx.HTTPError, KeyError, TypeError, IndexError) as error:
        raise HTTPException(502, "Ассистент временно недоступен. Попробуйте ещё раз.") from error


@router.get("/birthday")
async def birthday(user: User, connection: Connection) -> dict[str, int | None]:
    return await get_birthday(connection, user.id)


@router.put("/birthday")
async def update_birthday(
    payload: BirthdayRequest, user: User, connection: Connection,
) -> dict[str, int | None]:
    return await set_birthday(connection, user.id, payload.month, payload.day)


@router.post("/birthday-greeting")
async def birthday_greeting(
    payload: GreetingRequest, user: User, connection: Connection, request: Request,
) -> dict[str, str]:
    row = (
        await connection.execute(
            select(feed_posts.c.birthday_user_id, users.c.full_name)
            .join(users, users.c.id == feed_posts.c.birthday_user_id)
            .where(feed_posts.c.id == payload.post_id, feed_posts.c.system_kind == "birthday")
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(404, "Поздравление не найдено")
    if row.birthday_user_id == user.id:
        raise HTTPException(403, "Нельзя генерировать поздравление самому себе")
    key = request.app.state.settings.gemini_api_key.get_secret_value()
    language = {"ru": "русском", "uz_latn": "узбекском (латиница)",
                "uz_cyrl": "узбекском (кириллица)"}[payload.language]
    try:
        text = await generate_text(
            key, "flash-lite",
            f"Напиши тёплое естественное поздравление с днём рождения на {language} языке "
            f"для коллеги {row.full_name}. От лица одного коллеги, 2–3 коротких предложения. "
            "Без выдуманных фактов, должности, возраста, пафоса и подписи. "
            "Только текст поздравления.",
            [{"role": "user", "parts": [{"text": "Составь поздравление."}]}],
        )
    except ValueError as error:
        raise HTTPException(503 if not key else 502, str(error)) from error
    except (httpx.HTTPError, KeyError, TypeError, IndexError) as error:
        raise HTTPException(502, "Не удалось создать поздравление. Попробуйте ещё раз.") from error
    return {"text": text}
