// Test-only domain fixture. All business effects are local; no user records are changed.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, FluentProvider } from "@fluentui/react-components";
import type { DirectoryEmployee } from "@yuksalish/contracts";
import { MessengerView } from "../src/renderer/MessengerView";
import { TaskRecords } from "../src/renderer/TaskRecords";
import { EmployeeRecords } from "../src/renderer/EmployeeRecords";
import { TaskComposer } from "../src/renderer/TaskComposer";
import { EmployeeProfileProvider } from "../src/renderer/EmployeeProfileLink";
import { initialChats, initialMessages, initialTasks, people } from "../src/renderer/test-fixtures/demo-data";
import { observeBrowserViewport } from "../src/renderer/browser-layout";
import { useQaTheme } from "./color-theme";
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
import "../src/renderer/forwarding.css";
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

const tasks = Array.from({ length: 31 }, (_, i) => ({ ...initialTasks[0]!, id: `mobile-task-${i}`, title: `Тестовая задача ${i + 1}: длинное название для проверки переноса без потери текста` }));
const employees: DirectoryEmployee[] = Array.from({ length: 31 }, (_, i) => ({ id: `mobile-person-${i}`, name: `Тестовый сотрудник ${i + 1}`, username: `synthetic-${i}`, jobTitle: "Длинная тестовая должность сотрудника регионального подразделения", role: "employee", status: "active" }));
const chatActions = { create: async () => initialChats[0]!, update: async () => initialChats[0]!, add: async () => initialChats[0]!, setMember: async () => initialChats[0]!, remove: async () => undefined, transfer: async () => initialChats[0]!, delete: async () => undefined, dismiss: async () => undefined };
function Fixture() {
  const workspaceTheme = useQaTheme();
  const [page, setPage] = useState("messenger");
  const [form, setForm] = useState(false);
  const [selected, setSelected] = useState(new Set<string>());
  const [notice, setNotice] = useState("");
  useEffect(() => { document.documentElement.classList.add("web-platform"); return observeBrowserViewport(); }, []);
  return <FluentProvider theme={workspaceTheme} className="app-provider"><EmployeeProfileProvider onOpenProfile={() => setNotice("Открыт тестовый профиль")}>
    <div className="app-shell browser-compact"><div className="app-stage">
      <header style={{ display: "flex", gap: 4, flexWrap: "wrap", paddingBottom: 8 }}>
        {["messenger", "tasks", "employees"].map((key, i) => <Button key={key} aria-pressed={page === key} onClick={() => setPage(key)} style={{ minHeight: 48 }}>{["Чаты", "Задачи", "Люди"][i]}</Button>)}
        <Button onClick={() => setForm(true)} style={{ minHeight: 48 }}>Форма</Button>
        {notice && <span role="status">{notice}</span>}
      </header>
      <main className="app-content" id="workspace-content" tabIndex={-1}>
        <div style={{ display: page === "messenger" ? "contents" : "none" }}><MessengerView token="synthetic-only" currentUserId="aziza" currentUserRole="employee"
          chats={initialChats} messages={initialMessages} tasks={initialTasks} people={people} attachments={[]} chatActions={chatActions}
          onSendMessage={async (_chat, _body, files) => { if (files[0]?.type.startsWith("audio/")) { document.documentElement.dataset.qaVoiceMime = files[0].type; document.documentElement.dataset.qaVoiceRoute = "file"; } throw new Error("Тестовая ошибка отправки"); }} onSendVoiceMessage={async (_chat, file) => { document.documentElement.dataset.qaVoiceMime = file.type; document.documentElement.dataset.qaVoiceRoute = "voice"; return undefined; }}
          onReactMessage={async () => undefined} onPinMessage={async () => undefined} onEditMessage={async () => undefined}
          onDeleteMessage={async () => undefined} onCreateTaskFromMessage={async () => undefined}
          onDownloadAttachment={async () => undefined} onLoadAttachment={async () => new Blob()}
          onMarkRead={async () => undefined} onPersonalChat={async () => undefined} /></div>
        <div style={{ display: page === "tasks" ? "flex" : "none", height: "100%", minHeight: 0 }}><TaskRecords tasks={tasks} people={people} currentUserId="aziza" filterKey="all" onSelect={() => setNotice("Открыта тестовая задача")} /></div>
        <div style={{ display: page === "employees" ? "flex" : "none", height: "100%", minHeight: 0 }}><EmployeeRecords token="synthetic-only" employees={employees} departments={[]} filterKey="all" selectedIds={selected} onOpen={() => setNotice("Управление тестовым сотрудником")}
          onToggle={(id, checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; })}
          onTogglePage={(ids, checked) => setSelected((current) => { const next = new Set(current); for (const id of ids) { if (checked) next.add(id); else next.delete(id); } return next; })} /></div>
      </main>
    </div></div>
    {form && <TaskComposer open people={people} tasks={initialTasks} currentUserId="aziza" onClose={() => setForm(false)} onSubmit={async () => { throw new Error("Тестовая ошибка сохранения"); }} />}
  </EmployeeProfileProvider></FluentProvider>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<Fixture />);
import.meta.hot?.dispose(() => root.unmount());
