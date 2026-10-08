import type { WorkspaceNotification } from "@yuksalish/contracts";

const replayWindowMs = 2 * 60 * 60 * 1000;
const replayLimit = 5;
const reportDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit",
});
const reportClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** Old clients/servers must not replay a reminder after its reporting window. */
export function isObsoleteHisobotNotification(item: WorkspaceNotification, now = Date.now()): boolean {
  if (item.kind !== "hisobot") return false;
  if (item.resolvedAt) return true;
  if (!item.isReminder) return false;
  const occurred = new Date(item.occurredAt);
  const current = new Date(now);
  return !Number.isFinite(occurred.getTime()) || !Number.isFinite(current.getTime())
    || reportDate.format(occurred) !== reportDate.format(current)
    || reportClock.format(current) >= "18:30";
}

/** Replay a small recent backlog after login without flooding Windows with old events. */
export function initialKnownNotificationIds(
  notifications: readonly WorkspaceNotification[],
  now = Date.now(),
): Set<string> {
  const pending = notifications.filter((item) => !item.readAt && !item.desktopDeliveredAt);
  const recent = pending
    .filter((item) => item.kind !== "hisobot" && new Date(item.occurredAt).getTime() >= now - replayWindowMs)
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, replayLimit);
  const replayIds = new Set([
    ...recent.map((item) => item.id),
    ...pending.filter((item) => item.kind === "hisobot" && !isObsoleteHisobotNotification(item, now))
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      .slice(0, 1).map((item) => item.id),
  ]);
  return new Set(notifications.filter((item) => !replayIds.has(item.id)).map((item) => item.id));
}
