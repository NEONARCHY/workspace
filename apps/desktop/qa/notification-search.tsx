// Real notification UI with local-only data/actions.
import { useState } from "react";
import type { NotificationPreferences, WorkspaceNotification } from "@yuksalish/contracts";
import { NotificationCenter } from "../src/renderer/NotificationCenter";
const preferences: NotificationPreferences = { desktopEnabled: true, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true, tripsEnabled: true, calendarEnabled: true, absencesEnabled: true, zoomEnabled: true, remindersEnabled: true };
const initial: readonly WorkspaceNotification[] = ["Проверка поиска", "План встречи"].map((title, index) => ({
  id: `qa-search-${index}`, title, body: "Синтетическое уведомление", kind: "task", priority: "attention",
  section: "tasks", requiresAction: false, isReminder: false, occurredAt: "2026-10-19T07:00:00Z", readAt: null,
}));
export function NotificationSearchFixture() {
  const [notifications, setNotifications] = useState(initial);
  return <NotificationCenter notifications={notifications} preferences={preferences}
    onOpen={() => undefined} onMarkRead={() => undefined} onUpdatePreferences={() => undefined}
    onMarkAllRead={() => setNotifications(current => current.map(item => ({ ...item, readAt: "2026-10-19T08:00:00Z" })))} />;
}
