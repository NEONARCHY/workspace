// Synthetic renderer fixture. Every API request is blocked or answered in memory.
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import type { LeaveRequest, TripRequest, WorkspacePerson, WorkspaceTask } from "@yuksalish/contracts";
import { LeaveView } from "../src/renderer/LeaveView";
import { TeamDashboardView } from "../src/renderer/TeamDashboardView";
import { TripApprovalsView } from "../src/renderer/TripApprovalsView";
import { EmployeeProfileProvider } from "../src/renderer/EmployeeProfileLink";
import { workspaceDarkTheme, workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/design-system.css";
import "../src/renderer/record-composer.css";
import "../src/renderer/motion.css";
import "../src/renderer/record-lists.css";
import "../src/renderer/team-dashboard.css";
import "../src/renderer/workday-presence.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workspace-2-projects-trips.css";
import "../src/renderer/trip-documents.css";
import "../src/renderer/trip-map.css";
import "../src/renderer/employee-scope.css";
import "../src/renderer/sliding-segmented.css";
import "../src/renderer/list-row-hover.css";
import "../src/renderer/section-headers.css";
import "../src/renderer/browser-responsive.css";
import "../src/renderer/dark-theme.css";
import "../src/renderer/workspace-field-borders.css";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "leaves";
const role = params.get("role") ?? "hr";
const dark = params.has("dark");
document.documentElement.dataset.colorTheme = dark ? "dark" : "light";
const people: WorkspacePerson[] = Array.from({ length: 30 }, (_, index) => ({
  id: `qa-${index}`, name: `Тестовый Сотрудник ${index + 1}`, initials: "ТС", role: "employee",
  color: "brand", jobTitle: "бош мутахассис",
}));
const leave: LeaveRequest = {
  id: "qa-leave", requesterUserId: "qa-0", applicationText: "Менга йиллик меҳнат таътили беришингизни сўрайман.",
  requestedStartsOn: "2030-11-01", requestedEndsOn: "2030-11-23",
  startsOn: null, endsOn: null, workYearStartsOn: null, workYearEndsOn: null,
  calendarDays: null, paidDays: null, tenureAdditionalDays: null, organizationEmploymentDate: "2019-11-01",
  returnOn: null, accountingOfficer: null, orderEmployeeName: null, orderJobTitle: null, orderSignerName: null,
  orderClause1: null, orderClause2: null, orderClause3: null, status: "pending_hr",
  statusLabel: "На проверке кадровой службы", orderNumber: null, orderYear: null, signedByUserId: null,
  approvedAt: null, canRevise: true, canReviewHr: role === "hr", canReviewDeputy: false,
  canWithdraw: role === "employee", hasOrder: false, actions: [],
  createdAt: "2026-10-19T10:00:00Z", updatedAt: "2026-10-19T10:00:00Z",
};
const trip: TripRequest = {
  id: "qa-trip", number: "QA-TR", requesterUserId: "qa-0", purpose: "Hamkorlar bilan loyiha natijalarini muhokama qilish",
  destination: "Samarqand", startDate: "2030-11-01", endDate: "2030-11-03", employeeIds: ["qa-0", "qa-1"],
  stage: "launch", stageLabel: "Запуск", status: "draft", statusLabel: "Черновик", canEdit: true,
  workflowVersion: 3, allowedActions: ["submit"], expenseSource: "loyiha mablagʻlari",
  briefFormat: "generated", briefText: "Xizmat safariga ruxsat berishingizni soʻrayman.",
  actions: [], createdAt: leave.createdAt, updatedAt: leave.updatedAt,
};
const tasks: WorkspaceTask[] = people.map((person, index) => ({
  id: `qa-task-${index}`, title: `Синтетическая задача ${index + 1}`, status: "in_progress",
  project: "QA", authorId: "qa-0", assigneeId: person.id, priority: "normal", dueLabel: "QA",
  checklistDone: 0, checklistTotal: 0, participants: [], checklist: [], comments: [], dependencies: [],
}));
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (!url.pathname.startsWith("/api/")) return nativeFetch(input, init);
  let result: unknown = { detail: "Изолированная проверка: сохранение отключено" };
  let status = 503;
  if ((init?.method ?? "GET") === "GET") {
    if (url.pathname.endsWith("/leave-requests/context")) {
      result = { hrUserId: "qa-1", deputyUserId: "qa-2", canConfigureSignature: false, signatureReady: false,
        tenureRules: [{ afterYears: 5, extraDays: 2 }, { afterYears: 10, extraDays: 4 }], canEditTenureRules: role === "hr" };
      status = 200;
    } else if (url.pathname.endsWith("/leave-requests")) { result = [leave]; status = 200; }
  }
  return new Response(JSON.stringify(result), { status, headers: { "Content-Type": "application/json" } });
};
const blocked = async () => { throw new Error("Изолированная проверка: сохранение отключено"); };
createRoot(document.getElementById("root")!).render(
  <FluentProvider theme={dark ? workspaceDarkTheme : workspaceTheme} className="app-provider"
    style={{ zoom: params.has("zoom") ? 2 : 1 }}>
    <EmployeeProfileProvider onOpenProfile={() => undefined}>
      <main className="launch-qa">
        {mode === "team" ? <TeamDashboardView token="qa" tasks={tasks} people={people}
          currentUserId="qa-0" efficiencyLoading={false} onSelectTask={() => undefined} />
        : mode === "trips" ? <TripApprovalsView requests={[trip]} people={people} currentUser={people[0]!}
          onCreate={blocked} onUpdate={blocked} onAction={blocked} />
        : <LeaveView token="qa" people={people} currentUserId={role === "hr" ? "qa-1" : "qa-0"}
          canCreate focusRequestId="qa-leave" />}
      </main>
    </EmployeeProfileProvider>
  </FluentProvider>,
);
