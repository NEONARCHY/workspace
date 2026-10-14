import type { WorkspaceNotification } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverNotificationOnce, initialKnownNotificationIds, isObsoleteHisobotNotification } from "./notification-delivery";

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
  it("replays the latest unread event but not older or obsolete events", () => {
    const items = [
      notification("recent", { occurredAt: new Date(now - 1000).toISOString() }),
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

  it("replays only the latest event from a whole backlog", () => {
    const items = Array.from({ length: 8 }, (_, index) => notification(`event-${index}`, {
      occurredAt: new Date(now - index * 60_000).toISOString(),
    }));
    const known = initialKnownNotificationIds(items, now);
    expect(items.filter((item) => !known.has(item.id)).map((item) => item.id))
      .toEqual(["event-0"]);
  });

  it("keeps yesterday's latest event eligible but never falls back to older events after acknowledgement", () => {
    const items = [notification("yesterday", { occurredAt: new Date(now - 24 * 60 * 60_000).toISOString() }), notification("earlier", { occurredAt: new Date(now - 48 * 60 * 60_000).toISOString() })];
    expect([...initialKnownNotificationIds(items, now)]).toEqual(["earlier"]);
    for (const acknowledgement of [{ readAt: new Date(now).toISOString() }, { desktopDeliveredAt: new Date(now).toISOString() }]) {
      expect(initialKnownNotificationIds([{ ...items[0]!, ...acknowledgement }, items[1]!], now).size).toBe(2);
    }
  });
  it("shares one replay slot between regular and Hisobot events, ignoring invalid timestamps", () => {
    const items = [notification("regular", { occurredAt: new Date(now - 1000).toISOString() }), notification("hisobot", { kind: "hisobot" }), notification("invalid", { occurredAt: "invalid" })];
    expect([...initialKnownNotificationIds(items, now)]).toEqual(["hisobot", "invalid"]);
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

describe("deliverNotificationOnce", () => {
  afterEach(() => { localStorage.removeItem("yuksalish:desktop-notifications:first"); localStorage.removeItem("yuksalish:desktop-notifications:second"); vi.restoreAllMocks(); });
  it("shows an event once across reloads while isolating employees", async () => {
    const show = vi.fn().mockResolvedValue(true);
    await deliverNotificationOnce("first", "event", show);
    await deliverNotificationOnce("first", "event", show);
    expect(show).toHaveBeenCalledOnce();
    await deliverNotificationOnce("second", "event", show);
    expect(show).toHaveBeenCalledTimes(2);
  });
  it("does not remember denied or failed attempts", async () => {
    const show = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(true);
    expect(await deliverNotificationOnce("first", "event", show)).toBe(false);
    await expect(deliverNotificationOnce("first", "event", show)).rejects.toThrow("offline");
    expect(await deliverNotificationOnce("first", "event", show)).toBe(true);
    await deliverNotificationOnce("first", "event", show);
    expect(show).toHaveBeenCalledTimes(3);
  });
});
