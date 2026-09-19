import asyncio
import ipaddress
import re
import socket
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlparse

import httpx

from yuksalish_api.workspace_schemas import LinkPreviewResponse

MAX_HTML_BYTES = 512 * 1024
MAX_REDIRECTS = 3
YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{6,20}$")


class UnsafePreviewUrl(ValueError):
    pass


class _MetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.values: dict[str, str] = {}
        self.in_title = False
        self.title_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value or "" for key, value in attrs}
        if tag.lower() == "title":
            self.in_title = True
        if tag.lower() != "meta":
            return
        key = (values.get("property") or values.get("name") or "").lower()
        content = values.get("content", "").strip()
        if key and content and key not in self.values:
            self.values[key] = content

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)


def _youtube_id(url: str) -> str | None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    candidate = ""
    if host == "youtu.be":
        candidate = parsed.path.strip("/").split("/")[0]
    elif host in {"youtube.com", "m.youtube.com"}:
        if parsed.path == "/watch":
            candidate = parse_qs(parsed.query).get("v", [""])[0]
        elif parsed.path.startswith(("/shorts/", "/embed/")):
            candidate = parsed.path.split("/")[2]
    return candidate if YOUTUBE_ID.fullmatch(candidate) else None


async def _assert_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username:
        raise UnsafePreviewUrl("Поддерживаются только публичные HTTP(S)-ссылки")
    try:
        records = await asyncio.to_thread(
            socket.getaddrinfo, parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM
        )
    except socket.gaierror as error:
        raise UnsafePreviewUrl("Адрес сайта не найден") from error
    for record in records:
        address = ipaddress.ip_address(record[4][0])
        if not address.is_global:
            raise UnsafePreviewUrl("Локальные и служебные адреса запрещены")


def _platform_preview(url: str) -> LinkPreviewResponse | None:
    video_id = _youtube_id(url)
    if video_id:
        return LinkPreviewResponse(
            url=url,
            canonical_url=f"https://www.youtube.com/watch?v={video_id}",
            kind="youtube",
            title="Видео YouTube",
            site_name="YouTube",
            image_url=f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            embed_url=f"https://www.youtube.com/embed/{video_id}",
        )
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    parts = [part for part in parsed.path.split("/") if part]
    if host == "instagram.com" and len(parts) >= 2 and parts[0] in {"reel", "reels", "p"}:
        media_kind = "reel" if parts[0] in {"reel", "reels"} else "p"
        shortcode = parts[1]
        return LinkPreviewResponse(
            url=url,
            canonical_url=f"https://www.instagram.com/{media_kind}/{shortcode}/",
            kind="instagram",
            title="Публикация Instagram",
            site_name="Instagram",
            embed_url=(
                f"https://www.instagram.com/{media_kind}/{shortcode}/embed/captioned/"
            ),
        )
    return None


async def load_link_preview(url: str) -> LinkPreviewResponse:
    platform = _platform_preview(url)
    if platform:
        return platform

    current_url = url
    async with httpx.AsyncClient(timeout=6, follow_redirects=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            await _assert_public_url(current_url)
            async with client.stream(
                "GET",
                current_url,
                headers={
                    "Accept": "text/html,video/*;q=0.8",
                    "User-Agent": "YuksalishWorkspace/1.0",
                },
            ) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise UnsafePreviewUrl("Сайт вернул некорректное перенаправление")
                    current_url = urljoin(current_url, location)
                    continue
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                if content_type.startswith("video/"):
                    name = urlparse(current_url).path.rsplit("/", 1)[-1] or "Видео"
                    return LinkPreviewResponse(
                        url=url,
                        canonical_url=current_url,
                        kind="video",
                        title=name,
                        site_name=urlparse(current_url).hostname or "Видео",
                    )
                if content_type not in {"text/html", "application/xhtml+xml"}:
                    raise UnsafePreviewUrl("Для этой ссылки превью недоступно")
                chunks = bytearray()
                async for chunk in response.aiter_bytes():
                    chunks.extend(chunk)
                    if len(chunks) > MAX_HTML_BYTES:
                        break
                parser = _MetadataParser()
                parser.feed(
                    bytes(chunks[:MAX_HTML_BYTES]).decode(
                        response.encoding or "utf-8", errors="replace"
                    )
                )
                title = parser.values.get("og:title") or " ".join(parser.title_parts).strip()
                host = urlparse(current_url).hostname or "Ссылка"
                image = parser.values.get("og:image") or parser.values.get("twitter:image")
                image_url = urljoin(current_url, image) if image else None
                if image_url:
                    try:
                        await _assert_public_url(image_url)
                    except UnsafePreviewUrl:
                        image_url = None
                return LinkPreviewResponse(
                    url=url,
                    canonical_url=current_url,
                    kind="page",
                    title=title or host,
                    description=parser.values.get("og:description")
                    or parser.values.get("description", ""),
                    site_name=parser.values.get("og:site_name") or host.removeprefix("www."),
                    image_url=image_url,
                )
    raise UnsafePreviewUrl("Слишком много перенаправлений")
