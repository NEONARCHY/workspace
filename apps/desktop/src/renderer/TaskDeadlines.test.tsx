import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { WorkspaceTask } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskRecords } from "./TaskRecords";
import { TasksView } from "./TasksView";
import { workspaceTheme } from "./workspace-theme";
import { initialTasks, people } from "./test-fixtures/demo-data";
import { taskDeadlineLabel } from "./task-deadline";

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
  onUploadAttachments: vi.fn(), onDownloadAttachment: vi.fn(),
});
function freeze(date = new Date(2026, 9, 12, 12)) {
  vi.useFakeTimers(); vi.setSystemTime(date);
}

describe("My tasks participation filter", () => {
  const userId = people[0]!.id;
  const otherId = people[1]!.id;
  const tasks = [
    task("author", 1, { authorId: userId, assigneeId: otherId, participants: [] }),
    task("assignee", 1, { authorId: otherId, assigneeId: userId, participants: [] }),
    task("co-assignee", 1, { authorId: otherId, assigneeId: otherId, participants: [{ userId, role: "co_assignee" }] }),
    task("observer", 1, { authorId: otherId, assigneeId: otherId, participants: [{ userId, role: "observer" }] }),
    task("multiple-roles", 1, { authorId: userId, assigneeId: userId, participants: [{ userId, role: "observer" }] }),
    task("unrelated", 1, { authorId: otherId, assigneeId: otherId, participants: [{ userId: otherId, role: "observer" }] }),
  ];

  it("includes all four roles, excludes unrelated tasks and counts each task once", () => {
    render(wrap(<TasksView {...props(tasks)} />));
    const mine = screen.getByRole("button", { name: "Мои" });
    expect(mine).toHaveTextContent("5");
    expect(document.querySelector(".task-focus-object.mine")).toHaveTextContent("5задач с вашим участием");
    fireEvent.click(mine);
    for (const id of ["author", "assignee", "co-assignee", "observer", "multiple-roles"]) expect(row(id)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Открыть задачу: unrelated" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск задач" }), { target: { value: "co-assignee" } });
    expect(row("co-assignee")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Открыть задачу: author" })).toBeNull();
  });

  it.each([
    ["author", ["author", "multiple-roles"]],
    ["assignee", ["assignee", "multiple-roles"]],
    ["co_assignee", ["co-assignee"]],
    ["observer", ["observer", "multiple-roles"]],
  ])("combines My tasks with the %s role filter", (role, expected) => {
    render(wrap(<TasksView {...props(tasks)} />));
    fireEvent.click(screen.getByRole("button", { name: "Мои" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Моя роль в задаче" }), { target: { value: role } });
    for (const item of tasks) {
      const button = screen.queryByRole("button", { name: `Открыть задачу: ${item.id}` });
      if (expected.includes(item.id)) expect(button).toBeInTheDocument();
      else expect(button).toBeNull();
    }
  });
});

describe("Deadline request decisions and task content hierarchy", () => {
  const withRequest = (id: string, overrides: Partial<WorkspaceTask> = {}): WorkspaceTask => {
    const value = task(id, 90, { authorId: people[0]!.id, ...overrides });
    return { ...value, deadlineRequests: [{
      id: `request-${id}`, messageId: `message-${id}`, requesterUserId: people[1]!.id,
      oldDueAt: value.dueAt!, proposedDueAt: new Date(Date.parse(value.dueAt!) + 86_400_000).toISOString(),
      reason: "Ждём подтверждающий документ", status: "pending", createdAt: new Date().toISOString(),
    }] };
  };

  it("filters only my live pending decisions and marks requests in the list", () => {
    const mine = withRequest("my-extension");
    const foreign = withRequest("another-author", { authorId: people[1]!.id });
    const completed = withRequest("completed-extension", { status: "completed" });
    const stale = { ...withRequest("stale-extension"), dueAt: new Date(2030, 1, 1).toISOString() };
    const resolved = withRequest("resolved-extension");
    const tasks = [mine, foreign, completed, stale, { ...resolved, deadlineRequests:
      resolved.deadlineRequests!.map((item) => ({ ...item, status: "rejected" as const })) }];
    render(wrap(<TasksView {...props(tasks)} />));
    expect(row("my-extension")).toHaveTextContent("Перенос срока · ждёт вашего решения");
    expect(row("another-author")).toHaveTextContent("Запрошен перенос срока");
    const filter = screen.getByRole("button", { name: "Перенос срока" });
    expect(filter).toHaveTextContent("1");
    fireEvent.click(filter);
    expect(row("my-extension")).toBeInTheDocument();
    for (const id of ["another-author", "completed-extension", "stale-extension", "resolved-extension"]) {
      expect(screen.queryByRole("button", { name: `Открыть задачу: ${id}` })).toBeNull();
    }
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск задач" }), { target: { value: "unknown" } });
    expect(screen.queryByRole("button", { name: "Открыть задачу: my-extension" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск задач" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(document.querySelectorAll(".kanban-card")).toHaveLength(1);
    expect(screen.getByText("Перенос срока · ждёт вашего решения")).toBeVisible();
  });

  it("opens a notification-focused task directly at the deadline decision", async () => {
    const original = withRequest("notification-task");
    const onDecideDeadline = vi.fn().mockResolvedValue(original);
    render(wrap(<TasksView {...props([original])} focusTaskId={original.id} onDecideDeadline={onDecideDeadline} />));
    const panel = screen.getByRole("region", { name: "Запрос на перенос срока" });
    expect(within(panel).getByText("Ждём подтверждающий документ")).toBeVisible();
    expect(within(panel).getByText(people[1]!.name)).toBeVisible();
    fireEvent.click(within(panel).getByRole("button", { name: "Согласовать перенос срока" }));
    await waitFor(() => expect(onDecideDeadline).toHaveBeenCalledWith(original, "request-notification-task", true));
  });

  it("puts delivered work and files before settings and keeps secondary controls collapsed", () => {
    const original = task("work-first", 90, { authorId: people[0]!.id, resultText: "Готовый отчёт" });
    render(wrap(<TasksView {...props([original])} focusTaskId={original.id} />));
    const review = document.querySelector(".task-review-section")!;
    const attachments = document.querySelector(".task-detail .attachment-panel-dropzone")!;
    const settings = document.querySelector(".task-secondary-settings")!;
    expect(review.compareDocumentPosition(attachments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(attachments.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Готовый отчёт")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Добавить цикл" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "Команда и настройки задачи" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Добавить цикл" })).toBeVisible();
    fireEvent.click(toggle);
    expect(screen.queryByRole("button", { name: "Добавить цикл" })).toBeNull();
  });
});

describe("Task list deadline colours and overdue filter", () => {
  it("enlarges card avatars without losing employee profile access or participant removal", () => {
    const original = task("larger-avatars", 90, { authorId: people[0]!.id, assigneeId: people[0]!.id,
      participants: [{ userId: people[1]!.id, role: "co_assignee" }] });
    const p = props([original]);
    render(wrap(<TasksView {...p} focusTaskId={original.id} />));
    const avatars = document.querySelectorAll(".task-person-avatar > .fui-Avatar");
    expect(avatars).toHaveLength(4);
    const headerPeople = document.querySelectorAll(".task-detail-sticky-header .detail-meta > .employee-profile-link");
    expect(headerPeople).toHaveLength(2);
    expect(headerPeople[0]).toHaveTextContent("Постановщик");
    expect(headerPeople[1]).toHaveTextContent("Ответственный");
    expect(document.querySelector(".task-detail-co-assignee-list")).toHaveTextContent(people[1]!.name);
    expect(document.querySelectorAll(".participant-chip .task-person-avatar")).toHaveLength(2);
    expect(avatars[2]!.closest(".employee-profile-link")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Команда и настройки задачи" }));
    fireEvent.click(screen.getByRole("button", { name: `Убрать участника ${people[1]!.name}` }));
    expect(p.onRemoveParticipant).toHaveBeenCalledWith(original, people[1]!.id);
  });

  it("places deadline extension beside the date and preserves explicit save/cancel", async () => {
    const original = task("extend-from-date", 90, { authorId: people[0]!.id, status: "awaiting_review" });
    const p = { ...props([original]), onExtendDeadline: vi.fn().mockResolvedValue({ ...original }) };
    render(wrap(<TasksView {...p} focusTaskId={original.id} />));
    const button = screen.getByRole("button", { name: "Продлить срок" });
    expect(button.closest(".task-deadline-meta")).toHaveTextContent(taskDeadlineLabel(original));
    expect(screen.queryByRole("region", { name: "Продление срока" })).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Продление срока" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("region", { name: "Продление срока" })).getByRole("button", { name: "Отмена" }));
    expect(p.onExtendDeadline).not.toHaveBeenCalled();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить срок" }));
    expect(p.onExtendDeadline).toHaveBeenCalledWith(original, expect.any(String));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Продление срока" })).toBeNull());
  });

  it("removes a formerly overdue task after rescheduling and places it in the working Kanban lane", () => {
    freeze();
    const original = task("rescheduled", -1, { status: "overdue" });
    const p = props([original]);
    const view = render(wrap(<TasksView {...p} />));
    const overdue = screen.getByRole("button", { name: "Просроченные" });
    fireEvent.click(overdue);
    expect(row(original.id)).toBeInTheDocument();
    view.rerender(wrap(<TasksView {...p} tasks={[task(original.id, 7, { status: "overdue" })]} />));
    expect(overdue).toHaveTextContent("0");
    expect(screen.queryByRole("button", { name: `Открыть задачу: ${original.id}` })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Активные" }));
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(screen.getByText(original.id).closest(".kanban-column")).toHaveAttribute("data-task-status", "in_progress");
  });
  it("updates the open card from the approved exact deadline, ignoring a stale server label", () => {
    const original = task("extension", 1, { dueAt: new Date(2026, 9, 13, 13).toISOString(), dueLabel: "13.10.2026, 13:00" });
    const p = {...props([original]), focusTaskId: original.id};
    const view = render(wrap(<TasksView {...p} />));
    const approved = {...original, dueAt: new Date(2026, 9, 13, 18).toISOString()};
    view.rerender(wrap(<TasksView {...p} tasks={[approved]} />));
    expect(document.querySelector(".task-detail .detail-meta")).toHaveTextContent(taskDeadlineLabel(approved));
    expect(document.querySelector(".task-detail .detail-meta")).not.toHaveTextContent(original.dueLabel);
  });
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
