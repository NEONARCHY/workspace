// Real notification UI with local-only data/actions.
import { useState } from "react";
import type { NotificationPreferences, WorkspaceNotification } from "@yuksalish/contracts";
import { NotificationCenter } from "../src/renderer/NotificationCenter";
const preferences: NotificationPreferences = { desktopEnabled: true, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true, tripsEnabled: true, calendarEnabled: true, absencesEnabled: true, zoomEnabled: true, remindersEnabled: true };
const initial: readonly WorkspaceNotification[] = ["Проверка поиска", "План встречи"].map((title, index) => ({
  id: `qa-search-${index}`, title, body: "Синтетическое уведомление", kind: "task", priority: "attention",
  section: "tasks", requiresAction: false, isReminder: false, occurredAt: "2026-10-19T07:00:00Z", readAt: null,
}));
const count = Number(new URLSearchParams(location.search).get("notificationCount"));
const fixtureItems = count > 0 && count <= 3000 ? Array.from({ length: count }, (_, index) => ({
  ...initial[index % initial.length]!, id: `qa-notification-${index}`, title: `Событие ${index}`,
  body: "Синтетическое уведомление для проверки прокрутки. Рабочая задача и результат согласования.",
})) : initial;
export function NotificationSearchFixture() {
  const [notifications, setNotifications] = useState(fixtureItems);
  const [active, setActive] = useState(true);
  return <><button type="button" onClick={() => setActive(value => !value)}>Сменить раздел QA</button>
  {active ? <NotificationCenter notifications={notifications} preferences={preferences}
    onOpen={() => undefined} onMarkRead={() => undefined} onUpdatePreferences={() => undefined}
    onDelete={async item => setNotifications(current => current.filter(other => other.id !== item.id))}
    onMarkAllRead={() => setNotifications(current => current.map(item => ({ ...item, readAt: "2026-10-19T08:00:00Z" })))} /> : <p>Другой раздел</p>}</>;
}
