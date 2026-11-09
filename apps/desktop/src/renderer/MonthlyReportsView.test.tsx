import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MonthlyCycle, MonthlyOverview } from "@yuksalish/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonthlyReportDashboard, MonthlyReportPrompts, MonthlyReportsView } from "./MonthlyReportsView";
import { authorizeMonthlyPayroll, loadMonthlyReportTemplate, submitMonthlyReport } from "./workspace-api";

vi.mock("./workspace-api", () => ({
  authorizeMonthlyPayroll: vi.fn(), loadMonthlyCalendar: vi.fn().mockResolvedValue([]),
  loadMonthlyReportFile: vi.fn(), loadMonthlyReportTemplate: vi.fn(),
  markWorkspaceNotificationRead: vi.fn(), saveMonthlyCalendar: vi.fn(), submitMonthlyReport: vi.fn(),
}));
const cycle: MonthlyCycle = {
  month: "2026-11-01", reminderOn: "2026-11-25", total: 3, submitted: 1,
  authorizedAt: null, authorizedByName: null, comment: "", members: [], canSubmit: true,
};
const base: MonthlyOverview = {
  today: "2026-11-25", activeMonth: "2026-11-01", dashboardVisible: false,
  canReview: false, canAuthorize: false, canConfigure: false, reminderMonth: "2026-11-01",
  payrollNotice: null, payrollNoticeId: null, reports: [], cycles: [cycle],
};
const resource = (data: MonthlyOverview = base) => ({ data, error: undefined, loading: false, refresh: vi.fn().mockResolvedValue(undefined) });

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(cleanup);
describe("monthly reporting", () => {
  it("retains files and the idempotency key after an uncertain upload; clears only on success", async () => {
    vi.mocked(submitMonthlyReport).mockRejectedValueOnce(new Error("Сеть недоступна")).mockResolvedValueOnce({
      id: "saved", month: base.activeMonth!, userId: "owner", revision: 1, comment: "Результаты",
      submittedAt: "2026-11-25T10:00:00Z", files: [],
    });
    const state = resource();
    render(<MonthlyReportsView token="token" resource={state} />);
    fireEvent.change(screen.getByLabelText("Файлы отчёта"), { target: { files: [new File(["content"], "report.docx")] } });
    fireEvent.change(screen.getByLabelText("Комментарий к отчёту (необязательно)"), { target: { value: "Результаты" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить отчёт" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сеть недоступна");
    expect(screen.getByText("report.docx · 1 КБ")).toBeInTheDocument();
    expect(screen.getByLabelText("Комментарий к отчёту (необязательно)")).toHaveValue("Результаты");
    const first = vi.mocked(submitMonthlyReport).mock.calls[0]?.[1];
    expect(first).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Отправить отчёт" }));
    await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
    expect(vi.mocked(submitMonthlyReport).mock.calls[1]?.[1]).toEqual(first);
    expect(screen.queryByText("report.docx · 1 КБ")).not.toBeInTheDocument();
  });

  it("downloads the provided template through the protected endpoint", async () => {
    vi.mocked(loadMonthlyReportTemplate).mockResolvedValue(new Blob(["template"]));
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:template");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<MonthlyReportsView token="token" resource={resource()} />);
    fireEvent.click(screen.getByRole("button", { name: "Скачать шаблон отчёта" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(loadMonthlyReportTemplate).toHaveBeenCalledWith("token");
    vi.restoreAllMocks();
  });

  it("shows missing employees and requires an explicit monthly payroll confirmation", async () => {
    const data = { ...base, canReview: true, canAuthorize: true };
    const state = resource(data);
    vi.mocked(authorizeMonthlyPayroll).mockResolvedValue(cycle);
    render(<MonthlyReportsView token="deputy" resource={state} />);
    fireEvent.click(screen.getByRole("button", { name: "Разрешить начисление заработной платы" }));
    expect(authorizeMonthlyPayroll).not.toHaveBeenCalled();
    expect(screen.getByText(/Сдали 1 из 3. После разрешения/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Подтвердить разрешение за/ }));
    await waitFor(() => expect(authorizeMonthlyPayroll).toHaveBeenCalledWith("deputy", "2026-11-01", ""));
    expect(state.refresh).toHaveBeenCalledOnce();
  });

  it("keeps payroll authorization and other employee files out of the employee view", () => {
    render(<MonthlyReportsView token="owner" resource={resource()} />);
    expect(screen.queryByRole("button", { name: "Разрешить начисление заработной платы" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Сдача отчётов сотрудниками ЦА" })).not.toBeInTheDocument();
  });

  it("hides the dashboard outside the server-authorized date/role window", () => {
    const open = vi.fn();
    const view = render(<MonthlyReportDashboard resource={resource()} onOpen={open} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    view.rerender(<MonthlyReportDashboard resource={resource({ ...base, dashboardVisible: true })} onOpen={open} />);
    fireEvent.click(screen.getByRole("button"));
    expect(open).toHaveBeenCalledOnce();
    expect(screen.getByText("Сдали 1 · не сдали 2 · всего 3")).toBeInTheDocument();
  });

  it("does not interrupt an existing dialog and shows the reminder once per employee/day", async () => {
    vi.useFakeTimers();
    const open = vi.fn();
    const view = render(<><div role="dialog" aria-label="Другой запрос" /><MonthlyReportPrompts resource={resource()} token="token" userId="owner" paused={false} onOpen={open} /></>);
    expect(open).not.toHaveBeenCalled();
    view.rerender(<MonthlyReportPrompts resource={resource()} token="token" userId="owner" paused={false} onOpen={open} />);
    expect(open).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTime(4_000));
    expect(open).toHaveBeenCalledOnce();
    view.unmount();
    render(<MonthlyReportPrompts resource={resource()} token="token" userId="owner" paused={false} onOpen={open} />);
    expect(open).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("locks upload after salary authorization and keeps previous versions downloadable", () => {
    render(<MonthlyReportsView token="token" resource={resource({ ...base, cycles: [{ ...cycle, canSubmit: false, authorizedAt: "2026-11-30T12:00:00Z", authorizedByName: "Первый заместитель" }] })} />);
    expect(screen.queryByLabelText("Файлы отчёта")).not.toBeInTheDocument();
    expect(screen.getByText(/Отчёты за этот месяц закрыты/)).toBeInTheDocument();
  });
});
