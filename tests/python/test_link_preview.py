import asyncio
import socket

import pytest

from yuksalish_api.link_preview import UnsafePreviewUrl, _assert_public_url, _platform_preview


def test_youtube_links_use_privacy_enhanced_embed() -> None:
    preview = _platform_preview("https://youtu.be/dQw4w9WgXcQ")

    assert preview is not None
    assert preview.kind == "youtube"
    assert preview.embed_url == "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"


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
