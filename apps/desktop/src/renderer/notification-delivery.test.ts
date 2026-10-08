import type { WorkspaceNotification } from "@yuksalish/contracts";
import { describe, expect, it } from "vitest";
import { initialKnownNotificationIds, isObsoleteHisobotNotification } from "./notification-delivery";

const now = new Date("2026-10-02T10:00:00Z").getTime();

function notification(id: string, overrides: Partial<WorkspaceNotification> = {}): WorkspaceNotification {
  return {
    id, kind: "message", priority: "normal", title: id, body: id,
    section: "messenger", requiresAction: false, isReminder: false,
    occurredAt: new Date(now - 30 * 60_000).toISOString(),
    ...overrides,
  };
}

describe("initialKnownNotificationIds", () => {
  it("replays recent unread and undelivered events, but not old or resolved events", () => {
    const items = [
      notification("recent"),
      notification("read", { readAt: new Date(now).toISOString() }),
      notification("delivered", { desktopDeliveredAt: new Date(now).toISOString() }),
      notification("old", { occurredAt: new Date(now - 3 * 60 * 60_000).toISOString() }),
      notification("hisobot", { kind: "hisobot", section: "ai_hisobot", isReminder: true, occurredAt: new Date(now - 24 * 60 * 60_000).toISOString() }),
    ];
    const known = initialKnownNotificationIds(items, now);
    expect(known.has("recent")).toBe(false);
    expect(known.has("hisobot")).toBe(true);
    expect(["read", "delivered", "old"].every((id) => known.has(id))).toBe(true);
  });

  it("bounds the normal notification backlog to the five most recent events", () => {
    const items = Array.from({ length: 8 }, (_, index) => notification(`event-${index}`, {
      occurredAt: new Date(now - index * 60_000).toISOString(),
    }));
    const known = initialKnownNotificationIds(items, now);
    expect(items.filter((item) => !known.has(item.id)).map((item) => item.id))
      .toEqual(["event-0", "event-1", "event-2", "event-3", "event-4"]);
  });

  it("replays only the latest current Hisobot reminder, not five accumulated slots", () => {
    const slots = ["12:40", "13:00", "13:10", "13:20", "13:25"];
    const items = slots.map((slot, index) => notification(`hisobot-${index}`, {
      kind: "hisobot", isReminder: true, section: "ai_hisobot", requiresAction: true,
      occurredAt: `2026-10-08T${slot}:00Z`,
    }));
    const known = initialKnownNotificationIds(items.reverse(), Date.parse("2026-10-08T13:29:59Z"));
    expect(items.filter((item) => !known.has(item.id)).map((item) => item.id)).toEqual(["hisobot-4"]);
  });

  it("suppresses resolved and expired reminders but retains one dated missed-report notice", () => {
    const items = [
      notification("expired", { kind: "hisobot", isReminder: true, occurredAt: "2026-10-08T13:25:00Z" }),
      notification("resolved", { kind: "hisobot", isReminder: true, resolvedAt: "2026-10-08T13:26:00Z" }),
      notification("older-missed", { kind: "hisobot", occurredAt: "2026-10-07T13:30:00Z" }),
      notification("latest-missed", { kind: "hisobot", occurredAt: "2026-10-08T13:30:00Z" }),
    ];
    const known = initialKnownNotificationIds(items, Date.parse("2026-10-09T04:00:00Z"));
    expect(items.filter((item) => !known.has(item.id)).map((item) => item.id)).toEqual(["latest-missed"]);
  });

  it("uses the Tashkent deadline, including the exact 18:30 boundary and next local day", () => {
    const item = notification("hisobot", { kind: "hisobot", isReminder: true, occurredAt: "2026-10-08T13:25:00Z" });
    expect(isObsoleteHisobotNotification(item, Date.parse("2026-10-08T13:29:59Z"))).toBe(false);
    expect(isObsoleteHisobotNotification(item, Date.parse("2026-10-08T13:30:00Z"))).toBe(true);
    expect(isObsoleteHisobotNotification(item, Date.parse("2026-10-08T19:00:00Z"))).toBe(true);
    expect(isObsoleteHisobotNotification({ ...item, occurredAt: "invalid" }, now)).toBe(true);
    expect(isObsoleteHisobotNotification({ ...item, kind: "task" }, now)).toBe(false);
  });
});
