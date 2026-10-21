import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HisobotProfile, HisobotReport, HisobotUnitReport } from "@yuksalish/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIHisobotView } from "./AIHisobotView";
import {
  loadHisobotHistory, loadHisobotProfile, loadHisobotReports, loadHisobotUnitHistory,
  loadHisobotUnitReports, saveHisobotReport, saveHisobotUnitReport,
} from "./workspace-api";

vi.mock("./workspace-api", () => ({
  loadHisobotHistory: vi.fn(),
  loadHisobotProfile: vi.fn(),
  loadHisobotReports: vi.fn(),
  loadHisobotUnitHistory: vi.fn(),
  loadHisobotUnitReports: vi.fn(),
  saveHisobotReport: vi.fn(),
  acknowledgeHisobotActivityDraft: vi.fn().mockResolvedValue(undefined),
  saveHisobotUnitReport: vi.fn(),
}));

const report: HisobotReport = {
  id: "report-1", userId: "user-1", telegramId: "123456789", employeeKey: "test",
  fullName: "Пример Сотрудник", position: "Специалист", reportScope: "central",
  regionName: null, reportDate: "2026-09-25", content: "Выполнена важная задача.",
  submittedAt: "2026-09-25T10:00:00Z", isLate: false, source: "telegram",
};

const profile: HisobotProfile = {
  telegramId: "123456789", fullName: "Пример Сотрудник", position: "Специалист",
  reportScope: "central", regionName: null, reportRequired: true,
  managementAccess: false, absenceKind: null, today: "2026-09-25", canSubmit: true,
  windowOpensAt: "12:00", windowClosesAt: "21:00", deadlineAt: "18:30",
  isOverdue: false, todayReport: null,
};

const unitReport: HisobotUnitReport = {
  id: "unit-report-1", departmentId: "department-1", departmentName: "Пример отдела",
  reporterTelegramId: "123456789", reporterEmployeeKey: "test",
  reporterName: "Пример Сотрудник", reporterPosition: "Специалист",
  reportScope: "central", regionName: null, coveredTelegramIds: ["123456789"],
  reportDate: "2026-09-25", content: "Выполнена общая задача.",
  submittedAt: "2026-09-25T10:00:00Z", isLate: false, source: "telegram",
};

describe("AI Hisobot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadHisobotProfile).mockResolvedValue(profile);
    vi.mocked(loadHisobotHistory).mockResolvedValue([]);
    vi.mocked(loadHisobotReports).mockResolvedValue([]);
    vi.mocked(loadHisobotUnitHistory).mockResolvedValue([]);
    vi.mocked(loadHisobotUnitReports).mockResolvedValue([]);
    vi.mocked(saveHisobotReport).mockResolvedValue(report);
    vi.mocked(saveHisobotUnitReport).mockResolvedValue(unitReport);
  });
  afterEach(cleanup);

  it("shows a varied report illustration in the header", () => {
    const { container } = render(<AIHisobotView token="token" />);
    expect(container.querySelectorAll(".ai-hisobot-header-art svg")).toHaveLength(7);
  });

  it("inserts a handed-off draft into an empty editor but never submits automatically", async () => {
    render(<AIHisobotView token="token" incomingDraft={{ content: "Готовый черновик", reportDate: profile.today, revision: 1 }} />);
    expect(await screen.findByDisplayValue("Готовый черновик")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отправить отчёт" })).toBeEnabled();
    expect(saveHisobotReport).not.toHaveBeenCalled();
  });

  it("preserves the employee's draft and appends the suggestion only on explicit request", async () => {
    const { rerender } = render(<AIHisobotView token="token" />);
    fireEvent.change(await screen.findByRole("textbox", { name: /Опишите выполненные задачи/ }), { target: { value: "Моя ручная работа" } });
    rerender(<AIHisobotView token="token" incomingDraft={{ content: "Автоматические факты", reportDate: profile.today, revision: 2 }} />);
    expect(await screen.findByText(/Ваш текст сохранён. Подготовленный черновик/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Опишите выполненные задачи/ })).toHaveValue("Моя ручная работа");
    fireEvent.click(screen.getByRole("button", { name: "Добавить к моему тексту" }));
    expect(screen.getByRole("textbox", { name: /Опишите выполненные задачи/ })).toHaveValue("Моя ручная работа\n\nАвтоматические факты");
    expect(saveHisobotReport).not.toHaveBeenCalled();
  });

  it("keeps an already submitted report and rejects a different-day handoff", async () => {
    vi.mocked(loadHisobotProfile).mockResolvedValue({ ...profile, todayReport: report });
    const { rerender } = render(<AIHisobotView token="token" incomingDraft={{ content: "Предложение", reportDate: profile.today, revision: 3 }} />);
    expect(await screen.findByDisplayValue(report.content)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Добавить к моему тексту" })).toBeInTheDocument();
    rerender(<AIHisobotView token="token" incomingDraft={{ content: "Вчерашнее", reportDate: "2026-09-24", revision: 4 }} />);
    expect(await screen.findByText(/Черновик относится к другому дню/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Чтобы исправить или дополнить/ })).toHaveValue(report.content);
    expect(saveHisobotReport).not.toHaveBeenCalled();
  });

  it("offers server-generated facts without replacing the editor during refresh", async () => {
    vi.mocked(loadHisobotProfile).mockResolvedValue({ ...profile, activityDraft: {
      reportDate: profile.today, generatedAt: "2026-09-25T12:40:00Z", seenAt: null,
      content: "Системные факты", activityCount: 2, omittedCount: 0,
    } });
    render(<AIHisobotView token="token" />);
    fireEvent.click(await screen.findByRole("button", { name: "Использовать черновик" }));
    const field = screen.getByRole("textbox", { name: /Опишите выполненные задачи/ });
    expect(field).toHaveValue("Системные факты");
    fireEvent.change(field, { target: { value: "Системные факты плюс мой текст" } });
    await waitFor(() => expect(loadHisobotProfile).toHaveBeenCalledTimes(2));
    expect(field).toHaveValue("Системные факты плюс мой текст");
  });

  it("allows a voluntary report during confirmed sick leave", async () => {
    vi.mocked(loadHisobotProfile).mockResolvedValue({ ...profile, absenceKind: "sick_leave" });
    render(<AIHisobotView token="token" />);
    expect(await screen.findByText("Вы на больничном")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /Опишите выполненные задачи/ }), {
      target: { value: "Выполнена важная задача." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить отчёт" }));
    await waitFor(() => expect(saveHisobotReport).toHaveBeenCalledWith("token", "Выполнена важная задача."));
  });

  it("shows a Telegram report for editing and historical review", async () => {
    vi.mocked(loadHisobotProfile).mockResolvedValue({ ...profile, todayReport: report });
    vi.mocked(loadHisobotHistory).mockResolvedValue([report]);
    render(<AIHisobotView token="token" />);
    expect(await screen.findByDisplayValue("Выполнена важная задача.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Моя история" }));
    expect(await screen.findByText("Telegram")).toBeInTheDocument();
    expect(screen.getByText("Выполнена важная задача.")).toBeInTheDocument();
  });

  it("keeps submission open for an overdue employee and labels a late report", async () => {
    vi.mocked(loadHisobotProfile).mockResolvedValue({ ...profile, isOverdue: true });
    render(<AIHisobotView token="token" />);
    expect(await screen.findByText("Опоздавший · отчёт ещё не сдан")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отправить отчёт" })).toBeInTheDocument();
    expect(screen.getByText("12:00—21:00")).toBeInTheDocument();
    cleanup();
    vi.mocked(loadHisobotProfile).mockResolvedValue({
      ...profile, todayReport: { ...report, isLate: true }, isOverdue: false,
    });
    vi.mocked(loadHisobotHistory).mockResolvedValue([{ ...report, isLate: true }]);
    render(<AIHisobotView token="token" />);
    fireEvent.click(await screen.findByRole("button", { name: "Моя история" }));
    expect(screen.getByText(/опоздавший \(после 18:30\)/)).toBeInTheDocument();
  });

  it("lets a lead choose a unit report but hides that action after a personal report", async () => {
    vi.mocked(loadHisobotProfile).mockResolvedValue({
      ...profile, canSubmitUnit: true,
      unit: { id: "department-1", name: "Пример отдела", isLead: true, memberCount: 3 },
    });
    render(<AIHisobotView token="token" />);
    expect(await screen.findByRole("button", { name: "Отправить отчёт от лица отдела" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /Опишите выполненные командой задачи/ }), {
      target: { value: "Выполнена общая задача." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить отчёт от лица отдела" }));
    await waitFor(() => expect(saveHisobotUnitReport).toHaveBeenCalledWith("token", "Выполнена общая задача."));
    cleanup();
    vi.mocked(loadHisobotProfile).mockResolvedValue({
      ...profile, todayReport: report, canSubmitUnit: false,
      unit: { id: "department-1", name: "Пример отдела", isLead: true, memberCount: 3 },
    });
    render(<AIHisobotView token="token" />);
    expect(await screen.findByDisplayValue("Выполнена важная задача.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Отправить отчёт от лица отдела" })).not.toBeInTheDocument();
  });

  it("shows only unit editing after the lead sent a unit report", async () => {
    vi.mocked(loadHisobotProfile).mockResolvedValue({
      ...profile, canSubmit: false, canSubmitUnit: true, todayUnitReport: unitReport,
      unit: { id: "department-1", name: "Пример отдела", isLead: true, memberCount: 3 },
    });
    render(<AIHisobotView token="token" />);
    expect(await screen.findByDisplayValue("Выполнена общая задача.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Отправить отчёт" })).not.toBeInTheDocument();
  });

  it("still allows another department member to send their own personal report", async () => {
    vi.mocked(loadHisobotProfile).mockResolvedValue({
      ...profile, todayUnitReport: { ...unitReport, reporterTelegramId: "987654321" },
      coveredByReport: true,
      unit: { id: "department-1", name: "Пример отдела", isLead: false, memberCount: 3 },
    });
    render(<AIHisobotView token="token" />);
    expect(await screen.findByRole("button", { name: "Отправить отчёт" })).toBeInTheDocument();
    expect(screen.getByText(/За вашу команду уже предоставлен отчёт/)).toBeInTheDocument();
  });

  it("explains department and region rules without staff names", async () => {
    render(<AIHisobotView token="token" />);
    fireEvent.click(screen.getByRole("button", { name: "Правила AI Hisobot" }));
    const dialog = screen.getByRole("dialog", { name: "Как учитываются отчёты" });
    expect(dialog).toHaveTextContent("Если сотрудник отправил только личный отчёт, он засчитывается только ему");
    expect(dialog).toHaveTextContent("Это его единственный отчёт за день");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
