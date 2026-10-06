import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, FluentProvider } from "@fluentui/react-components";
import type { ChatSummary, WorkspaceNotification } from "@yuksalish/contracts";
import { NotificationCenter } from "../src/renderer/NotificationCenter";
import { MessengerView } from "../src/renderer/MessengerView";
import { UndoActionsProvider } from "../src/renderer/UndoActions";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import { defaultPersonalPreferences } from "../src/renderer/personal-organization";
import { initialChats, initialMessages, people } from "../src/renderer/test-fixtures/demo-data";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/personal-organization.css";
import "../src/renderer/design-system.css";
import "../src/renderer/motion.css";
import "../src/renderer/message-layout.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workspace-2-interactions.css";
import "../src/renderer/workspace-2-messenger.css";
import "../src/renderer/workspace-2-notifications.css";
import "../src/renderer/employee-scope.css";
import "../src/renderer/confirm-action-dialog.css";
import "../src/renderer/sliding-segmented.css";
import "./inter-swipe.css";

const fixtureChats: ChatSummary[] = [
  { ...initialChats[1]!, canDelete: true },
  { ...initialChats[0]!, canDelete: true, canLeave: true },
  { ...initialChats[0]!, id: "active-trip", title: "Поездка · Ташкент", kind: "approval", contextType: "trip", canDelete: false, canLeave: false, preview: "Активная поездка: выход защищён" },
  { ...initialChats[0]!, id: "finished-trip", title: "Поездка · Самарканд", kind: "approval", contextType: "trip", canDelete: false, canLeave: true, preview: "Поездка окончена: можно выйти по желанию" },
  { ...initialChats[0]!, id: "finished-project", title: "Проект · Форум", kind: "project", contextType: "project_hub", canDelete: false, canLeave: true, preview: "Проект завершён: группа и история сохранены" },
];
const fixtureNotifications: WorkspaceNotification[] = ["Согласовать документы поездки", "Новый ответ в личном чате", "Задача готова к проверке"].map((title, i) => ({
  id: `qa-${i}`, title, kind: i === 1 ? "message" : "task", priority: "attention", body: "Тестовый пример. Проверьте свайп влево, отмену и ошибку сохранения.", section: "tasks", requiresAction: true, isReminder: false, occurredAt: "2026-10-06T10:00:00Z", readAt: null,
}));
function Preview() {
  const [section, setSection] = useState("notifications");
  const [notifications, setNotifications] = useState(fixtureNotifications);
  const [chats, setChats] = useState(fixtureChats);
  const [preferences, setPreferences] = useState({ ...defaultPersonalPreferences, pinnedChatIds: ["baxtiyor", "finance"] as readonly string[] });
  const [fail, setFail] = useState(false);
  const [log, setLog] = useState("Серверные записи отключены; данные только в этом окне.");
  const remove = async (id: string, action: string) => {
    if (fail) throw new Error("Тестовый отказ сервера. Элемент возвращён.");
    setChats(items => items.filter(item => item.id !== id));
    setLog(action);
  };
  const nothing = async () => undefined;
  return <FluentProvider theme={workspaceTheme} className="app-provider qa-swipe">
    <UndoActionsProvider>
      <header className="qa-swipe-toolbar"><div><strong>Inter · свайп · отмена</strong><small>Тестовый стенд, без подключения к рабочим данным</small></div>
        <Button onClick={() => setSection("notifications")}>Уведомления</Button><Button onClick={() => setSection("messenger")}>Мессенджер</Button>
        <Button aria-pressed={fail} onClick={() => setFail(value => !value)}>Ошибка сервера: {fail ? "вкл" : "выкл"}</Button>
        <Button onClick={() => { setNotifications(fixtureNotifications); setChats(fixtureChats); }}>Сбросить</Button></header>
      <main>{section === "notifications" ? <NotificationCenter notifications={notifications} preferences={{ desktopEnabled: true, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true, tripsEnabled: true, calendarEnabled: true, absencesEnabled: true, zoomEnabled: true, remindersEnabled: true }}
        onOpen={nothing} onMarkRead={notification => setNotifications(items => items.map(item => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item))}
        onMarkAllRead={() => setNotifications(items => items.map(item => ({ ...item, readAt: new Date().toISOString() })))} onUpdatePreferences={nothing}
        onDelete={async notification => { if (fail) throw new Error("Тестовый отказ сервера. Уведомление возвращено."); setNotifications(items => items.filter(item => item.id !== notification.id)); }} />
        : <MessengerView token="qa-only" currentUserId="aziza" currentUserRole="employee" chats={chats} messages={initialMessages} tasks={[]} attachments={[]} people={people}
          personalPreferences={preferences} onPinnedOrder={async order => setPreferences(current => ({ ...current, pinnedChatIds: order, revision: current.revision + 1 }))}
          chatActions={{ create: async () => fixtureChats[0]!, update: async () => fixtureChats[0]!, add: async () => fixtureChats[0]!, setMember: async () => fixtureChats[0]!, transfer: async () => fixtureChats[0]!, remove: id => remove(id, "Вы вышли из группы; группа у остальных осталась"), delete: id => remove(id, "Диалог удалён у обоих"), dismiss: id => remove(id, "Диалог скрыт только у вас") }}
          onSendMessage={nothing} onSendVoiceMessage={nothing} onReactMessage={nothing} onPinMessage={nothing} onEditMessage={nothing} onDeleteMessage={nothing} onCreateTaskFromMessage={nothing} onDownloadAttachment={nothing} onLoadAttachment={async () => ""} onMarkRead={nothing} />}</main>
      <footer>{log}</footer>
    </UndoActionsProvider>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
