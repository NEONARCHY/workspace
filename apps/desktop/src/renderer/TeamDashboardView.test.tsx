import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EfficiencyOverview, WorkspacePerson, WorkspaceTask } from "@yuksalish/contracts";

import { TeamDashboardView } from "./TeamDashboardView";
import { workspaceTheme } from "./workspace-theme";

vi.mock("./TeamPresencePanel", () => ({ TeamPresencePanel: () => <div>Отметки рабочего дня</div> }));

const people: readonly WorkspacePerson[] = [
  { id: "manager", name: "Азиза Каримова", initials: "АК", role: "manager", jobTitle: "Руководитель отдела", color: "#0f6cbd" },
  { id: "employee", name: "Дилшод Рахимов", initials: "ДР", role: "employee", jobTitle: "Специалист", color: "#107c10" },
  { id: "calm", name: "Малика Нурова", initials: "МН", role: "employee", jobTitle: "Координатор", color: "#8764b8" },
];

function task(overrides: Partial<WorkspaceTask> & Pick<WorkspaceTask, "id" | "title" | "assigneeId" | "status">): WorkspaceTask {
  return {
    project: "Рабочий проект",
    authorId: "manager",
    dueLabel: "Срок",
    priority: "normal",
    checklistDone: 0,
    checklistTotal: 0,
    participants: [],
    checklist: [],
    comments: [],
    dependencies: [],
    ...overrides,
  };
}

const efficiency: EfficiencyOverview = {
  period: "2026-09",
  timezone: "Asia/Tashkent",
  methodologyVersion: "EFF-1.0",
  trackingStartedAt: "2026-09-01T00:00:00Z",
  currentUserId: "manager",
  employees: people.map((person, index) => ({
    userId: person.id,
    name: person.name,
    jobTitle: person.jobTitle ?? "",
    period: "2026-09",
    timezone: "Asia/Tashkent",
    percentage: index === 2 ? null : 80 - index * 10,
    onTimeCount: 4,
    eligibleCount: 5,
    overdueCount: index,
    awaitingReviewCount: 0,
    noDueDateCount: 0,
    returnedForRevisionCount: 0,
    excludedCount: 0,
    sampleSize: 5,
    methodologyVersion: "EFF-1.0",
    trackingStartedAt: "2026-09-01T00:00:00Z",
    historyCompleteness: "complete" as const,
    smallSample: false,
    history: [],
  })),
};

describe("TeamDashboardView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T09:00:00Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function renderDashboard(onSelectTask = vi.fn()) {
    const tasks = [
      task({ id: "overdue", title: "Подготовить договор", assigneeId: "employee", status: "in_progress", priority: "urgent", dueAt: "2026-09-07T09:00:00Z" }),
      task({ id: "review", title: "Проверить бюджет", assigneeId: "manager", status: "awaiting_review", dueAt: "2026-09-10T09:00:00Z" }),
      task({ id: "today", title: "Согласовать график", assigneeId: "employee", status: "new", dueAt: "2026-09-09T13:00:00Z" }),
      task({ id: "complete", title: "Закрытая задача", assigneeId: "calm", status: "completed", dueAt: "2026-09-08T09:00:00Z" }),
    ];
    render(<FluentProvider theme={workspaceTheme}><TeamDashboardView token="test-token" tasks={tasks} people={people} currentUserId="manager" efficiency={efficiency} efficiencyLoading={false} onSelectTask={onSelectTask} /></FluentProvider>);
    return onSelectTask;
  }

  it("shows an operational summary without turning workload into a rating", () => {
    renderDashboard();

    expect(screen.getByRole("heading", { name: "Добрый день, Азиза" })).toBeInTheDocument();
    expect(within(screen.getByText("Активные задачи").closest("button")!).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByText("Нужна помощь").closest("button")!).getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/не норму и не оценку сотрудника/i)).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("orders urgent risks first and opens the selected task", () => {
    const onSelectTask = renderDashboard();
    const attention = screen.getByRole("region", { name: "Требует внимания" });
    const taskButtons = within(attention).getAllByRole("button");

    expect(taskButtons[0]).toHaveTextContent("Подготовить договор");
    fireEvent.click(taskButtons[0]!);
    expect(onSelectTask).toHaveBeenCalledWith("overdue");
  });

  it("filters the attention queue by employee and exposes an explicit reset", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: /Азиза Каримова.*1 активная задача/i }));

    const attention = screen.getByRole("region", { name: "Требует внимания" });
    expect(within(attention).getByText("Проверить бюджет")).toBeInTheDocument();
    expect(within(attention).queryByText("Подготовить договор")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать всю команду" })).toBeInTheDocument();
  });

  it("keeps EFF-1 optional when its API is unavailable", () => {
    const tasks = [task({ id: "one", title: "Обычная задача", assigneeId: "employee", status: "in_progress" })];
    render(<FluentProvider theme={workspaceTheme}><TeamDashboardView token="test-token" tasks={tasks} people={people} currentUserId="manager" efficiencyLoading={false} efficiencyError="Сервис недоступен" onSelectTask={vi.fn()} /></FluentProvider>);

    expect(screen.getByText(/Показана нагрузка по задачам/)).toHaveTextContent("Сервис недоступен");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
  it("filters operational attention using the metric objects and resets the filter", () => {
    renderDashboard();
    const attention = screen.getByRole("region", { name: "Требует внимания" });
    fireEvent.click(screen.getByText("Нужна помощь").closest("button")!);
    expect(within(attention).getByText("Подготовить договор")).toBeInTheDocument();
    expect(within(attention).queryByText("Проверить бюджет")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Ждут решения").closest("button")!);
    expect(within(attention).getByText("Проверить бюджет")).toBeInTheDocument();
    expect(within(attention).queryByText("Подготовить договор")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Активные задачи").closest("button")!);
    expect(within(attention).getByText("Подготовить договор")).toBeInTheDocument();
    expect(within(attention).getByText("Проверить бюджет")).toBeInTheDocument();
  });

  it("opens flow groups in one drawer and resets task detail when another group is selected", () => {
    renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: /Просрочены.*1/i }));
    let drawer = screen.getByRole("dialog", { name: "Просрочены" });
    expect(within(drawer).getByText("Подготовить договор")).toBeInTheDocument();
    expect(within(drawer).queryByText("Проверить бюджет")).not.toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: /Подготовить договор/i }));
    drawer = screen.getByRole("dialog", { name: "Подготовить договор" });
    expect(within(drawer).getByRole("button", { name: "Вернуться к списку задач" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Задачи со сроком четверг, 10 сентября: 1/i }));
    drawer = screen.getByRole("dialog", { name: "четверг, 10 сентября" });
    expect(within(drawer).getByText("Проверить бюджет")).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Вернуться к списку задач" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Задачи со сроком пятница, 11 сентября: 0/i }));
    drawer = screen.getByRole("dialog", { name: "пятница, 11 сентября" });
    expect(within(drawer).getByText("В этот день задач нет")).toBeInTheDocument();
    expect(drawer).not.toHaveTextContent(/drawer/i);
  });
});
