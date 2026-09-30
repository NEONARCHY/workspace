// Development-only fixture for inspecting the team picker at desktop and compact widths.
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import type { WorkspaceDepartment, WorkspacePerson } from "@yuksalish/contracts";

import { TaskComposer } from "../src/renderer/TaskComposer";
import { people as demoPeople } from "../src/renderer/test-fixtures/demo-data";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/design-system.css";
import "../src/renderer/record-composer.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workspace-2-tasks.css";
import "../src/renderer/workspace-inputs.css";

const people: readonly WorkspacePerson[] = [
  ...demoPeople.map((person) => ({ ...person, departmentId: "central-team" })),
  {
    id: "regional-lead", username: "regional-lead", name: "Дилором Аминова",
    initials: "ДА", role: "manager", departmentId: "regional-team",
    jobTitle: "Руководитель территориального подразделения", color: "#477681",
  },
  {
    id: "regional-specialist", username: "regional-specialist", name: "Жасур Рахматуллаев",
    initials: "ЖР", role: "employee", departmentId: "regional-team",
    jobTitle: "Главный специалист территориального подразделения", color: "#75946d",
  },
];

const departments: readonly WorkspaceDepartment[] = [
  {
    id: "central-team", code: "communications", name: "Коммуникации и общественные инициативы",
    scope: "central", assignedUsersCount: 4,
    memberIds: demoPeople.map((person) => person.id), leadUserId: "baxtiyor",
  },
  {
    id: "regional-team", code: "regional-team", name: "Каракалпакстан: территориальное подразделение",
    scope: "regional", assignedUsersCount: 2,
    memberIds: ["regional-lead", "regional-specialist"], leadUserId: "regional-lead",
  },
];

createRoot(document.getElementById("root")!).render(
  <FluentProvider theme={workspaceTheme}>
    <TaskComposer open people={people} departments={departments} tasks={[]}
      currentUserId="aziza" initialTitle="Подготовить совместный отчёт"
      onClose={() => undefined} onSubmit={() => undefined} />
  </FluentProvider>,
);

window.setTimeout(() => {
  const section = [...document.querySelectorAll<HTMLDetailsElement>("details.record-section")]
    .find((item) => item.querySelector("summary strong")?.textContent === "Команда");
  if (!section) return;
  section.open = true;
  window.setTimeout(() => section.scrollIntoView({ block: "start", behavior: "instant" }), 500);
  const params = new URLSearchParams(window.location.search);
  if (params.has("department")) {
    section.querySelector<HTMLButtonElement>(".task-team-modes button:nth-child(2)")?.click();
    window.setTimeout(() => section.querySelector<HTMLButtonElement>(".task-team-option")?.click(), 100);
    return;
  }
  if (!params.has("added")) return;
  window.setTimeout(() => {
    section.querySelector<HTMLButtonElement>(".task-team-option")?.click();
    window.setTimeout(() => section.querySelector<HTMLButtonElement>(".task-team-actions .fui-Button")?.click(), 100);
  }, 100);
}, 250);
