import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest

from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.context_service import CURRENCIES, PLACES, ContextDataService
from yuksalish_api.database import get_connection
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.main import create_app
from yuksalish_api.settings import Settings

NOW = datetime(2026, 10, 15, 3, 0, tzinfo=UTC)


def rates() -> list[dict[str, str]]:
    return [{"Ccy": code, "Date": "15.10.2026", "Rate": "12500.25", "Nominal": "1",
             "Diff": "-1.50"} for code in CURRENCIES]


def conditions() -> list[dict[str, object]]:
    output = []
    for index, place in enumerate(PLACES):
        current = {"time": int(NOW.timestamp()), "temperature_2m": 21.5,
                   "apparent_temperature": 20, "relative_humidity_2m": 48, "is_day": 1,
                   "weather_code": 0, "precipitation": 0, "cloud_cover": 20,
                   "pressure_msl": 1015, "wind_speed_10m": 2.5, "wind_direction_10m": 180,
                   "wind_gusts_10m": 4, "us_aqi": 80, "pm2_5": 20, "pm10": 30,
                   "ozone": 12, "nitrogen_dioxide": 9}
        output.append({"latitude": place[3], "longitude": place[4], "location_id": index,
                       "current": current, "current_units": {
                           "temperature_2m": "°C", "wind_speed_10m": "m/s", "us_aqi": "USAQI",
                       }, "daily": {"temperature_2m_min": [12], "temperature_2m_max": [26],
                                    "sunrise": [int(NOW.timestamp())],
                                    "sunset": [int((NOW + timedelta(hours=12)).timestamp())]}})
    return output


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_rates_exact_nominal_and_date_and_single_flight() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        await asyncio.sleep(.01)
        rows = rates()
        rows[2].update(Nominal="100", Rate="14150", Diff="-6")
        return httpx.Response(200, json=rows)

    service = ContextDataService(httpx.AsyncClient(transport=httpx.MockTransport(handler)),
                                 clock=lambda: NOW)
    try:
        snapshots = await asyncio.gather(*(service.exchange_rates() for _ in range(8)))
        assert len(requests) == 1
        assert "/all/2026-10-15/" in str(requests[0].url)
        assert all(not value.stale for value in snapshots)
        rub = snapshots[0].rates[2]
        assert rub.rate_uzs == Decimal("141.5") and rub.change_uzs == Decimal("-0.06")
        assert snapshots[0].model_dump(mode="json", by_alias=True)["rates"][2]["rateUzs"] == "141.5"
    finally:
        await service.aclose()


@pytest.mark.anyio
@pytest.mark.parametrize("invalid", [[], {"bad": True}, ["invalid-row"],
                                    [{"Ccy": "USD", "Nominal": "0"}]])
async def test_bad_rates_become_recoverable_unavailable(invalid: object) -> None:
    service = ContextDataService(httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json=invalid))), clock=lambda: NOW)
    try:
        with pytest.raises(WorkspaceRepositoryError) as failure:
            await service.exchange_rates()
        assert failure.value.status_code == 503
    finally:
        await service.aclose()


@pytest.mark.anyio
async def test_stale_cache_backoff_expiry_and_midnight() -> None:
    now = NOW
    failed = False
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503) if failed else httpx.Response(200, json=rates())

    service = ContextDataService(httpx.AsyncClient(transport=httpx.MockTransport(handler)),
                                 clock=lambda: now)
    try:
        await service.exchange_rates()
        now += timedelta(minutes=16)
        failed = True
        assert (await service.exchange_rates()).stale
        assert (await service.exchange_rates()).stale
        assert calls == 2
        now += timedelta(days=4)
        with pytest.raises(WorkspaceRepositoryError):
            await service.exchange_rates()
    finally:
        await service.aclose()

    now = datetime(2026, 10, 14, 18, 59, tzinfo=UTC)
    paths: list[str] = []

    def midnight(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        rows = rates()
        for row in rows:
            row["Date"] = "14.10.2026" if len(paths) == 1 else "15.10.2026"
        return httpx.Response(200, json=rows)

    service = ContextDataService(httpx.AsyncClient(transport=httpx.MockTransport(midnight)),
                                 clock=lambda: now)
    try:
        await service.exchange_rates()
        now += timedelta(minutes=2)
        await service.exchange_rates()
        assert paths[0].endswith("2026-10-14/") and paths[1].endswith("2026-10-15/")
    finally:
        await service.aclose()


@pytest.mark.anyio
async def test_weather_points_units_air_failure_and_shared_cache() -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(503) if "air-quality" in request.url.host \
            else httpx.Response(200, json=conditions())

    service = ContextDataService(httpx.AsyncClient(transport=httpx.MockTransport(handler)),
                                 clock=lambda: NOW)
    try:
        data = await service.weather_snapshot()
        assert len(data.locations) == 13
        assert data.locations[0].id == "tashkent-city"
        assert data.locations[10].city == "Нурафшан"
        assert data.weather_stale is False and data.air_stale is True
        assert data.locations[0].weather and data.locations[0].weather.wind_speed == 2.5
        assert all(place.air is None for place in data.locations)
        assert calls[0].url.params["wind_speed_unit"] == "ms"
        await service.weather_snapshot()
        assert len(calls) == 2
        assert "Authorization" not in calls[0].headers
    finally:
        await service.aclose()


@pytest.mark.anyio
@pytest.mark.parametrize("mode", ["count", "order", "units", "old", "nan", "timestamp", "daily"])
async def test_malformed_weather_never_looks_current(mode: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        data = conditions()
        if mode == "count":
            data.pop()
        elif mode == "order":
            data[1]["location_id"] = 0
        elif mode == "units":
            data[0]["current_units"] = {"temperature_2m": "°F", "wind_speed_10m": "km/h"}
        elif mode == "old":
            data[0]["current"] = {"time": int((NOW - timedelta(days=1)).timestamp())}
        elif mode == "timestamp":
            data[0]["current"] = {"time": 1e100}
        elif mode == "daily":
            data[0]["daily"] = {"sunrise": []}
        else:
            data[0]["current"] = {"time": int(NOW.timestamp()), "temperature_2m": "NaN"}
        return httpx.Response(200, json=data)

    service = ContextDataService(httpx.AsyncClient(transport=httpx.MockTransport(handler)),
                                 clock=lambda: NOW)
    try:
        data = await service.weather_snapshot()
        assert data.weather_stale and all(place.weather is None for place in data.locations)
    finally:
        await service.aclose()


@pytest.mark.anyio
async def test_context_routes_require_session_and_delegate_without_database() -> None:
    app = create_app(Settings(environment="test"))
    mocked = AsyncMock(spec=ContextDataService)
    app.state.context_service = mocked
    app.dependency_overrides[get_connection] = lambda: AsyncMock()
    service = ContextDataService(httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json=rates()))), clock=lambda: NOW)
    mocked.exchange_rates.return_value = await service.exchange_rates()
    await service.aclose()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://test") as client:
        assert (await client.get("/api/v1/context/exchange-rates")).status_code == 401
        assert (await client.get("/api/v1/context/weather")).status_code == 401
        mocked.exchange_rates.assert_not_called()
        mocked.weather_snapshot.assert_not_called()
        user = AuthenticatedUser(id=uuid4(), username="context-test", full_name="Context Test",
                                 position_id=None, job_title=None, role="employee")
        app.dependency_overrides[require_user] = lambda: user
        result = await client.get("/api/v1/context/exchange-rates")
        assert result.status_code == 200 and result.json()["rates"][0]["code"] == "USD"
        mocked.exchange_rates.assert_awaited_once()
        mocked.weather_snapshot.return_value = {
            "weatherFetchedAt": None, "airFetchedAt": None,
            "weatherStale": True, "airStale": True, "locations": [],
        }
        result = await client.get("/api/v1/context/weather")
        assert result.status_code == 200 and result.json()["airStale"] is True
        mocked.weather_snapshot.assert_awaited_once()
