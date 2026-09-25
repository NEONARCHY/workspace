"""Private voice comments bound to a decision and the exact letter revision."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import insert, select
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection

from .ai_referent_schemas import AIReferentCommentAudio
from .auth import AuthenticatedUser
from .object_storage import ObjectStorage
from .tables import ai_referent_comment_audio as audio


def audio_response(row: RowMapping) -> AIReferentCommentAudio:
    return AIReferentCommentAudio(
        id=str(row["id"]),
        content_type=row["content_type"],
        duration_ms=row["duration_ms"],
        byte_size=row["byte_size"],
    )


async def save_audio(
    connection: AsyncConnection,
    storage: ObjectStorage,
    user: AuthenticatedUser,
    letter_id: UUID,
    revision: int,
    duration_ms: int,
    content: bytes,
    content_type: str,
) -> AIReferentCommentAudio:
    # Import locally: the workflow reads published audio metadata, not this upload action.
    from .ai_referent_service import load_letter

    letter = await load_letter(connection, user, letter_id)
    if letter.revision != revision:
        raise HTTPException(409, "Письмо изменилось. Откройте актуальное решение.")
    if "return_for_revision" not in letter.available_actions:
        raise HTTPException(403, "Сейчас вы не можете вернуть это письмо.")
    ogg = content.startswith(b"OggS") and b"OpusHead" in content[:65536]
    webm = content.startswith(b"\x1a\x45\xdf\xa3") and b"OpusHead" in content[:65536]
    if not (
        (ogg and content_type in {"audio/ogg", "audio/opus"})
        or (webm and content_type in {"audio/webm", "video/webm"})
    ):
        raise HTTPException(422, "Нужна голосовая запись Opus в OGG или WebM.")
    if not 1 <= duration_ms <= 300000 or len(content) > 10 * 1024 * 1024:
        raise HTTPException(422, "Голосовой комментарий: не более 5 минут и 10 МБ.")
    audio_id = uuid4()
    key = f"ai-referent/comments/{letter_id}/{audio_id}"
    mime = "audio/ogg" if ogg else "audio/webm"
    await storage.put(key, content, mime)
    row = (
        (
            await connection.execute(
                insert(audio)
                .values(
                    id=audio_id,
                    letter_id=letter_id,
                    user_id=user.id,
                    revision=revision,
                    storage_key=key,
                    content_type=mime,
                    byte_size=len(content),
                    duration_ms=duration_ms,
                    created_at=datetime.now(UTC),
                )
                .returning(audio)
            )
        )
        .mappings()
        .one()
    )
    return audio_response(row)


async def decision_audio(
    connection: AsyncConnection,
    audio_id: UUID,
    letter_id: UUID,
    user_id: UUID,
    revision: int,
) -> RowMapping:
    row = (
        (
            await connection.execute(
                select(audio).where(
                    audio.c.id == audio_id,
                    audio.c.letter_id == letter_id,
                    audio.c.user_id == user_id,
                    audio.c.revision == revision,
                )
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(422, "Голосовой комментарий не относится к текущему решению.")
    return row
