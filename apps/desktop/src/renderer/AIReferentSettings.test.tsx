import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { AIReferentConfiguration } from "@yuksalish/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIReferentSettings } from "./AIReferentSettings";
import { workspaceTheme } from "./workspace-theme";
import { loadAIReferentConfiguration, saveAIReferentConfiguration } from "./workspace-api";

vi.mock("./workspace-api", () => ({
  loadAIReferentConfiguration: vi.fn(),
  saveAIReferentConfiguration: vi.fn(),
}));

const configuration: AIReferentConfiguration = {
  revision: 2, updatedAt: "2026-09-22T10:00:00Z", runtimes: [],
  reviewers: (["askar", "bobur", "umid", "davronbek"] as const).map((key) => ({
    key, label: key, suggestedUsername: `${key}_initial`, userId: key === "askar" ? "user-1" : null,
    username: key === "askar" ? "current_user" : "", fullName: key === "askar" ? "Текущий аккаунт" : "",
    telegramId: key === "askar" ? "123456" : null, enabled: key === "askar",
    accountActive: key === "askar", canApprove: key === "askar",
  })),
};

function show() {
  return render(<FluentProvider theme={workspaceTheme}>
    <AIReferentSettings token="test-token" people={[
      { id: "user-1", name: "Текущий аккаунт", username: "current_user", status: "active",
        initials: "ТА", role: "employee", color: "#eee" },
    ]} />
  </FluentProvider>);
}

describe("shared reviewer settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadAIReferentConfiguration).mockResolvedValue(configuration);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("saves an account binding with optimistic revision and reports pending robot confirmation", async () => {
    vi.mocked(saveAIReferentConfiguration).mockResolvedValue({ ...configuration, revision: 3 });
    show();
    const input = await screen.findByRole("textbox", { name: "Telegram ID askar" });
    fireEvent.change(input, { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить настройки" }));
    await waitFor(() => expect(saveAIReferentConfiguration).toHaveBeenCalledWith("test-token",
      expect.objectContaining({ expectedRevision: 2, reviewers: expect.arrayContaining([
        { key: "askar", username: "current_user", telegramId: "654321", enabled: true },
      ]) })));
    expect(await screen.findByText(/Робот применит настройки/)).toBeInTheDocument();
    expect(screen.getByText(/Робот ещё не подтвердил/)).toBeInTheDocument();
  });

  it("ignores an old poll response arriving after a successful save", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    show();
    const input = await screen.findByRole("textbox", { name: "Telegram ID askar" });
    fireEvent.change(input, { target: { value: "654321" } });
    const deferred: { resolve?: (value: AIReferentConfiguration) => void } = {};
    vi.mocked(loadAIReferentConfiguration).mockReturnValue(new Promise((resolve) => {
      deferred.resolve = resolve;
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    vi.mocked(saveAIReferentConfiguration).mockResolvedValue({ ...configuration, revision: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить настройки" }));
    expect(await screen.findByText("Версия 3")).toBeInTheDocument();
    await act(async () => { deferred.resolve?.(configuration); });
    expect(screen.getByText("Версия 3")).toBeInTheDocument();
  });

  it("polls without overwriting dirty fields and prevents a stale save", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    show();
    const input = await screen.findByRole("textbox", { name: "Telegram ID askar" });
    fireEvent.change(input, { target: { value: "654321" } });
    vi.mocked(loadAIReferentConfiguration).mockResolvedValue({ ...configuration, revision: 3 });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(input).toHaveValue("654321");
    expect(screen.getByText(/Настройки изменены на другом устройстве/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сохранить настройки" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Сбросить ввод к актуальной версии" }));
    expect(input).toHaveValue("123456");
  });

  it("keeps input after a failed save", async () => {
    vi.mocked(saveAIReferentConfiguration).mockRejectedValue(new Error("Сервер недоступен"));
    show();
    const input = await screen.findByRole("textbox", { name: "Telegram ID askar" });
    fireEvent.change(input, { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить настройки" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сервер недоступен");
    expect(input).toHaveValue("654321");
    expect(screen.getByRole("button", { name: "Сохранить настройки" })).toBeEnabled();
  });
});
