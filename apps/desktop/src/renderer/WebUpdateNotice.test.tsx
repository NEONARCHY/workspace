import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkWebVersion, requestWebReload, hasPendingMutation } = vi.hoisted(() => ({
  checkWebVersion: vi.fn(),
  requestWebReload: vi.fn(),
  hasPendingMutation: vi.fn(),
}));

vi.mock("./platform-adapter", () => ({
  requestWebReload,
  workspacePlatform: {
    kind: "web",
    version: "0.30.3",
    buildId: "old-build",
    checkWebVersion,
  },
}));
vi.mock("./workspace-api", () => ({ hasPendingMutation }));

import { WebUpdateNotice } from "./WebUpdateNotice";

describe("WebUpdateNotice", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  beforeEach(() => {
    vi.resetAllMocks();
    hasPendingMutation.mockReturnValue(false);
    localStorage.clear();
    checkWebVersion.mockResolvedValue({
      buildId: "new-build",
      version: "1.0.1",
      builtAt: "2026-09-19T00:00:00Z",
      title: "Workspace стал удобнее",
      notes: ["Обновили рабочие экраны.", "Улучшили сообщения и медиафайлы."],
    });
  });

  it("offers a compact non-modal notice without duplicate release notes", async () => {
    render(<WebUpdateNotice />);
    expect(await screen.findByRole("region", { name: "Доступна новая версия" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("1.0.1")).toBeInTheDocument();
    expect(screen.queryByText("Обновили рабочие экраны.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Обновить" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Напомнить позже" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    expect(requestWebReload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(checkWebVersion).toHaveBeenCalledTimes(1));
  });

  it("reminds after progressively longer 30 minute intervals", async () => {
    vi.useFakeTimers();
    render(<WebUpdateNotice />);
    await vi.runOnlyPendingTimersAsync();
    expect(screen.getByRole("button", { name: "Напомнить позже" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Напомнить позже" }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    const first = JSON.parse(localStorage.getItem("yuksalish:web:update-snooze") ?? "null") as { count: number };
    expect(first.count).toBe(1);
    vi.advanceTimersByTime(30 * 60_000);
    await vi.runOnlyPendingTimersAsync();
    expect(screen.getByRole("region")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Напомнить позже" }));
    const second = JSON.parse(localStorage.getItem("yuksalish:web:update-snooze") ?? "null") as { count: number };
    expect(second.count).toBe(2);
    vi.useRealTimers();
  });

  it("leaves all release notes for the single post-update history", async () => {
    checkWebVersion.mockResolvedValue({ version: "1.0.1", buildId: "new", notes: ["Краткое описание"], history: [
      { version: "1.0.1", title: "Последняя версия", items: ["Последний пункт"] },
      { version: "1.0.0", title: "Промежуточная версия", items: ["Пропущенный пункт"] },
      { version: "0.30.3", title: "Установлено", items: ["Уже установлено"] },
      { version: "1.0.2", title: "Будущее", items: ["Ещё не выпущено"] },
    ] });
    render(<WebUpdateNotice />);
    await screen.findByRole("region");
    expect(screen.queryByText("Последний пункт")).not.toBeInTheDocument();
    expect(screen.queryByText("Пропущенный пункт")).not.toBeInTheDocument();
    expect(screen.queryByText("Уже установлено")).not.toBeInTheDocument();
    expect(screen.queryByText("Ещё не выпущено")).not.toBeInTheDocument();
  });

  it("does not allow postponing a mandatory update", async () => {
    render(<WebUpdateNotice mandatory />);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Напомнить позже" })).not.toBeInTheDocument();
  });

  it("does not repeat release notes for another build of the same version", async () => {
    checkWebVersion.mockResolvedValue({
      buildId: "another-build",
      version: "0.30.3",
      builtAt: "2026-09-19T00:00:00Z",
      title: "Уже прочитанное обновление",
      notes: ["Этот пункт больше не должен появляться повторно."],
    });
    render(<WebUpdateNotice />);
    await waitFor(() => expect(checkWebVersion).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("blocks reload during a mutation and allows it after completion", async () => {
    render(<WebUpdateNotice />);
    await screen.findByRole("region");
    hasPendingMutation.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    expect(requestWebReload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("дождитесь завершения");
    hasPendingMutation.mockReturnValue(false);
    await waitFor(() => expect(screen.getByRole("button", { name: "Обновить" })).toBeEnabled());
  });
  it("allows retry after the reload request fails", async () => {
    requestWebReload.mockImplementationOnce(() => { throw new Error("cancelled"); });
    render(<WebUpdateNotice />);
    fireEvent.click(await screen.findByRole("button", { name: "Обновить" }));
    expect(screen.getByRole("alert")).toHaveTextContent("отметки об ознакомлении не изменены");
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    expect(requestWebReload).toHaveBeenCalledTimes(2);
  });
  it("does not offer an older server version", async () => {
    checkWebVersion.mockResolvedValue({ version: "0.30.2", buildId: "old" });
    const report = vi.fn();
    render(<WebUpdateNotice onAvailabilityChange={report} />);
    await waitFor(() => expect(report).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
  it("recovers if navigation was cancelled instead of marking anything read", async () => {
    vi.useFakeTimers();
    render(<WebUpdateNotice />);
    await vi.runOnlyPendingTimersAsync();
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("отметки об ознакомлении не изменены");
    expect(screen.getByRole("button", { name: "Обновить" })).toBeEnabled();
  });
});
