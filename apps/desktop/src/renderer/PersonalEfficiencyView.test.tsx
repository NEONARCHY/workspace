import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { PersonalEfficiency, PersonalEfficiencyTask } from "@yuksalish/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { PersonalEfficiencyView, personalPeriods, taskImpact, currentTaskLabel } from "./PersonalEfficiencyView";
import { loadPersonalEfficiency } from "./workspace-api";
import { workspaceTheme } from "./workspace-theme";
import { HistoryChart } from "./EfficiencyView";

vi.mock("./workspace-api", () => ({ loadPersonalEfficiency: vi.fn() }));

const task: PersonalEfficiencyTask = { id: "task-1", title: "Подготовить отчёт", status: "awaiting_review", dueAt: "2026-10-05T09:00:00Z", updatedAt: "2026-10-04T09:00:00Z", onTimeCount: 1, overdueCount: 0, excludedCount: 0, returnedForRevisionCount: 0 };
const summary: PersonalEfficiency = {
  employee: { userId: "self", name: "Сотрудник", jobTitle: "Специалист", period: "2026-10", timezone: "Asia/Tashkent", percentage: 75, onTimeCount: 3, eligibleCount: 4, overdueCount: 1, awaitingReviewCount: 1, noDueDateCount: 1, returnedForRevisionCount: 1, excludedCount: 1, sampleSize: 4, methodologyVersion: "EFF-2.0", trackingStartedAt: "2026-09-01T00:00:00Z", historyCompleteness: "complete", smallSample: true, history: [] },
  taskDetailsVisible: true, workload: { new: 1, inProgress: 2, awaitingReview: 1, completed: 3 }, recentTasks: [task], impactTasks: [task], impactTaskCount: 1,
};

afterEach(() => { cleanup(); vi.resetAllMocks(); });
function show(onBack = vi.fn(), onOpenTask = vi.fn()) {
  return render(<FluentProvider theme={workspaceTheme}><PersonalEfficiencyView token="self-token" onBack={onBack} onOpenTask={onOpenTask} /></FluentProvider>);
}

it("uses Tashkent month boundaries, not the computer's local timezone", () => {
  expect(personalPeriods(new Date("2026-09-30T19:00:00Z"))[0]).toBe("2026-10");
  expect(personalPeriods(new Date("2026-09-30T18:59:59Z"))[0]).toBe("2026-09");
  expect(personalPeriods(new Date("2026-01-01T00:00:00Z"))[1]).toBe("2025-12");
  expect(personalPeriods()).toHaveLength(12);
});

it("leaves a gap in the chart when a month has no data", () => {
  const history = [
    { period: "2026-08", percentage: 70, onTimeCount: 7, eligibleCount: 10, historyCompleteness: "complete" as const },
    { period: "2026-09", percentage: null, onTimeCount: 0, eligibleCount: 0, historyCompleteness: "unavailable" as const },
    { period: "2026-10", percentage: 80, onTimeCount: 8, eligibleCount: 10, historyCompleteness: "complete" as const },
  ];
  const { container } = render(<HistoryChart employee={{ ...summary.employee, history }} />);
  const path = container.querySelector(".eff-chart-line")!.getAttribute("d")!;
  expect(path.match(/M/g)).toHaveLength(2);
  expect(path).not.toContain("L");
  expect(container.querySelectorAll(".eff-chart-dot")).toHaveLength(2);
});

it("explains credit, overdue, exclusions, returns and tasks without deadlines", () => {
  expect(taskImpact(task)).toContain("зачёт");
  expect(taskImpact({ ...task, onTimeCount: 0, overdueCount: 1 })).toContain("Просрочка учтена в эффективности");
  expect(taskImpact({ ...task, excludedCount: 1 })).toContain("процент не снижает");
  expect(taskImpact({ ...task, onTimeCount: 0, returnedForRevisionCount: 1 })).toContain("отменил зачёт");
  expect(taskImpact({ ...task, onTimeCount: 0, dueAt: null })).toContain("Без срока");
});

it("keeps current deadline state separate from recorded monthly credit", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  expect(currentTaskLabel(task, now)).toBe("На проверке · текущий срок истёк");
  expect(taskImpact(task)).toContain("Сдана в срок");
  expect(currentTaskLabel({ ...task, status: "overdue", dueAt: "2026-10-20T12:00:00Z" }, now)).toBe("В работе");
  expect(taskImpact({ ...task, onTimeCount: 0, dueAt: "2026-09-01T12:00:00Z" })).toBe("Не вошла в расчёт за выбранный месяц");
});

it("explains why an active expired task is excluded while monthly overdue remains zero", async () => {
  const excluded = { ...task, title: "Исключённая активная задача", status: "in_progress" as const, onTimeCount: 0, excludedCount: 1 };
  vi.mocked(loadPersonalEfficiency).mockResolvedValue({ ...summary,
    employee: { ...summary.employee, overdueCount: 0, onTimeCount: 0, eligibleCount: 0, excludedCount: 7, percentage: null },
    recentTasks: [excluded], impactTasks: [excluded],
  });
  show();
  const metric = (await screen.findByText("Просрочки в расчёте")).closest("article")!;
  expect(metric).toHaveTextContent("0");
  expect(screen.getByText("Исключено из расчёта").closest("article")).toHaveTextContent("7");
  expect(screen.getAllByText(/Исключена из расчёта — процент не снижает/)).toHaveLength(2);
  expect(screen.getAllByTitle("Текущий срок задачи, не обязательно срок, учтённый в эффективности")).toHaveLength(2);
  const explanation = screen.getByText("Почему истёкший срок не всегда снижает эффективность?");
  fireEvent.click(explanation);
  expect(explanation.closest("details")).toHaveAttribute("open");
  expect(screen.getByText(/исключение не продлевает срок и не закрывает задачу/)).toBeInTheDocument();
});

it("keeps confirmed same-month data while a refresh is pending", async () => {
  vi.mocked(loadPersonalEfficiency).mockResolvedValueOnce(summary).mockImplementationOnce(() => new Promise(() => {}));
  show();
  await screen.findByRole("region", { name: "Выполнение задач в срок" });
  fireEvent.click(screen.getByRole("button", { name: "Обновить мою эффективность" }));
  await waitFor(() => expect(loadPersonalEfficiency).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("region", { name: "Выполнение задач в срок" })).toBeVisible();
  expect(screen.queryByRole("status", { name: "Готовим вашу эффективность" })).toBeNull();
});

it("shows actual data, task explanations and navigation without a nested dialog", async () => {
  vi.mocked(loadPersonalEfficiency).mockResolvedValue(summary);
  const back = vi.fn(); const open = vi.fn(); show(back, open);
  expect(await screen.findByText("3 из 4 задач в расчёте")).toBeInTheDocument();
  expect(screen.getByText(/Малая выборка/)).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: task.title })[0]!);
  expect(open).toHaveBeenCalledWith("task-1");
  fireEvent.click(screen.getByRole("button", { name: "К профилю" }));
  expect(back).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(loadPersonalEfficiency).toHaveBeenCalledWith("self-token", expect.stringMatching(/^\d{4}-\d{2}$/));
});

it("keeps personal aggregates accessible without task module permission", async () => {
  vi.mocked(loadPersonalEfficiency).mockResolvedValue({ ...summary, taskDetailsVisible: false, recentTasks: [], impactTasks: [] });
  show();
  expect(await screen.findByText(/Просмотр карточек задач отключён/)).toBeInTheDocument();
  expect(screen.getByText("3 из 4 задач в расчёте")).toBeInTheDocument();
  expect(screen.queryByText(task.title)).not.toBeInTheDocument();
  expect(screen.queryByText("Мои задачи сейчас")).not.toBeInTheDocument();
});

it("does not present absence of data as zero percent", async () => {
  vi.mocked(loadPersonalEfficiency).mockResolvedValue({ ...summary, employee: { ...summary.employee, percentage: null, onTimeCount: 0, eligibleCount: 0, historyCompleteness: "unavailable", smallSample: false } });
  show();
  expect(await screen.findByText(/Это не 0%/)).toBeInTheDocument();
  expect(screen.getByText(/Достоверной истории/)).toBeInTheDocument();
});

it("reports failure and retries successfully", async () => {
  vi.mocked(loadPersonalEfficiency).mockRejectedValueOnce(new Error("Сервер недоступен")).mockResolvedValueOnce(summary);
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent("Сервер недоступен");
  fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку" }));
  expect(await screen.findByText("3 из 4 задач в расчёте")).toBeInTheDocument();
});

it("ignores an earlier session response after the token changes", async () => {
  let resolveOld!: (value: PersonalEfficiency) => void;
  vi.mocked(loadPersonalEfficiency).mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce({ ...summary, employee: { ...summary.employee, name: "Новый сотрудник" } });
  const view = show();
  view.rerender(<FluentProvider theme={workspaceTheme}><PersonalEfficiencyView token="new-token" onBack={vi.fn()} /></FluentProvider>);
  expect(await screen.findByRole("heading", { name: "Новый сотрудник" })).toBeInTheDocument();
  await act(async () => { resolveOld(summary); });
  expect(screen.queryByRole("heading", { name: "Сотрудник" })).not.toBeInTheDocument();
  await waitFor(() => expect(loadPersonalEfficiency).toHaveBeenCalledTimes(2));
});
