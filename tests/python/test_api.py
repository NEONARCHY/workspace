import pytest
from httpx import ASGITransport, AsyncClient, Response

from yuksalish_api.main import create_app
from yuksalish_api.settings import Settings


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


async def get(path: str, *, environment: str = "test") -> Response:
    app = create_app(Settings(environment=environment))  # type: ignore[arg-type]
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


@pytest.mark.anyio
async def test_live_health_and_security_headers() -> None:
    response = await get("/api/v1/health/live")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "yuksalish-api",
        "version": "0.5.0",
        "environment": "test",
    }
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"


@pytest.mark.anyio
async def test_ready_health() -> None:
    response = await get("/api/v1/health/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"


@pytest.mark.anyio
async def test_module_catalog_has_all_locales() -> None:
    response = await get("/api/v1/modules")
    payload = response.json()

    assert response.status_code == 200
    assert [module["key"] for module in payload["modules"]] == [
        "crm",
        "tasks",
        "payment_requests",
        "feed",
        "projects",
        "trip_approvals",
        "messenger",
        "calendar",
        "employees",
    ]
    assert all(
        set(module["label"]) == {"ru", "uz_cyrl", "uz_latn"} for module in payload["modules"]
    )


@pytest.mark.anyio
async def test_openapi_is_hidden_in_production() -> None:
    assert (await get("/docs", environment="production")).status_code == 404
