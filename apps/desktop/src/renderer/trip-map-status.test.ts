import { describe, expect, it } from "vitest";
import { tripMapLocationStatus, tripMapStatus, tripMapToday } from "./trip-map-status";

describe("trip map timing", () => {
  it("uses the Tashkent calendar day, including a UTC day boundary", () => {
    expect(tripMapToday(new Date("2026-10-16T20:00:00Z"))).toBe("2026-10-17");
  });

  it("treats both departure and return days as current", () => {
    const trip = { startDate: "2026-10-20", endDate: "2026-10-22" };
    expect(tripMapStatus(trip, "2026-10-19")).toBe("upcoming");
    expect(tripMapStatus(trip, "2026-10-20")).toBe("current");
    expect(tripMapStatus(trip, "2026-10-22")).toBe("current");
    expect(tripMapStatus(trip, "2026-10-23")).toBe("past");
  });

  it("gives a shared pin current, then upcoming, then past priority", () => {
    const upcoming = { startDate: "2026-11-01", endDate: "2026-11-02" };
    const past = { startDate: "2026-09-01", endDate: "2026-09-02" };
    const current = { startDate: "2026-10-17", endDate: "2026-10-18" };
    expect(tripMapLocationStatus([past, upcoming], "2026-10-17")).toBe("upcoming");
    expect(tripMapLocationStatus([past, upcoming, current], "2026-10-17")).toBe("current");
    expect(tripMapLocationStatus([past], "2026-10-17")).toBe("past");
  });
});
