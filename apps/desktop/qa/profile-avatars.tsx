// Synthetic identities and intercepted reads only; no production requests or writes.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, FluentProvider } from "@fluentui/react-components";
import type { DirectoryEmployee, EfficiencyOverview, WorkdayTeam, WorkspaceDepartment } from "@yuksalish/contracts";
import { TeamPresencePanel } from "../src/renderer/TeamPresencePanel";
import { EmployeeRecords } from "../src/renderer/EmployeeRecords";
import { DepartmentManagement } from "../src/renderer/DepartmentManagement";
import { EfficiencyView } from "../src/renderer/EfficiencyView";
import { EmployeeProfileProvider } from "../src/renderer/EmployeeProfileLink";
import { notifyProfileAvatarChanged } from "../src/renderer/ProfileAvatar";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/design-system.css";
import "../src/renderer/record-lists.css";
import "../src/renderer/team-dashboard.css";
import "../src/renderer/workday-presence.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/employee-scope.css";
import "../src/renderer/sliding-segmented.css";
import "../src/renderer/context-motion.css";
import "../src/renderer/list-row-hover.css";
import "../src/renderer/page-canvas.css";

const token = "qa-avatar-no-real-token";
let currentFixtureVersion = "v1";
const employees: readonly DirectoryEmployee[] = [
  { id: "qa-photo", name: "Тест Фото", username: "qa-photo", role: "employee", status: "active", departmentId: "qa-dept", jobTitle: "Тестовая должность", avatarVersion: "v1" },
  { id: "qa-initials", name: "Тест Инициалы", username: "qa-initials", role: "employee", status: "active", departmentId: "qa-dept", jobTitle: "Без фотографии", avatarVersion: null },
];
const departments: readonly WorkspaceDepartment[] = [{ id: "qa-dept", name: "Тестовый отдел", code: "qa", scope: "central", assignedUsersCount: 2, memberIds: employees.map(person => person.id) }];
const team: WorkdayTeam = { asOf: new Date().toISOString(), workingCount: 2, members: employees.map(person => ({
  userId: person.id, name: person.name, jobTitle: person.jobTitle ?? null, avatarVersion: person.avatarVersion, status: "working",
  schedule: { userId: person.id, startsAt: "09:00:00", endsAt: "18:00:00" }, session: null, absenceKind: null, canEditSchedule: false,
})) };
const overview: EfficiencyOverview = {
  period: "2026-10", timezone: "Asia/Tashkent", methodologyVersion: "EFF-2.0", trackingStartedAt: "2026-10-01T00:00:00Z", currentUserId: employees[0]!.id,
  employees: employees.map(person => ({ userId: person.id, name: person.name, avatarVersion: person.avatarVersion, jobTitle: person.jobTitle!, period: "2026-10", timezone: "Asia/Tashkent", percentage: null, onTimeCount: 0, eligibleCount: 0, overdueCount: 0, awaitingReviewCount: 0, noDueDateCount: 0, returnedForRevisionCount: 0, excludedCount: 0, sampleSize: 0, methodologyVersion: "EFF-2.0", trackingStartedAt: "2026-10-01T00:00:00Z", historyCompleteness: "complete", smallSample: false, history: [] })),
};
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (!url.pathname.startsWith("/api/")) return nativeFetch(input, init);
  if (url.pathname === "/api/v1/workday/team") return Response.json({ ...team, members: team.members.map(person => person.userId === "qa-photo" ? { ...person, avatarVersion: currentFixtureVersion } : person) });
  if (url.pathname === "/api/v1/profile/avatar/qa-photo") {
    const version = url.searchParams.get("version");
    if (version === "failed") return Response.json({ detail: "Тестовая ошибка фото" }, { status: 503 });
    const color = version === "v1" ? "#0091a8" : "#6b53a0";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="${color}"/><circle cx="60" cy="43" r="22" fill="#f7d5bc"/><path d="M16 120V107C16 68 104 68 104 107V120" fill="#293a55"/></svg>`;
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
  }
  return Response.json({ detail: "Стенд: остальные запросы и сохранение отключены" }, { status: 403 });
};

function Stand() {
  const [section, setSection] = useState("team");
  const [version, setVersion] = useState("v1");
  const changePhoto = (next: string) => { currentFixtureVersion = next; setVersion(next); notifyProfileAvatarChanged("qa-photo", next); };
  const shownEmployees = employees.map(person => person.id === "qa-photo" ? { ...person, avatarVersion: version } : person);
  const shownOverview = { ...overview, employees: overview.employees.map(person => person.userId === "qa-photo" ? { ...person, avatarVersion: version } : person) };
  return <FluentProvider theme={workspaceTheme} className="app-provider">
    <EmployeeProfileProvider onOpenProfile={() => undefined}>
      <header style={{ padding: 20, display: "grid", gap: 12 }}>
        <strong>Аватарки: реальные компоненты, вымышленные сотрудники. Запись на сервер отключена.</strong>
        <nav aria-label="Раздел стенда" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{[["team", "Команда в работе"], ["employees", "Сотрудники"], ["departments", "Состав отдела"], ["efficiency", "Эффективность"]].map(([key, label]) => <Button key={key} aria-pressed={section === key} onClick={() => setSection(key!)}>{label}</Button>)}</nav>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><Button onClick={() => changePhoto(version === "v2" ? "v3" : "v2")}>Сменить тестовое фото</Button><Button onClick={() => changePhoto("failed")}>Ошибка загрузки</Button><span role="status">Версия: {version}</span></div>
      </header>
      <main className="app-content" style={{ position: "relative", margin: 20, minHeight: 500 }}>
        {section === "team" ? <TeamPresencePanel token={token} /> : null}
        {section === "employees" ? <EmployeeRecords token={token} employees={shownEmployees} departments={departments} filterKey="qa" selectedIds={new Set()} onOpen={() => undefined} onToggle={() => undefined} onTogglePage={() => undefined} /> : null}
        {section === "departments" ? <DepartmentManagement token={token} employees={shownEmployees} departments={departments} onChanged={() => undefined} /> : null}
        {section === "efficiency" ? <EfficiencyView token={token} overview={shownOverview} loading={false} onPeriodChange={() => undefined} /> : null}
      </main>
    </EmployeeProfileProvider>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Stand />);
