import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PlaceWeather, WeatherConditions } from "@yuksalish/contracts";
import { Button, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, CircleDollarSign, Cloud, CloudFog,
  CloudLightning, CloudRain, CloudSnow, Droplets, Gauge, Leaf, Moon, RefreshCw, Sun, Sunrise,
  Thermometer, Wind, X } from "lucide-react";
import { Input } from "./WorkspaceInput";
import { loadExchangeRates, loadUzbekistanWeather } from "./workspace-api";
import { useContextSnapshot } from "./useContextSnapshot";
import { useContextMotion } from "./useContextMotion";
import { airQuality, contextNumber as number, contextTime, currencyAmount, currencyNames,
  weatherDescription, windDirection } from "./topbar-context";

export function ContextWeatherIcon({ weather, size = 20 }: { readonly weather?: WeatherConditions | null; readonly size?: number }) {
  const code = weather?.code;
  const Icon = !weather ? Thermometer : code === 0 || code === 1 ? weather.isDay ? Sun : Moon
    : code === 45 || code === 48 ? CloudFog : code != null && code >= 95 ? CloudLightning
    : code != null && (code >= 71 && code <= 77 || code === 85 || code === 86) ? CloudSnow
    : code != null && code >= 51 && code <= 82 ? CloudRain : Cloud;
  return <Icon size={size} aria-hidden="true" />;
}
function Metric({ icon, label, value }: { readonly icon: ReactNode; readonly label: string; readonly value: string }) {
  return <div className="context-metric">{icon}<span>{label}</span><strong>{value}</strong></div>;
}
function WeatherDetail({ place }: { readonly place: PlaceWeather }) {
  const weather = place.weather, air = place.air, quality = airQuality(air?.usAqi);
  return <>
    <div className="context-weather-hero"><ContextWeatherIcon weather={weather} size={50} /><div>
      <strong>{number(weather?.temperature)}<small>°C</small></strong><p>{weatherDescription(weather)}</p>
      <span>Ощущается как {number(weather?.feelsLike)}° · {place.city}</span></div></div>
    <div className="context-metrics">
      <Metric icon={<Wind size={18} aria-hidden />} label="Ветер" value={`${number(weather?.windSpeed)} м/с · ${windDirection(weather?.windDirection)}`} />
      <Metric icon={<Wind size={18} aria-hidden />} label="Порывы" value={`${number(weather?.windGusts)} м/с`} />
      <Metric icon={<Droplets size={18} aria-hidden />} label="Влажность" value={`${number(weather?.humidity, 0)}%`} />
      <Metric icon={<Gauge size={18} aria-hidden />} label="Давление" value={`${number(weather?.pressure, 0)} гПа`} />
      <Metric icon={<CloudRain size={18} aria-hidden />} label="Осадки" value={`${number(weather?.precipitation)} мм`} />
      <Metric icon={<Cloud size={18} aria-hidden />} label="Облачность" value={`${number(weather?.cloudCover, 0)}%`} />
      <Metric icon={<Thermometer size={18} aria-hidden />} label="Сегодня · мин / макс" value={`${number(weather?.todayMin)}° / ${number(weather?.todayMax)}°`} />
      <Metric icon={<Sunrise size={18} aria-hidden />} label="Восход / закат" value={`${contextTime(weather?.sunrise)} / ${contextTime(weather?.sunset)}`} />
    </div>
    <section className="context-air" data-tone={quality.tone} aria-label="Качество воздуха">
      <div className="context-air-title"><Leaf size={19} aria-hidden /><span><b>Качество воздуха</b><small>US AQI · {quality.label}</small></span><strong>{number(air?.usAqi, 0)}</strong></div>
      <div className="context-air-pollutants"><span>PM2.5 <b>{number(air?.pm25)}</b></span><span>PM10 <b>{number(air?.pm10)}</b></span><span>O₃ <b>{number(air?.ozone)}</b></span><span>NO₂ <b>{number(air?.nitrogenDioxide)}</b></span></div>
      <small>Концентрации в мкг/м³ · данные на {contextTime(air?.asOf, true)}</small>
    </section>
    <p className="context-source-note">Погода на {contextTime(weather?.asOf, true)}. Модельная оценка по координатам {place.city}, не измерение городского датчика и не среднее по всей области.</p>
  </>;
}

export function TopbarInsights({ token }: { readonly token: string }) {
  const rates = useContextSnapshot(token, loadExchangeRates, 15 * 60_000);
  const weather = useContextSnapshot(token, loadUzbekistanWeather, 10 * 60_000);
  const [open, setOpen] = useState<"rates" | "weather">();
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("1");
  const [selectedPlace, setSelectedPlace] = useState<string>();
  const placePrefix = useId();
  const back = useRef<HTMLButtonElement>(null);
  const currencyTrigger = useRef<HTMLButtonElement>(null);
  const weatherTrigger = useRef<HTMLButtonElement>(null);
  const previousPlace = useRef<string>(undefined);
  const bodyMotion = useContextMotion(selectedPlace ?? "regions");
  useLayoutEffect(() => {
    if (open === "weather") {
      if (selectedPlace) {
        bodyMotion.current?.scrollTo?.({ top: 0, behavior: "instant" });
        back.current?.focus({ preventScroll: true });
      } else if (previousPlace.current) {
        const origin = document.getElementById(`${placePrefix}-${previousPlace.current}`);
        origin?.focus({ preventScroll: true });
        origin?.scrollIntoView?.({ block: "nearest" });
      }
    }
    previousPlace.current = selectedPlace;
  }, [selectedPlace, open, placePrefix, bodyMotion]);
  const usd = rates.value?.rates?.find(rate => rate.code === "USD");
  const selectedRate = rates.value?.rates?.find(rate => rate.code === currency);
  const parsedAmount = currencyAmount(amount);
  const tashkent = weather.value?.locations?.find(place => place.id === "tashkent-city");
  const detail = weather.value?.locations?.find(place => place.id === selectedPlace);
  const regions = weather.value?.locations?.filter(place => place.id !== "tashkent-city") ?? [];
  const staleRates = Boolean(rates.error || rates.value?.stale);
  const staleWeather = Boolean(weather.error || weather.value?.weatherStale);
  const toggle = (kind: "rates" | "weather", visible: boolean) => {
    setOpen(current => visible ? kind : current === kind ? undefined : current);
    if (kind === "weather" && visible) setSelectedPlace(undefined);
  };
  const close = (kind: "rates" | "weather") => {
    setOpen(undefined);
    (kind === "rates" ? currencyTrigger : weatherTrigger).current?.focus({ preventScroll: true });
  };
  const row = (place: PlaceWeather) => <button key={place.id} id={`${placePrefix}-${place.id}`} type="button"
    className="context-place-row" aria-label={`Погода: ${place.region}`} onClick={() => setSelectedPlace(place.id)}>
    <ContextWeatherIcon weather={place.weather} /><span><b>{place.region}</b><small>{place.city} · ветер {number(place.weather?.windSpeed)} м/с</small></span>
    <span className="context-place-reading"><strong>{number(place.weather?.temperature, 0)}°</strong><small>AQI {number(place.air?.usAqi, 0)}</small></span><ChevronRight size={16} aria-hidden /></button>;
  return <div className="topbar-insights">
    <Popover open={open === "rates"} onOpenChange={(event, data) => {
      toggle("rates", data.open);
      if (!data.open && "key" in event && event.key === "Escape") close("rates");
    }} positioning={{ position: "below", align: "end", autoSize: "height", overflowBoundaryPadding: 12 }} trapFocus>
      <PopoverTrigger disableButtonEnhancement><button ref={currencyTrigger} type="button" className="context-trigger context-currency-trigger" data-stale={staleRates || undefined}
        aria-label={`Курсы валют: 1 USD — ${usd ? number(Number(usd.rateUzs), 2) : "нет данных"} UZS${staleRates ? ". Данные устарели" : ""}`} aria-expanded={open === "rates"}>
        <CircleDollarSign size={18} aria-hidden /><span><small>USD <ArrowRight size={11} aria-hidden /> UZS</small><strong>{usd ? number(Number(usd.rateUzs), 2) : rates.pending ? "Загрузка…" : "Нет данных"}</strong></span><ChevronDown size={13} aria-hidden /></button></PopoverTrigger>
      <PopoverSurface className="topbar-context-surface" aria-label="Курсы валют">
        <div className="context-panel-head"><div><span className="context-kicker">Центральный банк Узбекистана</span><h2>Курсы валют</h2></div><button type="button" className="context-icon-action" aria-label="Закрыть курсы валют" onClick={() => close("rates")}><X size={19} aria-hidden /></button></div>
        <div className="context-panel-body">
          {rates.error && <p className="context-notice" role="alert">{rates.error}</p>}
          {rates.pending && !rates.value && <p role="status">Загружаем официальный курс…</p>}
          {staleRates && rates.value && <p className="context-notice">Показаны последние сохранённые курсы. Источник сейчас недоступен.</p>}
          {rates.value && <>
            <p className="context-source-note">Действуют с {new Date(`${rates.value.effectiveDate}T12:00:00+05:00`).toLocaleDateString("ru-RU")} · за 1 единицу валюты</p>
            <div className="context-rate-list" role="group" aria-label="Валюта для пересчёта">{rates.value.rates.map(rate => <button key={rate.code} type="button" aria-pressed={currency === rate.code} onClick={() => setCurrency(rate.code)} className="context-rate-row">
              <b>{rate.code}</b><span>{currencyNames[rate.code] ?? rate.code}</span><strong>{number(Number(rate.rateUzs), 2)} <small>UZS</small></strong>
              <small className="context-rate-change" data-positive={rate.changeUzs != null && Number(rate.changeUzs) > 0 || undefined}>{rate.changeUzs == null ? "—" : `${Number(rate.changeUzs) > 0 ? "+" : ""}${number(Number(rate.changeUzs), 2)}`}</small></button>)}</div>
            <div className="context-converter"><label htmlFor={`${placePrefix}-amount`}>Пересчитать {currency} → UZS</label><Input id={`${placePrefix}-amount`} type="text" inputMode="decimal" aria-label={`Сумма в ${currency}`} aria-invalid={parsedAmount === undefined} value={amount} onChange={(_, data) => setAmount(data.value)} />
              <output aria-live="polite">{parsedAmount !== undefined && selectedRate ? `${number(parsedAmount * Number(selectedRate.rateUzs), 2)} UZS` : "Введите сумму от 0 до 1 млрд, до 4 знаков после запятой"}</output></div>
            <p className="context-source-note">Справочный пересчёт по курсу ЦБ. Курсы покупки и продажи банков могут отличаться.</p>
          </>}
        </div>
        <div className="context-panel-footer"><a href="https://cbu.uz/ru/arkhiv-kursov-valyut/" target="_blank" rel="noopener noreferrer">Источник: ЦБ</a><span>{contextTime(rates.value?.fetchedAt)}</span><Button appearance="subtle" size="small" icon={<RefreshCw size={15} aria-hidden />} disabled={rates.pending} onClick={rates.refresh}>Обновить</Button></div>
      </PopoverSurface>
    </Popover>
    <Popover open={open === "weather"} onOpenChange={(event, data) => {
      toggle("weather", data.open);
      if (!data.open && "key" in event && event.key === "Escape") close("weather");
    }} positioning={{ position: "below", align: "end", autoSize: "height", overflowBoundaryPadding: 12 }} trapFocus>
      <PopoverTrigger disableButtonEnhancement><button ref={weatherTrigger} type="button" className="context-trigger context-weather-trigger" data-stale={staleWeather || undefined}
        aria-label={`Погода в Ташкенте: ${number(tashkent?.weather?.temperature)} градусов${staleWeather ? ". Данные устарели" : ""}`} aria-expanded={open === "weather"}>
        <ContextWeatherIcon weather={tashkent?.weather} /><span><small>Ташкент</small><strong>{tashkent?.weather ? `${number(tashkent.weather.temperature, 0)}°` : weather.pending ? "…" : "—"}</strong></span><ChevronDown size={13} aria-hidden /></button></PopoverTrigger>
      <PopoverSurface className="topbar-context-surface context-weather-surface" aria-label="Погода Узбекистана">
        <div className="context-panel-head"><div><span className="context-kicker">Сейчас · Узбекистан</span><h2>{detail?.region ?? "Погода по областям"}</h2></div><button type="button" className="context-icon-action" aria-label="Закрыть погоду" onClick={() => close("weather")}><X size={19} aria-hidden /></button></div>
        <div className="context-panel-body" ref={bodyMotion}>
          {weather.error && <p className="context-notice" role="alert">{weather.error}</p>}
          {weather.pending && !weather.value && <p role="status">Получаем погоду и качество воздуха…</p>}
          {weather.value?.weatherStale && <p className="context-notice">{tashkent?.weather ? "Погода из кэша — источник временно недоступен." : "Погода временно недоступна. Попробуйте обновить."}</p>}
          {weather.value?.airStale && <p className="context-notice">{tashkent?.air ? "Качество воздуха из кэша — источник временно недоступен." : "Данные качества воздуха временно недоступны."}</p>}
          {detail ? <><button ref={back} className="context-back" type="button" onClick={() => setSelectedPlace(undefined)}><ArrowLeft size={16} aria-hidden />К списку областей</button><WeatherDetail place={detail} /></> : <>
            {tashkent && <div className="context-capital">{row(tashkent)}</div>}
            {regions.length > 0 && <><p className="context-source-note">12 областей · погода в административных центрах</p><div className="context-place-list">{regions.map(row)}</div></>}
          </>}
        </div>
        <div className="context-panel-footer context-weather-footer"><span>Open-Meteo · <a href="https://atmosphere.copernicus.eu/" target="_blank" rel="noopener noreferrer">CAMS</a> · CC BY 4.0</span><Button appearance="subtle" size="small" icon={<RefreshCw size={15} aria-hidden />} disabled={weather.pending} onClick={weather.refresh}>Обновить</Button><a href="https://open-meteo.com/en/docs" target="_blank" rel="noopener noreferrer">О погодных данных</a></div>
      </PopoverSurface>
    </Popover>
  </div>;
}
