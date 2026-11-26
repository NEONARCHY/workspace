import { describe, expect, it, vi } from "vitest";

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
