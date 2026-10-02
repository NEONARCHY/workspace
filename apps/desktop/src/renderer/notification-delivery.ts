import type { WorkspaceNotification } from "@yuksalish/contracts";

const replayWindowMs = 2 * 60 * 60 * 1000;
const replayLimit = 5;

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
    ...pending.filter((item) => item.kind === "hisobot").map((item) => item.id),
  ]);
  return new Set(notifications.filter((item) => !replayIds.has(item.id)).map((item) => item.id));
}
