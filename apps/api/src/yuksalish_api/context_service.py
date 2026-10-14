"""Fixed public providers, shared bounded caches; never send employee data."""

import asyncio
import json
import math
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Generic, TypeVar
from zoneinfo import ZoneInfo

import httpx
import structlog

from .context_schemas import (
    AirConditions,
    ExchangeRate,
    ExchangeSnapshot,
    PlaceWeather,
    WeatherConditions,
    WeatherSnapshot,
)
from .errors import WorkspaceRepositoryError

# Administrative centres verified through Open-Meteo/GeoNames. Tashkent city
# is separate from Tashkent oblast (Nurafshon); these are point estimates.
PLACES = (
    ("tashkent-city", "Ташкент", "Ташкент", 41.26465, 69.21627),
    ("andijan", "Андижанская область", "Андижан", 40.78338, 72.35067),
    ("bukhara", "Бухарская область", "Бухара", 39.77026, 64.43069),
    ("jizzakh", "Джизакская область", "Джизак", 40.13351, 67.82956),
    ("kashkadarya", "Кашкадарьинская область", "Карши", 38.86056, 65.78905),
    ("navoi", "Навоийская область", "Навои", 40.08444, 65.37917),
    ("namangan", "Наманганская область", "Наманган", 40.9983, 71.67257),
    ("samarkand", "Самаркандская область", "Самарканд", 39.65456, 66.96445),
    ("syrdarya", "Сырдарьинская область", "Гулистан", 40.49536, 68.77542),
    ("surkhandarya", "Сурхандарьинская область", "Термез", 37.22417, 67.27833),
    ("tashkent-region", "Ташкентская область", "Нурафшан", 41.0321, 69.36253),
    ("fergana", "Ферганская область", "Фергана", 40.38421, 71.78432),
    ("khorezm", "Хорезмская область", "Ургенч", 41.55177, 60.63143),
)
CURRENCIES = ("USD", "EUR", "RUB", "KZT", "CHF", "CNY")
T = TypeVar("T")


@dataclass(frozen=True)
class CachedRead(Generic[T]):
    value: T | None
    fetched_at: datetime | None
    stale: bool


class ProviderCache(Generic[T]):
    def __init__(self, name: str, ttl: timedelta, maximum_age: timedelta,
                 clock: Callable[[], datetime]) -> None:
        self.name, self.ttl, self.maximum_age, self.clock = name, ttl, maximum_age, clock
        self.lock = asyncio.Lock()
        self.value: T | None = None
        self.fetched_at: datetime | None = None
        self.key = ""
        self.attempt_key = ""
        self.retry_at = datetime.min.replace(tzinfo=UTC)

    def _last(self, now: datetime) -> CachedRead[T]:
        usable = self.fetched_at is not None and now - self.fetched_at <= self.maximum_age
        return CachedRead(self.value if usable else None, self.fetched_at if usable else None, True)

    async def get(self, load: Callable[[], Awaitable[T]], key: str = "") -> CachedRead[T]:
        async with self.lock:
            now = self.clock()
            if self.fetched_at and self.key == key and now - self.fetched_at < self.ttl:
                return CachedRead(self.value, self.fetched_at, False)
            if self.attempt_key == key and now < self.retry_at:
                return self._last(now)
            self.attempt_key = key
            try:
                value = await load()
            except (httpx.HTTPError, ValueError, TypeError, KeyError, InvalidOperation) as error:
                structlog.get_logger(__name__).warning(
                    "context_provider_unavailable", provider=self.name,
                    error_type=type(error).__name__,
                )
                self.retry_at = now + timedelta(minutes=1)
                return self._last(now)
            self.value, self.fetched_at, self.key = value, self.clock(), key
            self.retry_at = datetime.min.replace(tzinfo=UTC)
            return CachedRead(value, self.fetched_at, False)


def timestamp(value: Any) -> datetime:
    if not isinstance(value, (int, float)) or isinstance(value, bool) \
            or not math.isfinite(value) or not 0 <= value <= 4_102_444_800:
        raise ValueError("Invalid provider timestamp")
    return datetime.fromtimestamp(value, UTC)


class ContextDataService:
    def __init__(self, client: httpx.AsyncClient | None = None,
                 clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self.client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(8, connect=3), follow_redirects=False,
            limits=httpx.Limits(max_connections=6, max_keepalive_connections=3),
        )
        self.clock = clock
        self.exchange = ProviderCache[ExchangeSnapshot](
            "cbu", timedelta(minutes=15), timedelta(days=3), clock,
        )
        self.weather = ProviderCache[list[WeatherConditions]](
            "open-meteo", timedelta(minutes=10), timedelta(hours=2), clock,
        )
        self.air = ProviderCache[list[AirConditions]](
            "cams", timedelta(minutes=30), timedelta(hours=6), clock,
        )

    async def aclose(self) -> None:
        await self.client.aclose()

    async def _json(self, url: str, params: dict[str, str] | None = None) -> Any:
        async with self.client.stream("GET", url, params=params) as response:
            response.raise_for_status()
            content = bytearray()
            async for chunk in response.aiter_bytes():
                content.extend(chunk)
                if len(content) > 1_000_000:
                    raise ValueError("Provider payload is too large")
            return json.loads(content)

    async def exchange_rates(self) -> ExchangeSnapshot:
        day = self.clock().astimezone(ZoneInfo("Asia/Tashkent")).date()

        async def load() -> ExchangeSnapshot:
            rows = await self._json(f"https://cbu.uz/ru/arkhiv-kursov-valyut/json/all/{day}/")
            if not isinstance(rows, list) or len(rows) > 200 \
                    or not all(isinstance(row, dict) for row in rows):
                raise ValueError("Invalid CBU response")
            selected = {row["Ccy"]: row for row in rows if row.get("Ccy") in CURRENCIES}
            dates = {datetime.strptime(selected[code]["Date"], "%d.%m.%Y").date()
                     for code in CURRENCIES}
            if len(dates) != 1 or not day - timedelta(days=14) <= next(iter(dates)) <= day:
                raise ValueError("Invalid CBU effective date")
            rates = []
            for code in CURRENCIES:
                row = selected[code]
                nominal = Decimal(row["Nominal"])
                if not nominal.is_finite() or nominal < 1 or nominal > 1_000_000:
                    raise ValueError("Invalid CBU nominal")
                rates.append(ExchangeRate(
                    code=code, rate_uzs=Decimal(row["Rate"]) / nominal,
                    change_uzs=Decimal(row["Diff"]) / nominal if row.get("Diff") else None,
                ))
            return ExchangeSnapshot(effective_date=next(iter(dates)), fetched_at=self.clock(),
                                    rates=rates)

        result = await self.exchange.get(load, str(day))
        if result.value is None:
            raise WorkspaceRepositoryError(503, "ЦБ временно недоступен. Повторите позже.")
        return result.value.model_copy(update={"stale": result.stale})

    def _coordinates(self) -> dict[str, str]:
        return {"latitude": ",".join(str(p[3]) for p in PLACES),
                "longitude": ",".join(str(p[4]) for p in PLACES), "timeformat": "unixtime"}

    def _rows(self, payload: Any) -> list[dict[str, Any]]:
        if not isinstance(payload, list) or len(payload) != len(PLACES):
            raise ValueError("Invalid location count")
        for index, row in enumerate(payload):
            if not isinstance(row, dict) or row.get("location_id", 0) != index:
                raise ValueError("Invalid location order")
            # Weather cells can differ from requested coordinates by model resolution.
            if abs(row["latitude"] - PLACES[index][3]) > .6 \
                    or abs(row["longitude"] - PLACES[index][4]) > .6:
                raise ValueError("Invalid provider location")
            as_of = timestamp(row["current"]["time"])
            if not self.clock() - timedelta(hours=4) <= as_of \
                    <= self.clock() + timedelta(minutes=30):
                raise ValueError("Invalid current timestamp")
        return payload

    async def _weather(self) -> list[WeatherConditions]:
        payload = await self._json("https://api.open-meteo.com/v1/forecast", {
            **self._coordinates(), "timezone": "Asia/Tashkent", "wind_speed_unit": "ms",
            "forecast_days": "1", "daily": "temperature_2m_max,temperature_2m_min,sunrise,sunset",
            "current": "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,"
            "precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,"
            "wind_direction_10m,wind_gusts_10m",
        })
        output = []
        for row in self._rows(payload):
            units, current, daily = row["current_units"], row["current"], row["daily"]
            daily_fields = ("temperature_2m_min", "temperature_2m_max", "sunrise", "sunset")
            if not all(isinstance(daily.get(key), list) and len(daily[key]) == 1
                       for key in daily_fields):
                raise ValueError("Invalid daily forecast")
            if units["temperature_2m"] != "°C" or units["wind_speed_10m"] != "m/s":
                raise ValueError("Invalid weather units")
            output.append(WeatherConditions(
                as_of=timestamp(current["time"]), temperature=current["temperature_2m"],
                feels_like=current["apparent_temperature"],
                humidity=current["relative_humidity_2m"],
                is_day=current["is_day"] == 1, code=current["weather_code"],
                precipitation=current["precipitation"], cloud_cover=current["cloud_cover"],
                pressure=current["pressure_msl"], wind_speed=current["wind_speed_10m"],
                wind_direction=current["wind_direction_10m"], wind_gusts=current["wind_gusts_10m"],
                today_min=daily["temperature_2m_min"][0], today_max=daily["temperature_2m_max"][0],
                sunrise=timestamp(daily["sunrise"][0]) if daily["sunrise"][0] else None,
                sunset=timestamp(daily["sunset"][0]) if daily["sunset"][0] else None,
            ))
        return output

    async def _air(self) -> list[AirConditions]:
        payload = await self._json("https://air-quality-api.open-meteo.com/v1/air-quality", {
            **self._coordinates(), "forecast_days": "1", "domains": "cams_global",
            "current": "us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide",
        })
        output = []
        for row in self._rows(payload):
            current = row["current"]
            if row["current_units"]["us_aqi"] != "USAQI":
                raise ValueError("Invalid AQI scale")
            output.append(AirConditions(
                as_of=timestamp(current["time"]), us_aqi=current["us_aqi"], pm25=current["pm2_5"],
                pm10=current["pm10"], ozone=current["ozone"],
                nitrogen_dioxide=current["nitrogen_dioxide"],
            ))
        return output

    async def weather_snapshot(self) -> WeatherSnapshot:
        day = str(self.clock().astimezone(ZoneInfo("Asia/Tashkent")).date())
        weather, air = await asyncio.gather(
            self.weather.get(self._weather, day),
            self.air.get(self._air),
        )
        return WeatherSnapshot(
            weather_fetched_at=weather.fetched_at, air_fetched_at=air.fetched_at,
            weather_stale=weather.stale, air_stale=air.stale,
            locations=[PlaceWeather(
                id=place[0], region=place[1], city=place[2],
                weather=weather.value[index] if weather.value else None,
                air=air.value[index] if air.value else None,
            ) for index, place in enumerate(PLACES)],
        )
