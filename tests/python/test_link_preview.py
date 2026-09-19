import asyncio
import socket

import pytest

from yuksalish_api.link_preview import UnsafePreviewUrl, _assert_public_url, _platform_preview


def test_youtube_links_use_official_embed() -> None:
    preview = _platform_preview("https://youtu.be/dQw4w9WgXcQ")

    assert preview is not None
    assert preview.kind == "youtube"
    assert preview.embed_url == "https://www.youtube.com/embed/dQw4w9WgXcQ"


def test_instagram_links_use_official_public_embed() -> None:
    preview = _platform_preview("https://www.instagram.com/reels/example/")

    assert preview is not None
    assert preview.kind == "instagram"
    assert preview.canonical_url == "https://www.instagram.com/reel/example/"
    assert preview.embed_url == "https://www.instagram.com/reel/example/embed/captioned/"


def test_private_addresses_are_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))],
    )

    with pytest.raises(UnsafePreviewUrl, match="Локальные"):
        asyncio.run(_assert_public_url("https://internal.example/secret"))


def test_public_addresses_are_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))
        ],
    )

    asyncio.run(_assert_public_url("https://example.com/article"))
