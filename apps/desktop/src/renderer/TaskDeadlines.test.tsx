import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { WorkspaceTask } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskRecords } from "./TaskRecords";
import { TasksView } from "./TasksView";
import { workspaceTheme } from "./workspace-theme";
import { initialTasks, people } from "./test-fixtures/demo-data";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const wrap = (node: React.ReactNode) => <FluentProvider theme={workspaceTheme}>{node}</FluentProvider>;
const task = (id: string, days: number, overrides: Partial<WorkspaceTask> = {}): WorkspaceTask => ({
  ...initialTasks[0]!, id, title: id, status: "new", priority: "normal",
  dueAt: new Date(2026, 9, 12 + days, 18, 30).toISOString(), ...overrides,
});
const row = (id: string) => screen.getByRole("button", { name: `Открыть задачу: ${id}` }).closest("tr")!;
const props = (tasks: WorkspaceTask[]): ComponentProps<typeof TasksView> => ({
  tasks, attachments: [], people, currentUserId: people[0]!.id, efficiencyLoading: false,
  onLoadEfficiency: vi.fn(), onCreateTask: vi.fn(), onCreateSubtask: vi.fn(),
  onChangeStatus: vi.fn(), onUpdateTask: vi.fn(), onDeleteTask: vi.fn(),
  onSetParticipant: vi.fn(), onRemoveParticipant: vi.fn(), onAddChecklistItem: vi.fn(),
  onToggleChecklistItem: vi.fn(), onDeleteChecklistItem: vi.fn(), onAddComment: vi.fn(),
  onSetDependency: vi.fn(), onRemoveDependency: vi.fn(), onSetCycle: vi.fn(),
  renderTaskChat: vi.fn(), onReturnForRevision: vi.fn(), onSubmitResult: vi.fn(),
  onAcceptResult: vi.fn(), onSetEfficiencyExclusion: vi.fn(), onExtendDeadline: vi.fn(),
  onUploadAttachments: vi.fn(), onDeleteAttachment: vi.fn(), onDownloadAttachment: vi.fn(),
});
function freeze(date = new Date(2026, 9, 12, 12)) {
  vi.useFakeTimers(); vi.setSystemTime(date);
}

describe("Task list deadline colours and overdue filter", () => {
  it("colours deadlines, not priority, and preserves priority text", () => {
    freeze();
    const tasks = [task("two", 2), task("tomorrow", 1), task("today", 0),
      task("late", -1), task("urgent-far", 7, { priority: "urgent" }),
      task("high-unscheduled", 0, { priority: "high", dueAt: null }),
      task("done", -1, { status: "completed" }), task("cancelled", -1, { status: "cancelled" })];
    render(wrap(<TaskRecords tasks={tasks} people={people} filterKey="all" onSelect={vi.fn()} />));
    expect(row("two")).toHaveAttribute("data-deadline", "warning");
    for (const id of ["tomorrow", "today", "late"]) expect(row(id)).toHaveAttribute("data-deadline", "danger");
    for (const id of ["urgent-far", "high-unscheduled", "done", "cancelled"]) expect(row(id)).not.toHaveAttribute("data-deadline");
    expect(within(row("urgent-far")).getByText("Срочный приоритет")).toBeInTheDocument();
    expect(document.querySelector(".task-record-signal")).toBeNull();
    expect(within(row("late")).getByText("Срок истёк")).toBeInTheDocument();
  });
  it("switches yellow to red at midnight without a data refresh", () => {
    freeze(new Date(2026, 9, 12, 23, 59, 59));
    render(wrap(<TaskRecords tasks={[task("two", 2)]} people={people} filterKey="all" onSelect={vi.fn()} />));
    expect(row("two")).toHaveAttribute("data-deadline", "warning");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(row("two")).toHaveAttribute("data-deadline", "danger");
  });
  it("includes expired new/in-progress/review tasks and updates at the exact deadline", () => {
    freeze(new Date(2026, 9, 12, 18, 29, 59));
    const tasks = [task("late-new", -1), task("late-progress", -1, { status: "in_progress" }),
      task("late-review", -1, { status: "awaiting_review" }), task("explicit", 0, { status: "overdue", dueAt: null }),
      task("closing", 0), task("future", 1), task("done", -1, { status: "completed" }),
      task("cancelled", -1, { status: "cancelled" }), task("invalid", 0, { dueAt: "invalid" })];
    render(wrap(<TasksView {...props(tasks)} />));
    const tab = screen.getByRole("button", { name: "Просроченные" });
    expect(tab).toHaveTextContent("4");
    fireEvent.click(tab);
    for (const id of ["late-new", "late-progress", "late-review", "explicit"]) expect(row(id)).toBeInTheDocument();
    for (const id of ["closing", "future", "done", "cancelled", "invalid"]) expect(screen.queryByRole("button", { name: `Открыть задачу: ${id}` })).toBeNull();
    act(() => { vi.advanceTimersByTime(1002); });
    expect(tab).toHaveTextContent("5");
    expect(row("closing")).toBeInTheDocument();
  });
  it("re-evaluates dates after waking and removes a task when its deadline is extended", () => {
    freeze();
    const tasks = [task("waking", 2)];
    const view = render(wrap(<TaskRecords tasks={tasks} people={people} filterKey="all" onSelect={vi.fn()} />));
    vi.setSystemTime(new Date(2026, 9, 14, 19));
    fireEvent.focus(window);
    expect(within(row("waking")).getByText("Срок истёк")).toBeInTheDocument();
    view.rerender(wrap(<TaskRecords tasks={[task("waking", 7)]} people={people} filterKey="all" onSelect={vi.fn()} />));
    expect(row("waking")).not.toHaveAttribute("data-deadline");
    expect(screen.queryByText("Срок истёк")).toBeNull();
  });
});
