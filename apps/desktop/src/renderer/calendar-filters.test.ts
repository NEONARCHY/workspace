import { describe, expect, it } from "vitest";
import { calendarItemsOnDay, calendarRangeError, calendarScheduleGroups, emptyCalendarFilters, filterCalendarSchedule } from "./calendar-filters";
import { sampleEvent, sampleZoom } from "./test-fixtures/calendar-filter-data";
describe("authorised calendar filtering", () => {
  it("matches an organiser as well as an attendee, including Zoom", () => {
    const event = sampleEvent("meeting");
    expect(filterCalendarSchedule([event], [sampleZoom()], { ...emptyCalendarFilters, employeeId: "organizer" })).toHaveLength(2);
    expect(filterCalendarSchedule([event], [sampleZoom()], { ...emptyCalendarFilters, employeeId: "colleague" }).map(item => item.kind)).toEqual(["zoom"]);
    expect(filterCalendarSchedule([event], [], { ...emptyCalendarFilters, employeeId: "unavailable" })).toEqual([]);
  });
  it("combines employee, title/location search, cancellation and dates", () => {
    const events = [sampleEvent("team", { location: "Главный зал" }), sampleEvent("cancelled", { location: "Главный зал", status: "cancelled" }),
      sampleEvent("other", { attendeeIds: ["other"] })];
    expect(filterCalendarSchedule(events, [], { ...emptyCalendarFilters, query: "ЗАЛ", employeeId: "me", from: "2026-10-13", to: "2026-10-13", showCancelled: false }).map(item => item.title)).toEqual(["team"]);
  });
  it("uses inclusive calendar dates and strict half-open interval overlap", () => {
    const endsAtMidnight = sampleEvent("before", { startsAt: "2026-10-12T22:00:00", endsAt: "2026-10-13T00:00:00" });
    const overnight = sampleEvent("overnight", { startsAt: "2026-10-12T22:00:00", endsAt: "2026-10-13T01:00:00" });
    const nextDay = sampleEvent("after", { startsAt: "2026-10-14T00:00:00", endsAt: "2026-10-14T01:00:00" });
    expect(filterCalendarSchedule([endsAtMidnight, overnight, nextDay], [], { ...emptyCalendarFilters, from: "2026-10-13", to: "2026-10-13" }).map(item => item.title)).toEqual(["overnight"]);
  });
  it("shows a multiday event and overnight Zoom on every affected day, not outside the filter", () => {
    const filters = { ...emptyCalendarFilters, from: "2026-10-13", to: "2026-10-13" };
    const items = filterCalendarSchedule([sampleEvent("multi", { startsAt: "2026-10-12T10:00:00", endsAt: "2026-10-15T00:00:00" })],
      [sampleZoom({ startsAt: "2026-10-12T23:00:00", endsAt: "2026-10-13T01:00:00" })], filters);
    expect(calendarItemsOnDay(items, new Date("2026-10-13T12:00:00"), filters)).toHaveLength(2);
    expect(calendarItemsOnDay(items, new Date("2026-10-12T12:00:00"), filters)).toEqual([]);
  });
  it("sorts meetings and Zoom together and excludes legacy task/deadline/trip entries", () => {
    const items = filterCalendarSchedule([sampleEvent("later"), sampleEvent("legacy", { eventType: "task" })],
      [sampleZoom(), sampleZoom({ id: "cancelled-zoom", status: "cancelled" })], emptyCalendarFilters);
    expect(items.map(item => item.title)).toEqual(["Zoom-сессия", "later"]);
  });
  it("rejects invalid/reversed dates and malformed event intervals", () => {
    expect(calendarRangeError("2026-02-31", "")).not.toBe("");
    expect(calendarRangeError("2026-10-14", "2026-10-13")).not.toBe("");
    expect(filterCalendarSchedule([sampleEvent("bad", { endsAt: "invalid" })], [], emptyCalendarFilters)).toEqual([]);
    expect(filterCalendarSchedule([sampleEvent("good")], [], { ...emptyCalendarFilters, from: "2026-10-14", to: "2026-10-13" })).toEqual([]);
  });
  it("groups tiles by date and clips an ongoing event's heading to the selected period", () => {
    const items = filterCalendarSchedule([
      sampleEvent("ongoing", { startsAt: "2026-10-12T10:00:00", endsAt: "2026-10-14T12:00:00" }),
      sampleEvent("next-day", { startsAt: "2026-10-14T09:00:00", endsAt: "2026-10-14T10:00:00" }),
    ], [sampleZoom()], { ...emptyCalendarFilters, from: "2026-10-13", to: "2026-10-14" });
    const groups = calendarScheduleGroups(items, "2026-10-13");
    expect(groups.map(group => group.day)).toEqual(["2026-10-13", "2026-10-14"]);
    expect(groups[0]?.items.map(item => item.title)).toEqual(["ongoing", "Zoom-сессия"]);
    expect(groups[1]?.items.map(item => item.title)).toEqual(["next-day"]);
    expect(calendarScheduleGroups([])).toEqual([]);
  });
});
