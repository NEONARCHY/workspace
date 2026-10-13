// Synthetic, browser-only QA: requests never reach a business server.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, FluentProvider } from "@fluentui/react-components";
import type { ApprovalRequestSummary, CalendarEvent, ProjectHubOverview, ProjectHubRequest, TripRequest } from "@yuksalish/contracts";
import { ProjectHubView } from "../src/renderer/ProjectHubView";
import { ApprovalsView } from "../src/renderer/ApprovalsView";
import { TripApprovalsView } from "../src/renderer/TripApprovalsView";
import { CalendarView } from "../src/renderer/CalendarView";
import { people } from "../src/renderer/test-fixtures/demo-data";
import { EmployeeProfileProvider } from "../src/renderer/EmployeeProfileLink";
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

const now = new Date();
now.setHours(10, 0, 0, 0);
const stamp = now.toISOString();
const project: ProjectHubOverview["projects"][number] = {
  id: "qa-project", code: "QA", title: "Тестовая региональная программа с длинным названием",
  description: "Только синтетические данные", managerUserId: people[0]!.id,
  responsibleUserIds: [people[1]!.id], approverUserIds: [people[1]!.id],
  startDate: null, endDate: "2030-12-31", budget: 1000000, currency: "UZS",
  accessStatus: "open", lifecycleStatus: "active", approvedAmount: 0, canEdit: true,
  createdByUserId: people[0]!.id, createdAt: stamp, updatedAt: stamp,
};
const workstream: ProjectHubOverview["workstreams"][number] = {
  id: "qa-stream", projectId: project.id, title: "Тестовое направление",
  description: "", startDate: null, endDate: null, sortOrder: 0, createdAt: stamp, updatedAt: stamp,
};
const item: ProjectHubOverview["items"][number] = {
  id: "qa-item", projectId: project.id, workstreamId: workstream.id, kind: "task",
  title: "Тестовая работа", description: "", startsAt: null, dueAt: null, budget: 100,
  status: "planned", assigneeUserIds: [people[0]!.id], calendarEventId: null,
  createdByUserId: people[0]!.id, createdAt: stamp, updatedAt: stamp,
  requestCount: 0, approvedRequestCount: 0, actions: [],
};
const funding: ProjectHubRequest[] = Array.from({ length: 24 }, (_, i) => ({
  id: `qa-funding-${i}`, projectId: project.id, projectTitle: project.title,
  itemId: item.id, itemTitle: item.title, title: `Тестовая проектная заявка ${i + 1}`,
  purpose: "Проверка компоновки", amount: 100, currency: "UZS",
  status: (["draft", "pending", "approved", "rejected"] as const)[i % 4]!,
  approverUserIds: project.approverUserIds, currentStep: 0,
  requesterUserId: people[0]!.id, canDecide: false, actions: [], attachments: [],
  createdAt: stamp, updatedAt: stamp,
}));
const hub: ProjectHubOverview = { projects: [project, { ...project, id: "qa-project-2", code: "QA2", title: "Второй тестовый проект" }],
  workstreams: [workstream], items: [item], requests: funding };
const payments: ApprovalRequestSummary[] = Array.from({ length: 12 }, (_, i) => ({
  id: `qa-payment-${i}`, number: String(700 + i), title: `Тестовая оплата ${i + 1}: длинное название`,
  amount: 350000, currency: "UZS", purpose: "Только QA", status: "running",
  statusLabel: "Ожидает решения", stageLabel: "Новая заявка", activeNodeKeys: ["start"],
  activeStages: [{ key: "start", label: "Новая заявка", kind: "start", canAct: false }],
  requesterId: people[0]!.id, responsibleUserId: people[0]!.id,
  details: { projectName: project.title, projectCode: "QA", sourceAccount: "Тестовый счёт",
    destinationAccount: "Тестовый получатель", requestPriority: "normal", comment: "",
    tripPurpose: "", employeeIds: [], paymentReason: "Тест" },
  createdAt: stamp, updatedAt: stamp, revision: 1, versions: [], actions: [],
}));
const trips: TripRequest[] = Array.from({ length: 12 }, (_, i) => ({
  id: `qa-trip-${i}`, number: `TR-QA-${i + 1}`, requesterUserId: people[0]!.id,
  purpose: "Тестовая встреча с региональной командой", destination: "Самарканд",
  startDate: "2030-10-01", endDate: "2030-10-02", employeeIds: [people[0]!.id],
  stage: "launch", stageLabel: "Запуск", status: "draft", statusLabel: "Черновик",
  canEdit: true, allowedActions: ["submit"], actions: [], createdAt: stamp, updatedAt: stamp,
}));
const events: CalendarEvent[] = Array.from({ length: 5 }, (_, i) => ({
  id: `qa-event-${i}`, organizerUserId: people[0]!.id, title: `Тестовая встреча ${i + 1}`,
  description: "Только QA", eventType: "meeting",
  startsAt: new Date(now.getTime() + i * 3600000).toISOString(),
  endsAt: new Date(now.getTime() + (i + 1) * 3600000).toISOString(),
  allDay: false, location: "Переговорная", status: "scheduled", attendeeIds: [people[0]!.id],
  attendees: [], canRespond: false, canEdit: true, createdAt: stamp, updatedAt: stamp,
}));
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (!url.pathname.startsWith("/api/")) return nativeFetch(input, init);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (method !== "GET") return Response.json({ detail: "QA: тестовый отказ, черновик сохранён" }, { status: 503 });
  if (url.pathname.endsWith("/project-hub/requests")) return Response.json(funding);
  if (url.pathname.endsWith("/budget")) return Response.json({ remainingProjectAmount: "999999", actualByCurrency: [], articles: [{ id: "qa-article", title: "Тестовая бюджетная статья с длинным названием", funding: "donor", amount: "1000000.25", actualAmount: "0", remainingAmount: "1000000.25", currency: "UZS" }] });
  if (url.pathname.endsWith("/payment-targets") || url.pathname.endsWith("/calendar-targets")) return Response.json({ projects: [], workstreams: [], items: [] });
  if (url.pathname.endsWith("/availability")) return Response.json({ intervals: [] });
  if (url.pathname.endsWith("/project-hub") || url.pathname.endsWith("/request-targets")) return Response.json(hub);
  return Response.json([]);
};
const rejectSave = async (): Promise<never> => { throw new Error("QA: тестовый отказ, черновик сохранён"); };
function Fixture() {
  const workspaceTheme = useQaTheme();
  const canManage = new URLSearchParams(location.search).has("workflow");
  const [page, setPage] = useState("projects");
  useEffect(() => { document.documentElement.classList.add("web-platform"); return observeBrowserViewport(); }, []);
  return <FluentProvider theme={workspaceTheme} className="app-provider"><EmployeeProfileProvider onOpenProfile={() => {}}>
    <div className="app-shell browser-compact"><div className="app-stage">
      <header style={{ display: "flex", flexWrap: "wrap", gap: 4, paddingBottom: 8 }}>
        {["projects", "funding", "payments", "trips", "calendar"].map((key, i) => <Button key={key} onClick={() => setPage(key)} aria-pressed={key === page} style={{ minHeight: 48 }}>{["Проекты", "Проектные", "Оплаты", "Поездки", "Календарь"][i]}</Button>)}
      </header><main className="app-content" id="workspace-content">
        {page === "projects" || page === "funding" ? <ProjectHubView key={page} mode={page === "projects" ? "projects" : "funding"} token="qa-only" people={people} currentUserId={people[0]!.id} canCreateProject canCreateRequest canViewFunding /> : null}
        {page === "payments" ? <ApprovalsView token="qa-only" canManage={canManage} canCreateRequest currentUserId={people[0]!.id} people={people} positions={[]} requests={payments} calendarEvents={events} attachments={[]} onSaveWorkflow={rejectSave} onPublishWorkflow={rejectSave} onCreateRequest={rejectSave} onAction={rejectSave} onDeleteRequest={rejectSave} onReviseRequest={rejectSave} onUploadAttachments={rejectSave} onDownloadAttachment={rejectSave} /> : null}
        {page === "trips" ? <TripApprovalsView requests={trips} people={people} currentUser={people[0]!} onCreate={rejectSave} onUpdate={rejectSave} onAction={rejectSave} /> : null}
        {page === "calendar" ? <CalendarView events={events} people={people} currentUserId={people[0]!.id} onCreate={rejectSave} onUpdate={rejectSave} onCancel={rejectSave} /> : null}
      </main>
    </div></div>
  </EmployeeProfileProvider></FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
