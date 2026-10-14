import type { ExchangeSnapshot, WeatherSnapshot } from "@yuksalish/contracts";

// Synthetic QA fixtures only; the real component never imports this module.
const now = new Date().toISOString();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date(now));
export const contextRates: ExchangeSnapshot = {
  effectiveDate: today, fetchedAt: now, stale: false,
  rates: [
    { code: "USD", rateUzs: "12000", changeUzs: "25.5" },
    { code: "EUR", rateUzs: "13500", changeUzs: "-12.4" },
    { code: "RUB", rateUzs: "142.33", changeUzs: "-0.06" },
    { code: "KZT", rateUzs: "26.47", changeUzs: "-0.04" },
    { code: "CHF", rateUzs: "14358.09", changeUzs: "46.04" },
    { code: "CNY", rateUzs: "1787.47", changeUzs: "7.71" },
  ],
};
const places = [
  ["tashkent-city", "Ташкент", "Ташкент"], ["andijan", "Андижанская область", "Андижан"],
  ["bukhara", "Бухарская область", "Бухара"], ["jizzakh", "Джизакская область", "Джизак"],
  ["kashkadarya", "Кашкадарьинская область", "Карши"], ["navoi", "Навоийская область", "Навои"],
  ["namangan", "Наманганская область", "Наманган"], ["samarkand", "Самаркандская область", "Самарканд"],
  ["syrdarya", "Сырдарьинская область", "Гулистан"], ["surkhandarya", "Сурхандарьинская область", "Термез"],
  ["tashkent-region", "Ташкентская область", "Нурафшан"], ["fergana", "Ферганская область", "Фергана"],
  ["khorezm", "Хорезмская область", "Ургенч"],
] as const;
export const contextWeather: WeatherSnapshot = {
  weatherFetchedAt: now, airFetchedAt: now, weatherStale: false, airStale: false,
  locations: places.map(([id, region, city], index) => ({
    id, region, city, weather: { asOf: now, temperature: 13.3 + index, feelsLike: 12.4 + index,
      humidity: 76, isDay: false, code: index % 4, precipitation: 0, cloudCover: 10,
      pressure: 1023.7, windSpeed: 1.1 + index / 2, windDirection: 98, windGusts: 2.6,
      todayMin: 12.2, todayMax: 24.2, sunrise: `${today}T06:34:00+05:00`, sunset: `${today}T17:42:00+05:00` },
    air: { asOf: now, usAqi: 77 + index, pm25: 35.7, pm10: 36.2, ozone: 24, nitrogenDioxide: 30 },
  })),
};
