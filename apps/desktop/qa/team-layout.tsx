// Read-only QA fixture: real components with synthetic data, no business API calls.
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import type { WorkspaceDepartment, WorkspacePerson, WorkspaceTask } from "@yuksalish/contracts";
import { TeamDashboardView } from "../src/renderer/TeamDashboardView";
import { DepartmentManagement } from "../src/renderer/DepartmentManagement";
import { EmployeeProfileProvider } from "../src/renderer/EmployeeProfileLink";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/design-system.css";
import "../src/renderer/record-lists.css";
import "../src/renderer/team-dashboard.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/employee-scope.css";
import "../src/renderer/sliding-segmented.css";

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ detail: "Тестовый просмотр: изменения отключены" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  }
  return nativeFetch(input, init);
};

const people: readonly WorkspacePerson[] = [{
  id: "qa-employee", name: "Тестовый сотрудник", initials: "ТС", role: "employee",
  color: "brand", departmentId: "qa-central",
}];
const departments: readonly WorkspaceDepartment[] = [
  { id: "qa-central", name: "Тестовый отдел ЦА", code: "qa-central", scope: "central",
    assignedUsersCount: 1, memberIds: ["qa-employee"] },
  { id: "qa-region", name: "Тестовое региональное подразделение", code: "qa-region",
    scope: "regional", assignedUsersCount: 0, memberIds: [] },
];
const tasks: readonly WorkspaceTask[] = (["new", "in_progress", "awaiting_review", "overdue"] as const)
  .map((status, index) => ({
    id: `qa-task-${index}`, title: `Тестовая задача ${index + 1}`, status,
    project: "Проверка компоновки", authorId: "qa-employee", assigneeId: "qa-employee",
    priority: "normal", dueLabel: "Тестовый срок",
    dueAt: new Date(Date.now() + (status === "overdue" ? -1 : 3) * 86_400_000).toISOString(),
    checklistDone: 0, checklistTotal: 0, participants: [], checklist: [], comments: [], dependencies: [],
  }));

createRoot(document.getElementById("root")!).render(
  <FluentProvider theme={workspaceTheme}>
    <EmployeeProfileProvider onOpenProfile={() => undefined}>
      <main className="layout-qa">
        <header>Тестовый просмотр: синтетические данные, сохранение отключено.</header>
        <section className="qa-section" aria-label="Обзор команды">
          <TeamDashboardView token="qa-no-real-token" currentUserId="qa-employee"
            tasks={tasks} people={people} departments={departments} efficiencyLoading={false}
            onSelectTask={() => undefined} />
        </section>
        <section className="qa-section" aria-label="Структура">
          <DepartmentManagement token="qa-no-real-token" departments={departments} employees={[]}
            onChanged={() => undefined} />
        </section>
      </main>
    </EmployeeProfileProvider>
  </FluentProvider>,
);
