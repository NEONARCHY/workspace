import { describe, expect, it, vi } from "vitest";
import { formatRussianDate, formatRussianDateTime, formatRussianTime } from "./date-time-format";

const displays = [
  { format: formatRussianDate, native: "toLocaleDateString" },
  { format: formatRussianTime, native: "toLocaleTimeString" },
  { format: formatRussianDateTime, native: "toLocaleString" },
] as const;
const options: readonly Intl.DateTimeFormatOptions[] = [
  {}, { timeZone: "Asia/Tashkent" }, { timeZone: "UTC", hour: "2-digit", minute: "2-digit" },
  { weekday: "long" }, { year: "numeric", month: "short", day: "2-digit" },
  { dayPeriod: "short" }, { fractionalSecondDigits: 3 }, { dateStyle: "short" },
  { timeStyle: "short" }, { dateStyle: "medium", timeStyle: "short" },
];

describe.each(displays)("native-compatible cached $native", ({ format, native }) => {
  it.each(options)("keeps requested fields, defaults and style errors for %j", settings => {
    const date = new Date("2026-11-26T07:30:45.123Z");
    let expected: string;
    try { expected = date[native]("ru-RU", settings); }
    catch (error) { expect(() => format(date, settings)).toThrow(error!.constructor); return; }
    expect(format(date, settings)).toBe(expected);
  });
  it("keeps the invalid-date label before validating options", () => {
    const date = new Date("invalid");
    expect(format(date, { timeZone: "invalid" })).toBe(date[native]("ru-RU", { timeZone: "invalid" }));
  });
});

describe("shared row date formatters", () => {
  it("reuses equivalent options without changing locale or timezone output", async () => {
    vi.resetModules();
    const { russianDateTimeFormatter } = await import("./date-time-format");
    const options = { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" } as const;
    const format = russianDateTimeFormatter(options);
    expect(russianDateTimeFormatter({ minute: "2-digit", hour: "2-digit", timeZone: "Asia/Tashkent" })).toBe(format);
    const date = new Date("2026-11-26T07:30:00Z");
    expect(format.format(date)).toBe(new Intl.DateTimeFormat("ru-RU", options).format(date));
    expect(russianDateTimeFormatter({ ...options, timeZone: "UTC" }).format(date)).not.toBe(format.format(date));
  });
  it("bounds cached timezone choices and preserves native invalid-date/option errors", async () => {
    vi.resetModules();
    const { russianDateTimeFormatter } = await import("./date-time-format");
    const first = russianDateTimeFormatter({ timeZone: "UTC" });
    for (const timeZone of Intl.supportedValuesOf("timeZone").slice(0, 40)) russianDateTimeFormatter({ timeZone });
    expect(russianDateTimeFormatter({ timeZone: "UTC" })).not.toBe(first);
    expect(() => russianDateTimeFormatter({ timeZone: "not/a/timezone" })).toThrow(RangeError);
    expect(() => russianDateTimeFormatter({ day: "numeric" }).format(new Date("invalid"))).toThrow(RangeError);
  });
});
