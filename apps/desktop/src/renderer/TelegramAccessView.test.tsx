import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
};

const registry: TelegramAccessRegistry = {
  bots: [
    { key: "ai_referent", label: "AI Referent", connected: true },
    { key: "hisobot", label: "AI Hisobot", connected: false },
  ],
  people: [employee],
};

describe("Telegram bot access hub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadTelegramAccess).mockResolvedValue(registry);
  });
  afterEach(cleanup);

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
});
