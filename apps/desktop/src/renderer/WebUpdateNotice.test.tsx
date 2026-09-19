import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkWebVersion, requestWebReload } = vi.hoisted(() => ({
  checkWebVersion: vi.fn(),
  requestWebReload: vi.fn(),
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
vi.mock("./workspace-api", () => ({ hasPendingMutation: () => false }));

import { WebUpdateNotice } from "./WebUpdateNotice";

describe("WebUpdateNotice", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    checkWebVersion.mockResolvedValue({
      buildId: "new-build",
      version: "1.0.1",
      builtAt: "2026-09-19T00:00:00Z",
      title: "Workspace стал удобнее",
      notes: ["Обновили рабочие экраны.", "Улучшили сообщения и медиафайлы."],
    });
  });

  it("shows the new version and understandable release notes in a dialog", async () => {
    render(<WebUpdateNotice />);
    expect(await screen.findByRole("dialog", { name: "Workspace стал удобнее" })).toBeInTheDocument();
    expect(screen.getByText("1.0.1")).toBeInTheDocument();
    expect(screen.getByText("Обновили рабочие экраны.")).toBeInTheDocument();
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
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const first = JSON.parse(localStorage.getItem("yuksalish:web:update-snooze") ?? "null") as { count: number };
    expect(first.count).toBe(1);
    vi.advanceTimersByTime(30 * 60_000);
    await vi.runOnlyPendingTimersAsync();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Напомнить позже" }));
    const second = JSON.parse(localStorage.getItem("yuksalish:web:update-snooze") ?? "null") as { count: number };
    expect(second.count).toBe(2);
    vi.useRealTimers();
  });

  it("does not allow postponing a mandatory update", async () => {
    render(<WebUpdateNotice mandatory />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
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
});
