import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovalRequestSummary, EfficiencyOverview, WorkspacePerson, WorkspaceTask } from "@yuksalish/contracts";

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

  it("removes the redundant horizontal employee strip while keeping the workload selector", () => {
    renderDashboard();
    expect(screen.queryByRole("group", { name: "Фокус на сотруднике" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Сотрудники в обзоре команды" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Азиза Каримова.*1 активная задача/i })).toBeInTheDocument();
  });

  it("shows pending deadline decisions and sends the approval through the existing action", async () => {
    const onDecideDeadline = vi.fn().mockResolvedValue(task({ id: "deadline", title: "Отчёт", assigneeId: "employee", status: "in_progress" }));
    const pending = task({ id: "deadline", title: "Отчёт", assigneeId: "employee", status: "in_progress", dueAt: "2026-09-10T09:00:00Z", deadlineRequests: [{
      id: "request", messageId: "message", requesterUserId: "employee", oldDueAt: "2026-09-10T09:00:00Z", proposedDueAt: "2026-09-12T09:00:00Z", reason: "Нужны данные", status: "pending", createdAt: "2026-09-09T09:00:00Z",
    }] });
    render(<FluentProvider theme={workspaceTheme}><TeamDashboardView token="test-token" tasks={[pending]} people={people} currentUserId="manager" efficiencyLoading={false} onSelectTask={vi.fn()} onDecideDeadline={onDecideDeadline} /></FluentProvider>);
    fireEvent.click(screen.getByText("Перенос срока").closest("button")!);
    const decisions = screen.getByRole("region", { name: "Запросы на перенос срока" });
    fireEvent.click(within(decisions).getByRole("button", { name: /Отчёт/ }));
    expect(within(decisions).getByText("Нужны данные")).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(decisions).getByRole("button", { name: "Согласовать перенос срока" })); });
    expect(onDecideDeadline).toHaveBeenCalledWith(pending, "request", true);
  });

  it("shows pending invitations and responds as the invited user", async () => {
    const event = { id: "invite", organizerUserId: "employee", title: "Рабочая встреча", description: "Повестка", eventType: "meeting" as const, startsAt: "2026-09-10T09:00:00Z", endsAt: "2026-09-10T10:00:00Z", allDay: false, location: "Зал 1", status: "scheduled" as const, attendeeIds: ["manager"], attendees: [{ userId: "manager", status: "pending" as const }], currentUserAttendanceStatus: "pending" as const, canRespond: true, canEdit: false, createdAt: "2026-09-09T09:00:00Z", updatedAt: "2026-09-09T09:00:00Z", historyComplete: true };
    const onCalendarResponse = vi.fn().mockResolvedValue({ ...event, currentUserAttendanceStatus: "accepted" });
    render(<FluentProvider theme={workspaceTheme}><TeamDashboardView token="test-token" tasks={[]} people={people} currentUserId="manager" efficiencyLoading={false} onSelectTask={vi.fn()} calendarEvents={[event]} onCalendarResponse={onCalendarResponse} /></FluentProvider>);
    fireEvent.click(screen.getByText("Приглашения").closest("button")!);
    const invitations = screen.getByRole("region", { name: "Приглашения на мероприятия и встречи" });
    expect(within(invitations).getByText("Повестка")).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(invitations).getByRole("button", { name: "Подтвердить участие" })); });
    expect(onCalendarResponse).toHaveBeenCalledWith(event, "accepted");
  });
  it("shows an operational summary without turning workload into a rating", () => {
    renderDashboard();

    expect(screen.getByRole("heading", { name: "Добрый день, Азиза" })).toBeInTheDocument();
    expect(screen.queryByText("Активные задачи")).not.toBeInTheDocument();
    expect(screen.queryByText("Срок сегодня")).not.toBeInTheDocument();
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

  it("keeps each metric label and note in one copy block, separate from its counter", () => {
    renderDashboard();
    for (const label of ["Нужна помощь", "Ждут решения", "Перенос срока", "Приглашения"]) {
      const card = screen.getByText(label).closest("button")!;
      const copy = card.querySelector(".team-dash-metric-copy");
      expect(copy).toHaveTextContent(label);
      expect(copy?.querySelector("small")).toBeInTheDocument();
      expect(copy?.querySelector("strong")).toBeNull();
      expect(card.querySelector(":scope > strong")).toBeInTheDocument();
      expect(card.querySelector(".team-dash-metric-icon")).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("filters the attention queue by employee and exposes an explicit reset", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: /Азиза Каримова.*1 активная задача/i }));

    const attention = screen.getByRole("region", { name: "Требует внимания" });
    expect(within(attention).getByText("Проверить бюджет")).toBeInTheDocument();
    expect(within(attention).queryByText("Подготовить договор")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать все задачи" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Показать все задачи" }));
    expect(within(attention).getByText("Подготовить договор")).toBeInTheDocument();
    expect(within(attention).getByText("Проверить бюджет")).toBeInTheDocument();
  });

  it("places the presence overview immediately before workload, after the action blocks", () => {
    renderDashboard();
    const presence = screen.getByText("Отметки рабочего дня");
    const attention = screen.getByRole("region", { name: "Требует внимания" });
    const workload = screen.getByRole("region", { name: "Текущая нагрузка" });
    expect(attention.compareDocumentPosition(presence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(presence.compareDocumentPosition(workload) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("counts only payment approvals actionable by this user and opens their card", () => {
    const details = { projectName: "Проект", projectCode: "P", sourceAccount: "", destinationAccount: "", requestPriority: "normal" as const, comment: "", tripPurpose: "", employeeIds: [], paymentReason: "" };
    const pending: ApprovalRequestSummary = {
      id: "pay-1", number: "12", title: "Оплата услуг", amount: 100, currency: "UZS", status: "running", statusLabel: "В работе",
      activeNodeKeys: ["approval"], activeStages: [{ key: "approval", label: "Согласование", kind: "approval", canAct: true }], stageLabel: "Согласование",
      requesterId: "employee", responsibleUserId: "manager", purpose: "Услуги", details, createdAt: "2026-09-09T09:00:00Z", updatedAt: "2026-09-09T09:00:00Z", revision: 1, versions: [], actions: [],
    };
    const onSelectPaymentRequest = vi.fn();
    render(<FluentProvider theme={workspaceTheme}><TeamDashboardView token="test-token" tasks={[]} people={people} currentUserId="manager" efficiencyLoading={false} onSelectTask={vi.fn()} paymentRequests={[pending, { ...pending, id: "pay-2", activeStages: [{ ...pending.activeStages[0]!, canAct: false }] }, { ...pending, id: "pay-3", status: "approved" }]} onSelectPaymentRequest={onSelectPaymentRequest} /></FluentProvider>);
    const card = screen.getByText("Заявки на оплату").closest("button")!;
    expect(card).toHaveTextContent("ждут вашего решения");
    expect(within(card).getByText("1")).toBeInTheDocument();
    fireEvent.click(card);
    const list = screen.getByRole("region", { name: "Заявки на оплату, ожидающие решения" });
    fireEvent.click(within(list).getByRole("button", { name: /Оплата услуг/ }));
    expect(onSelectPaymentRequest).toHaveBeenCalledWith("pay-1");
  });

  it("opens flow groups in one drawer and resets task detail when another group is selected", () => {
    renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: /Срок истёк.*1/i }));
    let drawer = screen.getByRole("dialog", { name: "Срок истёк" });
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

  it("keeps seven dates, separate caption rows and full accessible day names", () => {
    renderDashboard();
    const flow = screen.getByRole("complementary", { name: "Работа команды" });
    const days = flow.querySelectorAll(".team-dash-week-bars > button");
    expect(days).toHaveLength(7);
    expect([...days].map(day => day.querySelector("small > span:last-child")?.textContent)).toEqual(["9", "10", "11", "12", "13", "14", "15"]);
    expect(days[0]).toHaveAccessibleName("Задачи со сроком сегодня: 1");
    expect(days[1]).toHaveAccessibleName("Задачи со сроком четверг, 10 сентября: 1");
    expect(days[0]?.querySelector(".team-dash-week-today-full")).toHaveTextContent("сегодня");
    expect(days[0]?.querySelector(".team-dash-week-today-short")).toHaveTextContent("сег.");
    for (const day of days) {
      expect(day.querySelector("small")).toHaveAttribute("aria-hidden", "true");
      expect(day.querySelector("small")?.children).toHaveLength(2);
      expect(day.querySelector(":scope > span")).toHaveAttribute("aria-hidden", "true");
      expect(day.querySelector(":scope > strong")).toBeInTheDocument();
      expect(day.getAttribute("title")).toMatch(/сентября/);
    }
  });

  it("keeps all four flow tiles labelled and selectable, including empty statuses", () => {
    renderDashboard();
    const statuses = screen.getByRole("group", { name: "Задачи по статусам" });
    expect(within(statuses).getAllByRole("button")).toHaveLength(4);
    expect(document.querySelector(".team-dash-flow-bar")).toBeNull();
    for (const [label, count] of [["Новые", 1], ["В работе", 0], ["На проверке", 1], ["Срок истёк", 1]] as const) {
      const tile = within(statuses).getByRole("button", { name: `${label} ${count}` });
      fireEvent.click(tile);
      expect(tile).toHaveAttribute("aria-pressed", "true");
      expect(within(statuses).getAllByRole("button", { pressed: true })).toEqual([tile]);
      const drawer = screen.getByRole("dialog", { name: label });
      if (count === 0) expect(within(drawer).getByText("В этой категории задач нет")).toBeInTheDocument();
    }
  });
  it("does not count a historical overdue status after its deadline was rescheduled", () => {
    const tasks = [task({ id: "rescheduled", title: "Перенесённая задача", assigneeId: "employee", status: "overdue", dueAt: "2026-09-20T09:00:00Z" })];
    render(<FluentProvider theme={workspaceTheme}><TeamDashboardView token="test-token" tasks={tasks} people={people} currentUserId="manager" efficiency={efficiency} efficiencyLoading={false} onSelectTask={vi.fn()} /></FluentProvider>);
    const statuses = screen.getByRole("group", { name: "Задачи по статусам" });
    expect(within(statuses).getByRole("button", { name: "В работе 1" })).toBeInTheDocument();
    fireEvent.click(within(statuses).getByRole("button", { name: "Срок истёк 0" }));
    expect(within(screen.getByRole("dialog", { name: "Срок истёк" })).queryByText("Перенесённая задача")).toBeNull();
    fireEvent.click(within(statuses).getByRole("button", { name: "В работе 1" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "В работе" })).getByRole("button", { name: /Перенесённая задача/ }));
    const detail = screen.getByRole("dialog", { name: "Перенесённая задача" });
    expect(within(detail).getByText("В работе")).toBeInTheDocument();
    expect(within(detail).queryByText("Просрочена")).not.toBeInTheDocument();
  });

  it("keeps expired excluded/review tasks visible without presenting their deadline count as an efficiency violation", () => {
    const tasks = [
      task({ id: "excluded", title: "Внешняя зависимость", assigneeId: "employee", status: "in_progress", dueAt: "2026-09-07T09:00:00Z", efficiencyExcluded: true }),
      task({ id: "submitted", title: "Результат на проверке", assigneeId: "employee", status: "awaiting_review", dueAt: "2026-09-07T09:00:00Z" }),
      task({ id: "future-excluded", title: "Будущее исключение", assigneeId: "employee", status: "in_progress", dueAt: "2026-10-07T09:00:00Z", efficiencyExcluded: true }),
    ];
    const overview = { ...efficiency, employees: efficiency.employees.map(row => row.userId === "employee"
      ? { ...row, percentage: 100, onTimeCount: 1, eligibleCount: 1, overdueCount: 0, excludedCount: 1 } : row) };
    const onSelect = vi.fn();
    render(<FluentProvider theme={workspaceTheme}><TeamDashboardView token="test-token" tasks={tasks} people={people} currentUserId="manager" efficiency={overview} efficiencyLoading={false} onSelectTask={onSelect} /></FluentProvider>);
    const row = screen.getByRole("button", { name: /Дилшод Рахимов.*3 активные задачи/ });
    expect(within(row).getByText("Истёк срок: 2")).toBeInTheDocument();
    expect(within(row).getByText("Истёк срок: 2")).not.toHaveClass("is-danger");
    expect(within(row).getByText("Счётчик сроков, не нарушений исполнителя")).toBeInTheDocument();
    expect(within(row).getByText("Из них не снижают процент: 1 · исключены")).toBeInTheDocument();
    expect(within(row).getByText("100%")).toBeInTheDocument();
    expect(screen.queryByText(/2 проср\./)).toBeNull();
    expect(screen.getByText("Исключена из эффективности — процент не снижает. Причина — в маршруте задачи")).toBeInTheDocument();
    expect(screen.getByText("Ожидает решения постановщика. Вовремя сданный результат не снижает процент; время сдачи — в маршруте задачи")).toBeInTheDocument();
    const explanation = screen.getByText("Почему истёкший срок не всегда снижает эффективность?");
    fireEvent.click(explanation);
    expect(explanation.closest("details")).toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Срок истёк 2" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Срок истёк" })).getByRole("button", { name: /Внешняя зависимость/ }));
    const detail = screen.getByRole("dialog", { name: "Внешняя зависимость" });
    expect(within(detail).getByText("Исключена из эффективности — процент не снижает. Причина — в маршруте задачи")).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: "Открыть полную карточку" }));
    expect(onSelect).toHaveBeenCalledWith("excluded");
  });

  it("does not infer an exemption from a monthly score or an awaiting-review status", () => {
    renderDashboard();
    expect(screen.getByText("Истёкший срок сам по себе не доказывает нарушение исполнителя. Проверьте месяц расчёта и маршрут задачи")).toBeInTheDocument();
    expect(screen.queryByText(/Из них не снижают процент/)).toBeNull();
    expect(screen.queryByText(/^Результат сдан вовремя$/)).toBeNull();
  });
});
