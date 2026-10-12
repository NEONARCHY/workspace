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
import "../src/renderer/accent-surfaces.css";
import "../src/renderer/list-row-hover.css";

const offsets = [2, 1, 0, -1, 7];
const today = new Date();
const titles = ["До срока два дня — жёлтая подсветка", "До срока один день — красная подсветка", "Срок сегодня — красная подсветка", "Срок истёк — красная подсветка", "Срочный приоритет без близкого дедлайна"];
const tasks: WorkspaceTask[] = offsets.map((offset, index) => ({
  ...initialTasks[index % initialTasks.length]!,
  id: `qa-deadline-${index}`,
  title: titles[index]!, status: "new", priority: index === 4 ? "urgent" : "normal",
  dueAt: new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, 23, 59).toISOString(),
  dueLabel: new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, 23, 59).toLocaleString("ru-RU"),
  participants: index === 0 ? [
    { userId: "aziza", role: "co_assignee" },
    { userId: "malika", role: "observer" },
  ] : index === 1 ? [{ userId: "dilshod", role: "observer" }] : [],
}));

createRoot(document.getElementById("root")!).render(<FluentProvider theme={workspaceTheme} className="app-provider">
  <EmployeeProfileProvider onOpenProfile={() => {}}>
    <main className="tasks-view bp5-tasks" style={{ boxSizing: "border-box", display: "flex", flexDirection: "column", height: "100dvh", padding: "32px 22px" }}>
      <header style={{ padding: "0 22px 20px" }}><h1 style={{ margin: 0 }}>Задачи</h1><p style={{ margin: "4px 0 0", color: "#607183" }}>Визуальная проверка участников списка</p></header>
      <TaskRecords tasks={tasks} people={people} currentUserId="malika" filterKey="qa" onSelect={() => {}} />
    </main>
  </EmployeeProfileProvider>
</FluentProvider>);
