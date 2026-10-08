import { describe, expect, it } from "vitest";
import { buildPersonalHome, homePeriod, rankHomePanels } from "./personal-home";
import { homeFixture } from "./test-fixtures/personal-home-fixture";
const now = Date.parse("2026-10-08T09:00:00+05:00");
describe("Personal Home model", () => {
  it("uses the employee, not the team, and does not blame an executor awaiting review", () => {
    const base = homeFixture("aziza", now);
    const t = base.tasks[0]!;
    const data = buildPersonalHome({ ...base, tasks: [
      ...base.tasks, { ...t, id: "foreign", assigneeId: "dilshod" },
      { ...t, id: "co", assigneeId: "dilshod", participants: [{ userId: "aziza", role: "co_assignee" }] },
      { ...t, id: "observer", assigneeId: "dilshod", participants: [{ userId: "aziza", role: "observer" }] },
      { ...t, id: "waiting", status: "awaiting_review", dueAt: new Date(now - 1000).toISOString() },
      { ...t, id: "done", status: "completed" },
    ] }, () => true, now);
    expect(data.tasks.map(t => t.id)).toEqual(["home-due", "home-late", "co", "waiting"]);
    expect(data.signals.map(s => s.id)).toEqual(["tasks:home-late", "review:home-review", "tasks:co", "tasks:home-due"]);
    expect(data.signals.some(s => s.entityId === "waiting")).toBe(false);
    expect(base.tasks).toHaveLength(3);
  });
  it("respects module rights and exact department membership", () => {
    const data = buildPersonalHome(homeFixture("aziza", now), () => false, now);
    expect(data.tasks).toEqual([]); expect(data.signals).toEqual([]);
    expect(data.chats).toEqual([]); expect(data.schedule).toEqual([]);
    expect(data.notifications).toEqual([]); expect(data.feed).toEqual([]);
    expect(data.colleagues.map(p => p.id)).toEqual(["baxtiyor", "dilshod"]);
  });
  it("does not show someone else's calendar, declined invitations or archived chats", () => {
    const base = homeFixture("aziza", now), event = base.calendarEvents[0]!;
    const data = buildPersonalHome({ ...base, personalPreferences: { ...base.personalPreferences, archivedChatIds: base.chats.map(c => c.id) },
      calendarEvents: [event, { ...event, id: "foreign", organizerUserId: "malika", attendeeIds: ["malika"] }, { ...event, id: "declined", currentUserAttendanceStatus: "declined" }] }, () => true, now);
    expect(data.chats).toEqual([]); expect(data.schedule.map(e => e.id)).toEqual([event.id]);
  });
  it("raises immediate risk above routine panels and uses Tashkent month boundaries", () => {
    const data = buildPersonalHome(homeFixture("aziza", now), () => true, now);
    expect(rankHomePanels(data, now)[0]).toBe("attention");
    expect(homePeriod(Date.parse("2026-09-30T19:00:00Z"))).toBe("2026-10");
    expect(homePeriod(Date.parse("2026-09-30T18:59:59Z"))).toBe("2026-09");
  });
});
