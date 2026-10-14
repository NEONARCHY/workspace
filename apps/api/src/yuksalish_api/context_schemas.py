"""Read-only public context, served through the authenticated workspace API."""

from datetime import date, datetime
from decimal import Decimal

from pydantic import Field

from .workspace_schemas import ApiModel


class ExchangeRate(ApiModel):
    code: str
    rate_uzs: Decimal = Field(gt=0, allow_inf_nan=False)
    change_uzs: Decimal | None = Field(default=None, allow_inf_nan=False)


class ExchangeSnapshot(ApiModel):
    effective_date: date
    fetched_at: datetime
    stale: bool = False
    rates: list[ExchangeRate]


class WeatherConditions(ApiModel):
    as_of: datetime
    temperature: float | None = Field(default=None, ge=-100, le=70)
    feels_like: float | None = Field(default=None, ge=-120, le=90)
    humidity: float | None = Field(default=None, ge=0, le=100)
    is_day: bool
    code: int = Field(ge=0, le=99)
    precipitation: float | None = Field(default=None, ge=0, le=1000)
    cloud_cover: float | None = Field(default=None, ge=0, le=100)
    pressure: float | None = Field(default=None, ge=500, le=1200)
    wind_speed: float | None = Field(default=None, ge=0, le=150)
    wind_direction: float | None = Field(default=None, ge=0, le=360)
    wind_gusts: float | None = Field(default=None, ge=0, le=200)
    today_min: float | None = Field(default=None, ge=-100, le=70)
    today_max: float | None = Field(default=None, ge=-100, le=70)
    sunrise: datetime | None = None
    sunset: datetime | None = None


class AirConditions(ApiModel):
    as_of: datetime
    us_aqi: float | None = Field(default=None, ge=0, le=2000)
    pm25: float | None = Field(default=None, ge=0, le=5000)
    pm10: float | None = Field(default=None, ge=0, le=10000)
    ozone: float | None = Field(default=None, ge=0, le=5000)
    nitrogen_dioxide: float | None = Field(default=None, ge=0, le=5000)


class PlaceWeather(ApiModel):
    id: str
    region: str
    city: str
    weather: WeatherConditions | None
    air: AirConditions | None


class WeatherSnapshot(ApiModel):
    weather_fetched_at: datetime | None
    air_fetched_at: datetime | None
    weather_stale: bool
    air_stale: bool
    locations: list[PlaceWeather]
