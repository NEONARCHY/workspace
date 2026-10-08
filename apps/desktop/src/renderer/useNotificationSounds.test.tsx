import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { NotificationPreferences, WorkspaceNotification } from "@yuksalish/contracts";
import { useNotificationSounds } from "./useNotificationSounds";
import { playNotificationOnce, workspaceSounds } from "./workspace-sounds";

vi.mock("./workspace-sounds", () => ({ workspaceSounds: { unlock: vi.fn(), stop: vi.fn() },
  playNotificationOnce: vi.fn().mockResolvedValue(undefined),
  notificationSoundEnabled: (item: WorkspaceNotification, prefs: NotificationPreferences) => prefs.soundEnabled !== false && (item.kind !== "feed" || prefs.feedEnabled !== false),
}));
const prefs: NotificationPreferences = { desktopEnabled: false, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true,
  tripsEnabled: true, calendarEnabled: true, absencesEnabled: true, zoomEnabled: true, remindersEnabled: true, soundVolume: 20 };
const item = (id: string, extra: Partial<WorkspaceNotification> = {}): WorkspaceNotification => ({
  id, kind: "feed", priority: "normal", title: "Новое объявление", body: "Новости", section: "feed",
  requiresAction: false, isReminder: false, readAt: null, occurredAt: new Date().toISOString(), ...extra,
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("plays only new unread publications and never the loaded history", () => {
  const old = item("loaded");
  const { rerender } = renderHook(({ notices }) => useNotificationSounds("user", notices, prefs), { initialProps: { notices: [old] } });
  expect(playNotificationOnce).not.toHaveBeenCalled();
  const fresh = item("fresh");
  rerender({ notices: [old, fresh] });
  rerender({ notices: [old, fresh, item("read", { readAt: new Date().toISOString() }), item("stale", { occurredAt: "2020-01-01T00:00:00Z" })] });
  expect(playNotificationOnce).toHaveBeenCalledOnce();
  expect(playNotificationOnce).toHaveBeenCalledWith("user", "fresh", 20);
});
it("does not replay a muted event after re-enabling or switching accounts", () => {
  const { rerender } = renderHook(({ user, notices, preferences }) => useNotificationSounds(user, notices, preferences), {
    initialProps: { user: "first", notices: [] as WorkspaceNotification[], preferences: { ...prefs, feedEnabled: false } },
  });
  rerender({ user: "first", notices: [item("muted")], preferences: { ...prefs, feedEnabled: false } });
  rerender({ user: "first", notices: [item("muted")], preferences: { ...prefs, feedEnabled: true } });
  rerender({ user: "second", notices: [item("new-account")], preferences: { ...prefs, feedEnabled: true } });
  expect(playNotificationOnce).not.toHaveBeenCalled();
  expect(workspaceSounds.stop).toHaveBeenCalled();
});
