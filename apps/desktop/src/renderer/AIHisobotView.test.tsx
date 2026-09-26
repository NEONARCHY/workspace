import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HisobotProfile, HisobotReport } from "@yuksalish/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIHisobotView } from "./AIHisobotView";
import {
  loadHisobotHistory, loadHisobotProfile, loadHisobotReports, saveHisobotReport,
} from "./workspace-api";

vi.mock("./workspace-api", () => ({
  loadHisobotHistory: vi.fn(),
  loadHisobotProfile: vi.fn(),
  loadHisobotReports: vi.fn(),
  saveHisobotReport: vi.fn(),
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
  windowOpensAt: "12:00", windowClosesAt: "18:30", todayReport: null,
};

describe("AI Hisobot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadHisobotProfile).mockResolvedValue(profile);
    vi.mocked(loadHisobotHistory).mockResolvedValue([]);
    vi.mocked(loadHisobotReports).mockResolvedValue([]);
    vi.mocked(saveHisobotReport).mockResolvedValue(report);
  });
  afterEach(cleanup);

  it("shows a varied report illustration in the header", () => {
    const { container } = render(<AIHisobotView token="token" />);
    expect(container.querySelectorAll(".ai-hisobot-header-art svg")).toHaveLength(7);
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
});
