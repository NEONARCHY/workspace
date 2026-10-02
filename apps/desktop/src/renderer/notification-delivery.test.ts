import type { WorkspaceNotification } from "@yuksalish/contracts";
import { describe, expect, it } from "vitest";
import { initialKnownNotificationIds } from "./notification-delivery";

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
      notification("hisobot", { kind: "hisobot", section: "ai_hisobot", occurredAt: new Date(now - 24 * 60 * 60_000).toISOString() }),
    ];
    const known = initialKnownNotificationIds(items, now);
    expect(known.has("recent")).toBe(false);
    expect(known.has("hisobot")).toBe(false);
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
});
