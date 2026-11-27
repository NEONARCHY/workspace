import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as names from "./employee-display-name";
import type { TelegramAccessPerson, TelegramAccessRegistry } from "@yuksalish/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelegramAccessView } from "./TelegramAccessView";
import {
  loadTelegramAccess,
  saveTelegramAccess,
} from "./workspace-api";

vi.mock("./workspace-api", () => ({
  loadTelegramAccess: vi.fn(),
  saveTelegramAccess: vi.fn(),
}));

const employee: TelegramAccessPerson = {
  userId: "person-1", username: "employee", fullName: "Пример Сотрудник",
  jobTitle: "Специалист", telegramId: null, verified: false,
  verificationSource: null, botKeys: [], revision: 0,
  hisobotScope: null, hisobotRegion: null,
  hisobotReportRequired: true, hisobotManager: false,
};

const registry: TelegramAccessRegistry = {
  bots: [
    { key: "ai_referent", label: "AI Referent", connected: true },
    { key: "hisobot", label: "AI Hisobot", connected: true },
  ],
  people: [employee],
};

describe("Telegram bot access hub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadTelegramAccess).mockResolvedValue(registry);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("does not redraw unchanged editors while filtering the same employees", async () => {
    const initials = vi.spyOn(names, "employeeInitials");
    render(<TelegramAccessView token="token" />);
    await screen.findByText(employee.fullName); initials.mockClear();
    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск сотрудников для Telegram" }), { target: { value: "Пример" } });
    expect(screen.getByText(employee.fullName)).toBeVisible();
    expect(initials).not.toHaveBeenCalled();
  });

  it("aborts old registry reads on token change and ignores a late response after unmount", async () => {
    let finish!: (value: TelegramAccessRegistry) => void;
    vi.mocked(loadTelegramAccess).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<TelegramAccessView token="old" />);
    await waitFor(() => expect(loadTelegramAccess).toHaveBeenCalledOnce());
    const signal = vi.mocked(loadTelegramAccess).mock.calls[0]![1]!;
    view.rerender(<TelegramAccessView token="new" />);
    await screen.findByText(employee.fullName);
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ ...registry, people: [{ ...employee, fullName: "Устаревший ответ" }] }));
    expect(screen.queryByText("Устаревший ответ")).toBeNull();
    const latestSignal = vi.mocked(loadTelegramAccess).mock.calls[1]![1]!;
    view.unmount(); expect(latestSignal.aborted).toBe(true);
  });

  it("does not grant a bot without a Telegram ID", async () => {
    render(<TelegramAccessView token="token" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "AI Referent" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Сначала укажите Telegram ID");
    expect(saveTelegramAccess).not.toHaveBeenCalled();
  });

  it("saves an immediately active grant without a verification code", async () => {
    vi.mocked(saveTelegramAccess).mockResolvedValue({
      ...employee, telegramId: "123456789", verified: true,
      verificationSource: "admin", botKeys: ["ai_referent"], revision: 1,
    });
    render(<TelegramAccessView token="token" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Telegram ID" }), {
      target: { value: "123456789" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "AI Referent" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(saveTelegramAccess).toHaveBeenCalledWith("token", "person-1", {
      telegramId: "123456789", botKeys: ["ai_referent"], expectedRevision: 0,
      hisobotScope: null, hisobotRegion: null,
      hisobotReportRequired: true, hisobotManager: false,
    }));
    expect(await screen.findByText("Сохранено. Доступ к подключённым ботам действует сразу.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Получить код" })).not.toBeInTheDocument();
  });

  it("keeps the ID after a server conflict", async () => {
    vi.mocked(saveTelegramAccess).mockRejectedValue(new Error("Доступ уже изменён"));
    render(<TelegramAccessView token="token" />);
    const input = await screen.findByRole("textbox", { name: "Telegram ID" });
    fireEvent.change(input, { target: { value: "123456789" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Доступ уже изменён");
    expect(input).toHaveValue("123456789");
  });

  it("separates central and regional employees in the admin list", async () => {
    vi.mocked(loadTelegramAccess).mockResolvedValue({
      ...registry,
      people: [
        { ...employee, departmentId: "central" },
        { ...employee, userId: "person-2", username: "region", fullName: "Региональный сотрудник", departmentId: "regional" },
      ],
    });
    render(<TelegramAccessView token="token" departments={[
      { id: "central", code: "central", name: "ЦА", scope: "central", assignedUsersCount: 1 },
      { id: "regional", code: "regional", name: "Регион", scope: "regional", assignedUsersCount: 1 },
    ]} />);
    expect(await screen.findByText("Пример Сотрудник")).toBeInTheDocument();
    expect(screen.queryByText("Региональный сотрудник")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Регионы" }));
    expect(screen.queryByText("Пример Сотрудник")).toBeNull();
    expect(screen.getByText("Региональный сотрудник")).toBeInTheDocument();
  });
});
