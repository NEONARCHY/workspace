import { describe, expect, it } from "vitest";
import { airQuality, contextNumber, contextTime, currencyAmount, windDirection } from "./topbar-context";

describe("public context presentation", () => {
  it("preserves zero and formats missing values distinctly", () => {
    expect(contextNumber(0)).toBe("0");
    expect(contextNumber(null)).toBe("—");
    expect(contextNumber(NaN)).toBe("—");
    expect(contextTime("2026-10-15T00:00:00Z")).toBe("05:00");
    expect(contextTime("invalid")).toBe("—");
  });
  it.each(["0", "1,25", "1000.5", "1 000,25"])('accepts amount "%s"', value => {
    expect(currencyAmount(value)).toBeDefined();
  });
  it.each(["", "-1", "Infinity", "1e20", "12oops", "1,23456", "1000000001", "1.2.3"])("rejects %s without a fictional total", value => {
    expect(currencyAmount(value)).toBeUndefined();
  });
  it("uses US AQI boundaries and no optimistic missing-data state", () => {
    expect(airQuality(null).tone).toBe("neutral");
    expect(airQuality(50).tone).toBe("good");
    expect(airQuality(51).tone).toBe("moderate");
    expect(airQuality(101).tone).toBe("sensitive");
    expect(airQuality(151).tone).toBe("unhealthy");
    expect(airQuality(301).tone).toBe("hazardous");
    expect(windDirection(360)).toBe("С");
    expect(windDirection(90)).toBe("В");
  });
});
