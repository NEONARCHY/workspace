import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { Alert20Regular, Calendar20Regular, Chat20Regular, ReceiptMoney20Regular, Grid20Regular } from "@fluentui/react-icons";
import type { ApprovalRequestSummary, CalendarEvent, WorkspaceNotification } from "@yuksalish/contracts";
import { ApprovalsView } from "../src/renderer/ApprovalsView";
import { CalendarView } from "../src/renderer/CalendarView";
import { MessengerView } from "../src/renderer/MessengerView";
import { NotificationCenter } from "../src/renderer/NotificationCenter";
import { ScrollbarEdges } from "../src/renderer/ScrollbarEdges";
import { UndoActionsProvider } from "../src/renderer/UndoActions";
import { WorkspaceSectionHeader } from "../src/renderer/WorkspaceSectionHeader";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import { initialChats, initialMessages, people } from "../src/renderer/test-fixtures/demo-data";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/context-colors.css";
import "../src/renderer/personal-organization.css";
import "../src/renderer/design-system.css";
import "../src/renderer/record-composer.css";
import "../src/renderer/motion.css";
import "../src/renderer/record-lists.css";
import "../src/renderer/members.css";
import "../src/renderer/employee-recognition.css";
import "../src/renderer/hr.css";
import "../src/renderer/ai-referent.css";
import "../src/renderer/zoom.css";
import "../src/renderer/message-layout.css";
import "../src/renderer/team-dashboard.css";
import "../src/renderer/workday-presence.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workspace-2-payments.css";
import "../src/renderer/workspace-2-workflow.css";
import "../src/renderer/workspace-2-projects-trips.css";
import "../src/renderer/workspace-2-tasks.css";
import "../src/renderer/workspace-2-interactions.css";
import "../src/renderer/ai-navigation.css";
import "../src/renderer/workspace-2-auth.css";
import "../src/renderer/workspace-2-messenger.css";
import "../src/renderer/workspace-2-notifications.css";
import "../src/renderer/support-dialog.css";
import "../src/renderer/calendar-event-composer.css";
import "../src/renderer/desktop-updates.css";
import "../src/renderer/window-titlebar.css";
import "../src/renderer/web-platform.css";
import "../src/renderer/workspace-2-focus.css";
import "../src/renderer/project-hub.css";
import "../src/renderer/ai-referent-workspace.css";
import "../src/renderer/workspace-inputs.css";
import "../src/renderer/yuksalish-assistant.css";
import "../src/renderer/ai-hisobot.css";
import "../src/renderer/telegram-access.css";
import "../src/renderer/employee-scope.css";
import "../src/renderer/sliding-segmented.css";
import "../src/renderer/scrollbars.css";
import "../src/renderer/accent-surfaces.css";
import "../src/renderer/list-row-hover.css";
import "../src/renderer/workspace-calendar.css";
import "../src/renderer/confirm-action-dialog.css";
import "../src/renderer/context-motion.css";
import "../src/renderer/presence-summary-dialog.css";
import "../src/renderer/assistant-chat.css";
import "../src/renderer/account-settings.css";
import "../src/renderer/profile-header.css";
import "../src/renderer/project-workspace.css";
import "../src/renderer/sidebar-visibility.css";
import "../src/renderer/navigation-sliding.css";
import "../src/renderer/section-headers.css";
import "../src/renderer/sidebar-theme.css";
import "../src/renderer/page-canvas.css";
import "./page-canvas.css";

const nothing = async () => undefined;
const calendarDay = new Date();
calendarDay.setHours(10, 0, 0, 0);
const calendarEvents: CalendarEvent[] = Array.from({ length: 3 }, (_, i) => ({
  id: `canvas-event-${i}`, organizerUserId: people[0]!.id,
  title: ["Планирование рабочей недели", "Встреча команды", "Отменённая встреча"][i]!,
  description: "Локальный образец календаря, без серверных записей", eventType: "meeting",
  startsAt: new Date(calendarDay.getTime() + i * 2 * 3600000).toISOString(),
  endsAt: new Date(calendarDay.getTime() + (i * 2 + 1) * 3600000).toISOString(),
  allDay: false, location: "Переговорная", status: i === 2 ? "cancelled" : "scheduled",
  attendeeIds: [people[0]!.id], attendees: [], canRespond: false, canEdit: false,
  createdAt: calendarDay.toISOString(), updatedAt: calendarDay.toISOString(),
}));
const notifications: WorkspaceNotification[] = Array.from({ length: 7 }, (_, i) => ({
  id: `canvas-notification-${i}`, title: i ? "Новое сообщение команды" : "Нужно решение по заявке",
  kind: i ? "message" : "approval", priority: i ? "normal" : "attention",
  body: i ? "Рабочие новости и обновления в доступных разделах." : "Подготовка форума · Утверждение финансистом проекта",
  section: i ? "messenger" : "payment_requests", requiresAction: !i, isReminder: false,
  occurredAt: "2026-10-07T10:00:00Z", readAt: i > 2 ? "2026-10-07T10:10:00Z" : null,
}));
const requests: ApprovalRequestSummary[] = Array.from({ length: 14 }, (_, i) => ({
  id: `canvas-request-${i}`, number: String(701 + i), title: ["Подготовка форума", "Оборудование для встречи", "Рабочие материалы"][i % 3]!,
  amount: (i + 1) * 350000, currency: "UZS", purpose: "Тестовые данные, без серверных записей",
  status: "running", statusLabel: "Ожидает решения", stageLabel: "Новая заявка", activeNodeKeys: ["start"],
  activeStages: [{ key: "start", label: "Новая заявка", kind: "start", canAct: false }],
  requesterId: people[0]!.id, responsibleUserId: people[0]!.id,
  details: { transferType: "Другие услуги", projectName: "Yuksalish", projectCode: "YUK", sourceAccount: "Основной счёт", destinationAccount: "Счёт поставщика",
    requestPriority: "normal", deadline: null, comment: "", tripPurpose: "", tripStartDate: null, tripEndDate: null, employeeIds: [], paymentPurpose: "Оплата за услуги", paymentReason: "Рабочие расходы", responsibleUserId: people[0]!.id },
  createdAt: "2026-10-07T10:00:00Z", updatedAt: "2026-10-07T10:00:00Z", revision: 1, versions: [], actions: [],
}));
const roots = [
  ["Задачи", "workspace-view tasks-view bp5-tasks"], ["Обзор команды", "team-dashboard"],
  ["Сотрудники", "workspace-view employees-view"], ["Отсутствия", "workspace-view absences-view"],
  ["Календарь", "workspace-view calendar-view"], ["HR", "workspace-view hr-view"],
  ["Лента", "workspace-view feed-view"], ["Проекты", "project-hub-view workspace-view is-projects"],
  ["Проектные заявки", "workspace-view bp7-view projects-view workflow-process-view"],
  ["Поездки", "workspace-view bp7-view trips-view trip-view workflow-process-view"],
  ["AI Referent", "workspace-view ai-referent-view"], ["AI Hisobot", "workspace-view ai-hisobot-view"],
  ["Zoom", "workspace-view zoom-view"], ["Члены", "workspace-view members-view"],
  ["Доступ к ботам", "telegram-access-view"],
] as const;
function Preview() {
  const [section, setSection] = useState("notifications");
  const [sample, setSample] = useState(0);
  const nav = [
    { id: "notifications", label: "Уведомления", icon: <Alert20Regular /> },
    { id: "calendar", label: "Календарь", icon: <Calendar20Regular /> },
    { id: "payments", label: "Заявки на оплату", icon: <ReceiptMoney20Regular /> },
    { id: "messenger", label: "Мессенджер", icon: <Chat20Regular /> },
    { id: "samples", label: "Компоновка разделов", icon: <Grid20Regular /> },
  ];
  return <FluentProvider theme={workspaceTheme} className="app-provider">
    <UndoActionsProvider><ScrollbarEdges />
      <div className="app-shell">
        <aside className="app-rail sidebar-palette" data-sidebar-theme="gradient">
          <div className="workspace-logo"><strong>YUKSALISH</strong></div>
          <div className="rail-customize">Тестовый стенд</div>
          <nav className="rail-nav" aria-label="Разделы стенда">{nav.map(item => <button key={item.id} aria-label={item.label} className={`rail-action ${section === item.id ? "active" : ""}`} onClick={() => setSection(item.id)}><span className="rail-icon">{item.icon}</span><span className="rail-label">{item.label}</span></button>)}</nav>
        </aside>
        <div className="app-stage">
          <header className="global-bar qa-canvas-toolbar"><span>Проверка подложек и отступов · без рабочих данных</span>
            {section === "samples" && <select aria-label="Макет раздела" value={sample} onChange={event => setSample(Number(event.target.value))}>{roots.map(([label], i) => <option key={label} value={i}>{label}</option>)}</select>}
          </header>
          <main className="app-content" id="workspace-content">
            {section === "notifications" ? <NotificationCenter notifications={notifications} preferences={{ desktopEnabled: true, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true, tripsEnabled: true, calendarEnabled: true, absencesEnabled: true, zoomEnabled: true, remindersEnabled: true }} onOpen={nothing} onMarkRead={nothing} onMarkAllRead={nothing} onUpdatePreferences={nothing} />
            : section === "calendar" ? <CalendarView events={calendarEvents} people={people} currentUserId={people[0]!.id} onCreate={nothing} onUpdate={nothing} onCancel={nothing} />
            : section === "payments" ? <ApprovalsView token="qa-only" canManage={false} canCreateRequest={false} currentUserId={people[0]!.id} people={people} positions={[]} requests={requests} calendarEvents={[]} attachments={[]} onSaveWorkflow={nothing} onPublishWorkflow={nothing} onCreateRequest={nothing} onAction={nothing} onDeleteRequest={nothing} onReviseRequest={nothing} onUploadAttachments={nothing} onDownloadAttachment={nothing} />
            : section === "messenger" ? <MessengerView token="qa-only" currentUserId="aziza" currentUserRole="employee" chats={initialChats} messages={initialMessages} tasks={[]} attachments={[]} people={people}
              chatActions={{ create: async () => initialChats[0]!, update: async () => initialChats[0]!, add: async () => initialChats[0]!, setMember: async () => initialChats[0]!, transfer: async () => initialChats[0]!, remove: nothing, delete: nothing }}
              onSendMessage={nothing} onSendVoiceMessage={nothing} onReactMessage={nothing} onPinMessage={nothing} onEditMessage={nothing} onDeleteMessage={nothing} onCreateTaskFromMessage={nothing} onDownloadAttachment={nothing} onLoadAttachment={async () => new Blob()} onMarkRead={nothing} />
            : <section className={roots[sample]![1]} aria-label={`Макет: ${roots[sample]![0]}`}>
              <WorkspaceSectionHeader motif="tasks"><div><h1>{roots[sample]![0]}</h1><p>Проверка внешнего контейнера, не рабочая страница раздела.</p></div></WorkspaceSectionHeader>
              <div className="qa-canvas-sample-card"><h2>Карточки остаются самостоятельными</h2><p>Корень страницы не перекрашивается. Только существующие белые рабочие панели расширяются вместо внешней стеклянной рамки.</p></div>
            </section>}
          </main>
        </div>
      </div>
    </UndoActionsProvider>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
