// Development-only preview; uses the existing test fixtures and makes no API calls.
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import type { WorkspaceTask } from "@yuksalish/contracts";
import { EmployeeProfileProvider } from "../src/renderer/EmployeeProfileLink";
import { TaskRecords } from "../src/renderer/TaskRecords";
import { initialTasks, people } from "../src/renderer/test-fixtures/demo-data";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/design-system.css";
import "../src/renderer/motion.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/record-lists.css";
import "../src/renderer/workspace-2-tasks.css";

const tasks: WorkspaceTask[] = initialTasks.slice(0, 4).map((task, index) => ({
  ...task,
  participants: index === 0 ? [
    { userId: "aziza", role: "co_assignee" },
    { userId: "malika", role: "observer" },
  ] : index === 1 ? [{ userId: "dilshod", role: "observer" }] : task.participants,
}));

createRoot(document.getElementById("root")!).render(<FluentProvider theme={workspaceTheme} className="app-provider">
  <EmployeeProfileProvider onOpenProfile={() => {}}>
    <main className="tasks-view bp5-tasks" style={{ boxSizing: "border-box", display: "flex", flexDirection: "column", height: "100dvh", padding: "32px 22px" }}>
      <header style={{ padding: "0 22px 20px" }}><h1 style={{ margin: 0 }}>Задачи</h1><p style={{ margin: "4px 0 0", color: "#607183" }}>Визуальная проверка участников списка</p></header>
      <TaskRecords tasks={tasks} people={people} currentUserId="malika" filterKey="qa" onSelect={() => {}} />
    </main>
  </EmployeeProfileProvider>
</FluentProvider>);
