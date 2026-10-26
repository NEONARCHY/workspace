import { FluentProvider } from "@fluentui/react-components";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceTheme } from "./workspace-theme";
import type * as ReleaseHistory from "./release-history";

const { checkWebVersion, loadReleaseReads, acknowledgeReleaseReads, requestWebReload } = vi.hoisted(() => ({
  checkWebVersion: vi.fn(), loadReleaseReads: vi.fn(), acknowledgeReleaseReads: vi.fn(), requestWebReload: vi.fn(),
}));
vi.mock("./platform-adapter", () => ({
  workspacePlatform: { kind: "web", version: "2.0.10", checkWebVersion }, requestWebReload,
}));
vi.mock("./workspace-api", () => ({ loadReleaseReads, acknowledgeReleaseReads, hasPendingMutation: () => false }));
vi.mock("./release-history", async importOriginal => ({
  ...await importOriginal<typeof ReleaseHistory>(),
  bundledReleaseEntries: () => [
    { id: "installed:new", version: "2.0.10", title: "Последний выпуск", items: ["Новый пункт"] },
    { id: "installed:old", version: "2.0.9", title: "Ранний выпуск", items: ["Старый пункт"] },
  ],
}));
import { WorkspaceReleaseUpdates } from "./WorkspaceReleaseUpdates";
const tree = () => <FluentProvider theme={workspaceTheme}><WorkspaceReleaseUpdates token="test-account" /></FluentProvider>;

describe("WorkspaceReleaseUpdates coordination", () => {
  beforeEach(() => {
    vi.resetAllMocks(); localStorage.clear();
    loadReleaseReads.mockResolvedValue({ readEntryIds: [] });
    acknowledgeReleaseReads.mockResolvedValue({ readEntryIds: ["installed:new", "installed:old"] });
    checkWebVersion.mockResolvedValue(null);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it("waits for the version check, then shows only installed history and saves explicitly", async () => {
    let finish: ((value: null) => void) | undefined;
    checkWebVersion.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(tree());
    await waitFor(() => expect(loadReleaseReads).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => finish?.(null));
    expect(await screen.findByRole("dialog", { name: "Что изменилось в Workspace" })).toHaveTextContent("Старый пункт");
    expect(screen.queryByRole("button", { name: "Обновить" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Понятно, продолжить" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(acknowledgeReleaseReads).toHaveBeenCalledWith("test-account", { entryIds: ["installed:new", "installed:old"] });
  });
  it("does not open old history after postponing or requesting an update", async () => {
    checkWebVersion.mockResolvedValue({ version: "2.0.11", buildId: "future" });
    render(tree());
    fireEvent.click(await screen.findByRole("button", { name: "Напомнить позже" }));
    await waitFor(() => expect(loadReleaseReads).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent(window, new Event("yuksalish:show-web-update"));
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    expect(requestWebReload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(acknowledgeReleaseReads).not.toHaveBeenCalled();
  });
  it("shows installed history if the version server cannot be reached", async () => {
    checkWebVersion.mockRejectedValue(new Error("offline"));
    render(tree());
    expect(await screen.findByRole("dialog")).toHaveTextContent("Новый пункт");
    expect(acknowledgeReleaseReads).not.toHaveBeenCalled();
  });
  it("keeps a known update pending when a subsequent check fails", async () => {
    vi.useFakeTimers();
    checkWebVersion.mockResolvedValueOnce({ version: "2.0.11", buildId: "future" }).mockRejectedValue(new Error("offline"));
    render(tree());
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    fireEvent.click(screen.getByRole("button", { name: "Напомнить позже" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(acknowledgeReleaseReads).not.toHaveBeenCalled();
  });
});
