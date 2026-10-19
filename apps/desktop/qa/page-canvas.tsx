import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { Alert20Regular, Calendar20Regular, Chat20Regular, ReceiptMoney20Regular, Grid20Regular, Video20Regular } from "@fluentui/react-icons";
import type { ApprovalRequestSummary, CalendarEvent, CalendarEventInput, ChatMessage, OfficeFilePreview, WorkspaceAttachment, WorkspaceDepartment, WorkspaceNotification } from "@yuksalish/contracts";
import FileViewer from "../src/renderer/FileViewer";
import { ApprovalsView } from "../src/renderer/ApprovalsView";
import { CalendarView } from "../src/renderer/CalendarView";
import { MessengerView } from "../src/renderer/MessengerView";
import { IncomingLettersView } from "../src/renderer/IncomingLettersView";
import { NotificationCenter } from "../src/renderer/NotificationCenter";
import { ZoomView } from "../src/renderer/ZoomView";
import { TripApprovalsView } from "../src/renderer/TripApprovalsView";
import { SectionJump } from "../src/renderer/SectionJump";
import { TaskRecords } from "../src/renderer/TaskRecords";
import { ScrollbarEdges } from "../src/renderer/ScrollbarEdges";
import { UndoActionsProvider } from "../src/renderer/UndoActions";
import { WorkspaceSectionHeader } from "../src/renderer/WorkspaceSectionHeader";
import { WorkspaceSectionContent } from "../src/renderer/WorkspaceSectionContent";
import { useQaTheme } from "./color-theme";
import { useBrowserCompactLayout, observeBrowserViewport } from "../src/renderer/browser-layout";
import { TeamDashboardView } from "../src/renderer/TeamDashboardView";
import { PersonalHomeView } from "../src/renderer/PersonalHomeView";
import { SurveyAnalyticsView } from "../src/renderer/SurveyAnalyticsView";
import { homeFixture } from "../src/renderer/test-fixtures/personal-home-fixture";
import { initialChats, initialMessages, initialTasks, people } from "../src/renderer/test-fixtures/demo-data";
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
import "../src/renderer/browser-responsive.css";
import "../src/renderer/browser-secondary.css";
import "../src/renderer/dark-theme.css";
import "../src/renderer/satin-surfaces.css";
import "../src/renderer/workspace-search.css";
import "../src/renderer/workspace-popups.css";
import "../src/renderer/workspace-field-borders.css";
import "../src/renderer/mobile-density.css";
import "../src/renderer/personal-home.css";
import "../src/renderer/page-scroll-layout.css";
import "./page-canvas.css";

const nothing = async () => undefined;
const jumpItems = [
  ["home", "Главная"], ["tasks", "Задачи"], ["team_overview", "Обзор команды"],
  ["payment_requests", "Заявки на оплату"], ["ai_referent", "AI Referent"],
  ["incoming_letters", "Входящие письма"], ["feed", "Лента"],
  ["notifications", "Уведомления"], ["calendar", "Календарь"],
  ["messenger", "Мессенджер"], ["projects", "Проекты"],
] as const;
const zoomPeople = people.map((person, index) => ({ ...person, departmentId: index > 1 ? "qa-region" : "qa-central" }));
const zoomDepartments: readonly WorkspaceDepartment[] = [
  { id: "qa-central", name: "Тестовый ЦА", code: "qa-central", scope: "central", assignedUsersCount: 2 },
  { id: "qa-region", name: "Тестовый регион", code: "qa-region", scope: "regional", assignedUsersCount: Math.max(0, zoomPeople.length - 2) },
];
// Zoom preview cannot create, change or cancel real conferences.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (!url.pathname.startsWith("/api/v1/zoom-meetings")) return nativeFetch(input, init);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (method === "GET" && url.pathname === "/api/v1/zoom-meetings/availability") {
    return Response.json({ configured: true, timezone: "Asia/Tashkent", slotMinutes: 15, hostCalendarSynced: true, intervals: [] });
  }
  return Response.json({ detail: "Тестовый стенд: сохранение конференций отключено" }, { status: 403 });
};
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
  ["Главная", "workspace-view personal-home"],
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
function QaIncomingLetters() {
  useEffect(() => {
    const originalFetch = window.fetch;
    const mockFetch: typeof window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (!url.pathname.includes("/api/v1/incoming-letters")) return originalFetch(input, init);
      if (init?.method && init.method !== "GET") return new Response("Read-only QA", {status:403});
      const letters = Array.from({length: 20}, (_, index) => ({
        id: index + 1, version: 1, in_num: `QA-${index + 1}`, status: [null, 1, 2, 3][index % 4],
        in_date: "2026-10-12", deadline: "2026-10-17", out_num: null, out_date: null,
        organization: "Тестовая организация · письмо для проверки интерфейса",
        description: "Обсуждение повестки и материалов рабочей встречи", region: "Ташкент",
        deadline2: null, type: null, comment: null, result: null, result_time: null,
        legacy_dates_timezone: "unknown", overdue: null, assignments: [],
        attachments: [{id:"qa-document", name:"Тестовое письмо.docx", size:12000}],
      }));
      const detail = /incoming-letters\/(\d+)/.exec(url.pathname);
      const payload = url.pathname.endsWith("/preview") ? {
        kind:"word", blocks:[{kind:"paragraph", text:"Тестовый оригинал входящего письма. Только синтетические данные, без подключения к ЭДО.", rows:[]}],
        sheets:[], sheetIndex:0, rowOffset:0, totalRows:0, rows:[], truncated:false,
      } : detail ? {data: letters[Number(detail[1]) - 1], deadline_timezone_verified:false}
        : {data: letters, meta:{page:1,limit:20,total:20}, deadline_timezone_verified:false};
      return new Response(JSON.stringify(payload), {headers:{"Content-Type":"application/json"}});
    };
    window.fetch = mockFetch;
    return () => { if (window.fetch === mockFetch) window.fetch = originalFetch; };
  }, []);
  return <IncomingLettersView token="qa-only" people={people} currentUserId="aziza" canEdit={false} />;
}

function Preview() {
  const workspaceTheme = useQaTheme();
  const compact = useBrowserCompactLayout(true);
  useEffect(() => { document.documentElement.classList.add("web-platform"); return observeBrowserViewport(); }, []);
  const [section, setSection] = useState(new URLSearchParams(location.search).get("section") ?? "notifications");
  const [sample, setSample] = useState(Number(new URLSearchParams(location.search).get("sample") ?? 0));
  const [selectedTask, setSelectedTask] = useState<string>();
  const [previewFile, setPreviewFile] = useState<WorkspaceAttachment>();
  const [scheduleEvents, setScheduleEvents] = useState<readonly CalendarEvent[]>(calendarEvents);
  const createPreviewEvent = async (payload: CalendarEventInput): Promise<CalendarEvent> => {
    const now = new Date().toISOString();
    const event: CalendarEvent = { ...payload, id: crypto.randomUUID(), organizerUserId: people[0]!.id, status: "scheduled", attendees: payload.attendeeIds.map(userId => ({ userId, status: userId === people[0]!.id ? "accepted" : "pending" })), canRespond: false, canEdit: true, createdAt: now, updatedAt: now };
    setScheduleEvents(current => [...current, event]);
    return event;
  };
  const [messages, setMessages] = useState<readonly ChatMessage[]>(initialMessages);
  const sendPreviewMessage = async (chatId: string, body: string) => {
    const message: ChatMessage = { id: crypto.randomUUID(), chatId, authorId: "aziza", body, time: "12:05", createdAt: new Date().toISOString(), own: true };
    setMessages(current => [...current, message]);
    return message;
  };
  const showGroupedPreview = () => setMessages([
    ...initialMessages,
    ...["Первое сообщение группы", "Второе сообщение группы", "Последнее сообщение группы"].map((body, index): ChatMessage => ({ id: `qa-group-${index}`, chatId: "finance", authorId: "baxtiyor", body, time: `12:0${index}`, createdAt: `2026-10-12T09:0${index}:00Z` })),
    { id: "qa-long", chatId: "finance", authorId: "dilshod", body: "Длинное одиночное сообщение: проверяем, что аватар остаётся у нижнего края, а текст не сдвигается. ".repeat(6), time: "12:04", createdAt: "2026-10-12T09:04:00Z" },
  ]);
  const previewSamples = ["Word.docx", "План.xlsx", "Изображение.svg", "Документ.pdf"].map((fileName, index): WorkspaceAttachment => ({
    id: `qa-preview-${index}`, fileName, ownerType: "task", ownerId: "qa-task", contentType: index === 2 ? "image/svg+xml" : "application/octet-stream", byteSize: 12000, sha256: "qa", uploadedByUserId: "qa", documentRole: "general", createdAt: "2026-10-12T10:00:00Z",
  }));
  const loadPreviewBlob = async (file: WorkspaceAttachment) => {
    if (file.fileName.endsWith("pdf")) {
      const stream = "BT /F1 22 Tf 60 740 Td (Workspace - built-in PDF preview) Tj ET";
      const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
      let pdf = "%PDF-1.4\n";
      const offsets = [0];
      objects.forEach((object, index) => {offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;});
      const xref = pdf.length;
      pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
      return new Blob([pdf], {type:"application/pdf"});
    }
    return new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="900" height="550"><rect width="900" height="550" fill="#e5f3f4"/><rect x="80" y="80" width="740" height="390" rx="32" fill="#fff"/><text x="140" y="190" font-size="32" fill="#293a55">Workspace · Preview</text><circle cx="190" cy="330" r="64" fill="#0091a8"/></svg>'], {type:"image/svg+xml"});
  };
  const previewOffice = async (file: WorkspaceAttachment, sheet: number, offset: number): Promise<OfficeFilePreview> => ({
    kind: file.fileName.endsWith("xlsx") ? "excel" : "word", sheetIndex: sheet, rowOffset: offset, totalRows: 420, truncated: false,
    sheets: ["Рабочий план", "Итоги"], rows: Array.from({length: Math.min(200, 420 - offset)}, (_, index) => [`${offset + index + 1}`, "Подготовка встречи", "13 октября", "В работе"]),
    blocks: [{kind: "paragraph", text: "План рабочей встречи", rows: []}, {kind: "paragraph", text: "Согласуем повестку, материалы и следующие шаги команды. Документ показан в режиме чтения: исходный файл остаётся без изменений.", rows: []}, {kind: "table", text: "", rows: [["Пункт", "Ответственный", "Срок"], ["Подготовить материалы", "Рабочая группа", "13 октября"], ["Подтвердить участников", "Координатор", "14 октября"]]}],
  });
  const taskSamples = [1, 2, 5].map(days => {
    const due = new Date();
    due.setDate(due.getDate() + days);
    due.setHours(13, 0, 0, 0);
    return { ...initialTasks[0]!, id: `qa-deadline-${days}`, title: `Тестовая задача · до срока ${days} дн.`, dueAt: due.toISOString(), dueLabel: due.toLocaleString("ru-RU"), priority: "urgent" as const,
      participants: [{ userId: "aziza", role: "co_assignee" as const }, { userId: "malika", role: "observer" as const }],
    };
  });
  const simulateFileDrag = (kind: "dragenter" | "drop" | "dragend") => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["Synthetic drag/drop QA only"], "qa-drop.txt", { type: "text/plain", lastModified: 1 }));
    document.querySelector(".messenger-file-drop-surface")?.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer }));
  };
  const nav = [
    { id: "notifications", label: "Уведомления", icon: <Alert20Regular /> },
    { id: "calendar", label: "Календарь", icon: <Calendar20Regular /> },
    { id: "payments", label: "Заявки на оплату", icon: <ReceiptMoney20Regular /> },
    { id: "messenger", label: "Мессенджер", icon: <Chat20Regular /> },
    { id: "zoom", label: "Zoom-конференции", icon: <Video20Regular /> },
    { id: "trips", label: "Командировки", icon: <Calendar20Regular /> },
    { id: "tasks", label: "Задачи", icon: <Grid20Regular /> },
    { id: "files", label: "Просмотр файлов", icon: <Grid20Regular /> },
    { id: "letters", label: "Входящие письма", icon: <ReceiptMoney20Regular /> },
    { id: "samples", label: "Компоновка разделов", icon: <Grid20Regular /> },
  ];
  return <FluentProvider theme={workspaceTheme} className="app-provider">
    <UndoActionsProvider><ScrollbarEdges />
      <div className={`app-shell${compact ? " browser-compact" : ""}`}>
        <aside className="app-rail sidebar-palette" data-sidebar-theme="gradient" style={compact ? { display: "none" } : undefined}>
          <div className="workspace-logo"><strong>YUKSALISH</strong></div>
          <div className="rail-customize">Тестовый стенд</div>
          <nav className="rail-nav" aria-label="Разделы стенда">{nav.map(item => <button key={item.id} aria-label={item.label} className={`rail-action ${section === item.id ? "active" : ""}`} onClick={() => setSection(item.id)}><span className="rail-icon">{item.icon}</span><span className="rail-label">{item.label}</span></button>)}</nav>
        </aside>
        <div className="app-stage">
          <header className="global-bar qa-canvas-toolbar"><span>Проверка подложек и отступов · без рабочих данных</span>
            <SectionJump items={jumpItems.map(([key, label]) => ({ key, label, icon: <Grid20Regular /> }))} onNavigate={() => {}} />
            {section === "samples" && <select aria-label="Макет раздела" value={sample} onChange={event => setSample(Number(event.target.value))}>{roots.map(([label], i) => <option key={label} value={i}>{label}</option>)}</select>}
            {section === "messenger" && <div className="qa-file-drop-actions">
              <button type="button" onClick={() => simulateFileDrag("dragenter")}>QA: готовность принять файл</button>
              <button type="button" onClick={() => simulateFileDrag("drop")}>QA: drop тестового файла</button>
              <button type="button" onClick={() => simulateFileDrag("dragend")}>QA: отмена drag</button>
              <button type="button" onClick={showGroupedPreview}>QA: группа и длинный текст</button>
            </div>}
          </header>
          <WorkspaceSectionContent authorityKey="qa-layout" section={`${section}:${sample}`}>
            {section === "notifications" ? <NotificationCenter notifications={notifications} preferences={{ desktopEnabled: true, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true, tripsEnabled: true, calendarEnabled: true, absencesEnabled: true, zoomEnabled: true, remindersEnabled: true }} onOpen={nothing} onMarkRead={nothing} onMarkAllRead={nothing} onUpdatePreferences={nothing} />
            : section === "calendar" ? <CalendarView events={scheduleEvents} people={zoomPeople} departments={zoomDepartments} canInviteCalendarAudience currentUserId={people[0]!.id} onCreate={createPreviewEvent} onUpdate={nothing} onCancel={nothing} />
            : section === "payments" ? <ApprovalsView token="qa-only" canManage={false} canCreateRequest={false} isSuperadmin={false} currentUserId={people[0]!.id} people={people} positions={[]} requests={requests} calendarEvents={[]} attachments={[]} onSaveWorkflow={nothing} onPublishWorkflow={nothing} onCreateRequest={nothing} onAction={nothing} onDeleteRequest={nothing} onReviseRequest={nothing} onUploadAttachments={nothing} onDownloadAttachment={nothing} />
            : section === "messenger" ? <MessengerView token="qa-only" currentUserId="aziza" currentUserRole="employee" chats={initialChats} messages={messages} tasks={[]} attachments={[]} people={people}
              chatActions={{ create: async () => initialChats[0]!, update: async () => initialChats[0]!, add: async () => initialChats[0]!, setMember: async () => initialChats[0]!, transfer: async () => initialChats[0]!, remove: nothing, delete: nothing }}
              onSendMessage={sendPreviewMessage} onSendVoiceMessage={nothing} onReactMessage={nothing} onPinMessage={nothing} onEditMessage={nothing} onDeleteMessage={nothing} onCreateTaskFromMessage={nothing} onDownloadAttachment={nothing} onLoadAttachment={async () => new Blob()} onMarkRead={nothing} />
            : section === "zoom" ? <ZoomView token="qa-only" people={zoomPeople} departments={zoomDepartments} currentUserId={people[0]!.id} registry={{ configured: true, timezone: "Asia/Tashkent", reminderMinutes: 30, bookingHorizonDays: 180, slotMinutes: 15, meetings: [] }} loading={false} onRefresh={nothing} />
             : section === "trips" ? <TripApprovalsView requests={[]} people={people} currentUser={people[0]!} onCreate={nothing} onUpdate={nothing} onAction={nothing} />
              : section === "team" ? <section className="workspace-view tasks-view bp5-tasks dashboard-mode"><TeamDashboardView token="qa-only" currentUserId={people[0]!.id} people={people} tasks={initialTasks} efficiencyLoading={false} onSelectTask={nothing} /></section>
              : section === "tasks" ? <section className="workspace-view tasks-view bp5-tasks"><TaskRecords tasks={taskSamples} people={people} filterKey="qa" selectedId={selectedTask} onSelect={setSelectedTask} /></section>
              : section === "home" ? <PersonalHomeView token="qa-only" workspace={homeFixture("aziza")} canView={() => true} onOpen={() => undefined} onOpenNotification={() => undefined} onRefresh={nothing} />
              : section === "survey" ? <div style={{ display: "contents" }}><SurveyAnalyticsView token="qa-only" canCreate={false} canEdit={false} /></div>
              : section === "letters" ? <QaIncomingLetters />
              : section === "files" ? <section className="qa-canvas-sample-card"><h2>Встроенный просмотрщик · тестовые данные</h2>{previewSamples.map(file => <button key={file.id} onClick={() => setPreviewFile(file)}>{file.fileName}</button>)}</section>
            : <section className={roots[sample]![1]} aria-label={`Макет: ${roots[sample]![0]}`}>
              <WorkspaceSectionHeader motif="tasks"><div><h1>{roots[sample]![0]}</h1><p>Проверка внешнего контейнера, не рабочая страница раздела.</p></div></WorkspaceSectionHeader>
              <div className="qa-canvas-sample-card"><h2>Карточки остаются самостоятельными</h2><p>Корень страницы не перекрашивается. Только существующие белые рабочие панели расширяются вместо внешней стеклянной рамки.</p></div>
            </section>}
          </WorkspaceSectionContent>
        </div>
      </div>
      {previewFile && <FileViewer key={previewFile.id} attachment={previewFile} onClose={() => setPreviewFile(undefined)} onDownload={nothing} onLoadOffice={previewOffice} onLoad={loadPreviewBlob} />}
    </UndoActionsProvider>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
