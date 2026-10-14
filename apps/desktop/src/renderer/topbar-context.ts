import type { WeatherConditions } from "@yuksalish/contracts";

export const currencyNames: Readonly<Record<string, string>> = {
  USD: "Доллар США", EUR: "Евро", RUB: "Российский рубль", KZT: "Казахстанский тенге",
  CHF: "Швейцарский франк", CNY: "Китайский юань",
};
export function contextNumber(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? "—"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value);
}
export function contextTime(value: string | null | undefined, date = false): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit",
    ...(date ? { day: "numeric", month: "short" } as const : {}) }).format(new Date(value));
}
export function currencyAmount(value: string): number | undefined {
  const compact = value.trim().replaceAll(" ", "");
  if (!/^\d{1,10}(?:[.,]\d{0,4})?$/.test(compact)) return undefined;
  const amount = Number(compact.replace(",", "."));
  return Number.isFinite(amount) && amount <= 1_000_000_000 ? amount : undefined;
}
export function weatherDescription(weather: WeatherConditions | null | undefined): string {
  if (!weather) return "Погода недоступна";
  const code = weather.code;
  if (code === 0) return weather.isDay ? "Ясно" : "Ясная ночь";
  if (code === 1) return "Преимущественно ясно";
  if (code === 2) return "Переменная облачность";
  if (code === 3) return "Пасмурно";
  if (code === 45 || code === 48) return "Туман";
  if (code >= 51 && code <= 57) return "Морось";
  if (code >= 61 && code <= 67) return "Дождь";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "Снег";
  if (code >= 80 && code <= 82) return "Ливень";
  if (code === 95 || code === 96 || code === 99) return "Гроза";
  return "Погодные условия";
}
export function airQuality(value: number | null | undefined): { label: string; tone: string } {
  if (value == null || !Number.isFinite(value)) return { label: "Нет данных", tone: "neutral" };
  if (value <= 50) return { label: "Хорошее", tone: "good" };
  if (value <= 100) return { label: "Умеренное", tone: "moderate" };
  if (value <= 150) return { label: "Нездоровое для чувствительных групп", tone: "sensitive" };
  if (value <= 200) return { label: "Нездоровое", tone: "unhealthy" };
  if (value <= 300) return { label: "Очень нездоровое", tone: "unhealthy" };
  return { label: "Опасное", tone: "hazardous" };
}
export function windDirection(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—"
    : ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"][Math.round(value / 45) % 8] ?? "—";
}
