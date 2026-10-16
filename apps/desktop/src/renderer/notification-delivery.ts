import type { WorkspaceNotification } from "@yuksalish/contracts";

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

/** Only the latest event may replay: never walk backwards through the backlog
 * on subsequent logins after its delivery/read acknowledgement. */
export function initialKnownNotificationIds(
  notifications: readonly WorkspaceNotification[],
  now = Date.now(),
): Set<string> {
  const latest = notifications.filter(item => {
    const occurred = Date.parse(item.occurredAt);
    return Number.isFinite(occurred) && occurred <= now + 5000 && !isObsoleteHisobotNotification(item, now);
  }).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
  return new Set(notifications.filter(item => item.id !== latest?.id || item.readAt || item.desktopDeliveredAt || item.resolvedAt).map(item => item.id));
}

/** Persist successful native delivery across reloads/tabs even if the server
 * acknowledgement fails. Failed/permission-denied attempts remain retryable. */
export async function deliverNotificationOnce(userId: string, id: string, show: () => Promise<boolean>): Promise<boolean> {
  const key = `yuksalish:desktop-notifications:${userId}`;
  const deliver = async () => {
    let ids: string[] = [];
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (Array.isArray(stored)) ids = stored.filter((value): value is string => typeof value === "string");
    } catch { /* The server acknowledgement and session IDs remain a fallback. */ }
    if (ids.includes(id)) return true;
    const shown = await show();
    if (shown) {
      try { localStorage.setItem(key, JSON.stringify([...ids.slice(-255), id])); }
      catch { /* Storage can be unavailable in restricted browser profiles. */ }
    }
    return shown;
  };
  return navigator.locks ? navigator.locks.request(key, deliver) : deliver();
}
