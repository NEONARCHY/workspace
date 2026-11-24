import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import type { WorkspaceDepartment, WorkspacePerson } from "@yuksalish/contracts";
import { IncomingLettersView } from "../src/renderer/IncomingLettersView";
import { TasksView } from "../src/renderer/TasksView";
import { chairmanScenarioProps, chairmanScenarioTask } from "../src/renderer/test-fixtures/task-chairman-scenarios";
import { useQaTheme } from "./color-theme";
import "../src/renderer/styles.css";
import "../src/renderer/design-system.css";
import "../src/renderer/workspace-inputs.css";
import "../src/renderer/workspace-search.css";
import "../src/renderer/record-lists.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/employee-scope.css";
import "../src/renderer/sliding-segmented.css";
import "../src/renderer/motion.css";
import "../src/renderer/context-colors.css";
import "../src/renderer/dark-theme.css";
import "../src/renderer/satin-surfaces.css";

const departments: readonly WorkspaceDepartment[] = [
  { id: "central", code: "CA", name: "Центральный аппарат", scope: "central", assignedUsersCount: 3 },
  { id: "region", code: "REG", name: "Региональное управление", scope: "regional", assignedUsersCount: 0 },
  { id: "regional-unit", code: "REG-UNIT", name: "Отдел региона", parentId: "region", assignedUsersCount: 1 },
];
const people: readonly WorkspacePerson[] = [
  { id: "regional", name: "Региональный сотрудник QA", initials: "РС", role: "employee", color: "teal", status: "active", departmentId: "regional-unit" },
  { id: "author", name: "Постановщик QA", initials: "П", role: "admin", color: "teal", status: "active" },
  { id: "executor", name: "Исполнитель QA", initials: "И", role: "employee", color: "blue", status: "active" },
  { id: "co", name: "Соисполнитель QA", initials: "С", role: "employee", color: "teal", status: "active" },
];

function Fixture() {
  const theme = useQaTheme();
  const task = chairmanScenarioTask({ id: "execution-task", title: "Письмо QA-184", incomingDocumentId: "source",
    authorId: "author", assigneeId: "executor", status: "completed", participants: [{ userId: "co", role: "co_assignee" }] });
  const tasksMode = new URLSearchParams(location.search).get("domain") === "tasks";
  return <FluentProvider theme={theme} className="app-provider" style={{ height: "100dvh", overflow: "hidden", background: "var(--ws-canvas)" }}>
    {tasksMode ? <TasksView {...chairmanScenarioProps(task)} focusTaskId={undefined} token="synthetic-qa-only"
      people={people} departments={departments} currentUserId="author" canViewIncomingLetters /> : <IncomingLettersView token="synthetic-qa-only" people={people} departments={departments} currentUserId="author" canEdit
      onOpenTask={async id => { document.documentElement.dataset.openedTask = id; }} />}
  </FluentProvider>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
