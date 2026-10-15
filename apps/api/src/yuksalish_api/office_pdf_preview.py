"""Authorized routers call this only AFTER resolving their existing file access scope."""

import asyncio
from pathlib import PurePath

import httpx
from fastapi import HTTPException, Response

from .project_import_documents import MAX_FILE_BYTES, document_type
from .settings import Settings

MAX_PDF_BYTES = 40 * 1024 * 1024
_slots = asyncio.Semaphore(2)
PRIVATE = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}


async def render_word_pdf(settings: Settings, name: str, content: bytes) -> Response:
    extension = PurePath(name).suffix.lower()
    if not content or len(content) > MAX_FILE_BYTES:
        raise HTTPException(422, "Документ превышает 25 МБ или пуст.", headers=PRIVATE)
    if extension == ".docx":
        await asyncio.to_thread(document_type, name, content)
    elif extension != ".doc" or not (
        content.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
        or content.lstrip().startswith(b"{\\rtf")
    ):
        raise HTTPException(422, "Файл не соответствует формату DOC/DOCX.", headers=PRIVATE)
    if not settings.office_preview_socket:
        raise HTTPException(
            503, "Просмотр Word ещё не настроен. Скачайте оригинал.", headers=PRIVATE
        )
    transport = httpx.AsyncHTTPTransport(uds=settings.office_preview_socket, retries=0)
    try:
        async with (
            _slots,
            httpx.AsyncClient(transport=transport, timeout=45) as client,
            client.stream(
                "POST",
                f"http://office-preview/{extension[1:]}",
                content=content,
                headers={"Content-Type": "application/octet-stream"},
            ) as result,
        ):
            if result.status_code == 503:
                raise HTTPException(
                    503, "Просмотрщик занят. Повторите через несколько секунд.", headers=PRIVATE
                )
            if result.status_code == 504:
                raise HTTPException(
                    504,
                    "Документ слишком долго обрабатывается. Скачайте оригинал.",
                    headers=PRIVATE,
                )
            if result.status_code != 200:
                raise HTTPException(
                    422,
                    "Документ повреждён, защищён паролем или не поддерживается.",
                    headers=PRIVATE,
                )
            pdf = bytearray()
            async for chunk in result.aiter_bytes(64 * 1024):
                if len(pdf) + len(chunk) > MAX_PDF_BYTES:
                    raise HTTPException(
                        422, "Предпросмотр превышает допустимый размер.", headers=PRIVATE
                    )
                pdf.extend(chunk)
    except httpx.HTTPError as error:
        raise HTTPException(
            503, "Локальный просмотрщик временно недоступен. Скачайте оригинал.", headers=PRIVATE
        ) from error
    if not pdf.startswith(b"%PDF-"):
        raise HTTPException(422, "Просмотрщик вернул некорректный PDF.", headers=PRIVATE)
    return Response(content=bytes(pdf), media_type="application/pdf", headers=PRIVATE)
