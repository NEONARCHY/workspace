import asyncio

import httpx
import pytest
from pydantic import SecretStr

from yuksalish_api import members_service
from yuksalish_api.settings import Settings


def test_registry_is_unconfigured_without_a_source_endpoint() -> None:
    async def exercise() -> None:
        members_service._cache = None
        result = await members_service.load_members_registry(Settings(environment="test"))
        assert result.configured is False
        assert result.members == []

    asyncio.run(exercise())


def test_registry_reads_a_signed_read_only_source(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[httpx.Request] = []

    class Client:
        async def __aenter__(self) -> "Client":
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

        async def get(self, url: httpx.URL, *, headers: dict[str, str]) -> httpx.Response:
            request = httpx.Request("GET", url, headers=headers)
            requests.append(request)
            return httpx.Response(
                200,
                request=request,
                json={
                    "configured": True,
                    "generatedAt": "2026-09-16T09:00:00+05:00",
                    "members": [{
                        "id": 1, "firstName": "Баходир", "lastName": "Самугов",
                        "status": "active", "createdAt": "2026-01-01T09:00:00+05:00",
                        "regionId": 13, "regionNameRu": "Ташкент",
                    }],
                    "regions": [{"id": 13, "nameRu": "Ташкент", "nameUz": "Toshkent shahri"}],
                    "spheres": [],
                },
            )

    monkeypatch.setattr("yuksalish_api.members_service.httpx.AsyncClient", lambda **_: Client())

    async def exercise() -> None:
        members_service._cache = None
        result = await members_service.load_members_registry(Settings(
            environment="test",
            members_api_url="https://example.test/workspace-members.php",
            members_integration_key=SecretStr("member-service-test-key"),
        ))
        assert result.configured is True
        assert result.members[0].region_name_ru == "Ташкент"
        assert requests[0].headers["X-Yuksalish-Signature"] == members_service._signature(
            "member-service-test-key",
            requests[0].headers["X-Yuksalish-Timestamp"],
            "/workspace-members.php",
        )

    asyncio.run(exercise())
