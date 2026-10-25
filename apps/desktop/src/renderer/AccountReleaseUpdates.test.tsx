import { FluentProvider } from "@fluentui/react-components";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceTheme } from "./workspace-theme";
import type { ReleaseTimelineEntry } from "./release-history";

const { loadReleaseReads, acknowledgeReleaseReads } = vi.hoisted(() => ({
  loadReleaseReads: vi.fn(), acknowledgeReleaseReads: vi.fn(),
}));
vi.mock("./workspace-api", () => ({ loadReleaseReads, acknowledgeReleaseReads }));
import { AccountReleaseUpdates } from "./AccountReleaseUpdates";

const entries: readonly ReleaseTimelineEntry[] = [
  { id: "update:new", version: "2.0.11", date: "2026-10-23", title: "Новая версия", items: ["Новый пункт"] },
  { id: "update:old", version: "2.0.10", title: "Предыдущая версия", items: ["Старый пункт"] },
];
function tree(token = "employee-a") {
  return <FluentProvider theme={workspaceTheme}><AccountReleaseUpdates key={token} token={token} entries={entries} /></FluentProvider>;
}
const dialog = () => screen.findByRole("dialog", { name: "Что изменилось в Workspace" });

describe("AccountReleaseUpdates", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    loadReleaseReads.mockResolvedValue({ readEntryIds: [] });
    acknowledgeReleaseReads.mockResolvedValue({ readEntryIds: entries.map(value => value.id) });
  });
  afterEach(cleanup);

  it("shows all missed versions on first use, not only the latest, and viewing does not acknowledge", async () => {
    render(tree());
    expect(await dialog()).toHaveTextContent("Отметки в аккаунте ещё нет");
    expect(screen.getByText("Новый пункт")).toBeInTheDocument();
    expect(screen.getByText("Старый пункт")).toBeInTheDocument();
    expect(acknowledgeReleaseReads).not.toHaveBeenCalled();
  });
  it("shows only unread bundled entries and saves explicitly to the current account", async () => {
    loadReleaseReads.mockResolvedValue({ readEntryIds: ["update:old", "update:future"] });
    render(tree());
    await dialog();
    expect(screen.queryByText("Старый пункт")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ознакомился" }));
    await waitFor(() => expect(acknowledgeReleaseReads).toHaveBeenCalledWith("employee-a", { entryIds: ["update:new"] }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("dismisses only for this session; neither Later nor Escape saves receipts", async () => {
    const first = render(tree());
    await dialog();
    fireEvent.click(screen.getByRole("button", { name: "Позже" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    first.unmount();
    render(tree());
    const surface = await dialog();
    fireEvent.keyDown(surface, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(acknowledgeReleaseReads).not.toHaveBeenCalled();
  });
  it("does not share receipts between accounts, but a new device reads the saved account state", async () => {
    loadReleaseReads.mockImplementation(async (token: string) => ({ readEntryIds: token === "employee-a" ? entries.map(value => value.id) : [] }));
    const view = render(tree());
    await waitFor(() => expect(loadReleaseReads).toHaveBeenCalledWith("employee-a"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(tree("employee-b"));
    expect(await dialog()).toHaveTextContent("Старый пункт");
    view.rerender(tree("employee-a"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("keeps unread history on save error and supports retry without double submission", async () => {
    acknowledgeReleaseReads.mockRejectedValueOnce(new Error("offline"));
    render(tree());
    await dialog();
    fireEvent.click(screen.getByRole("button", { name: "Ознакомился" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохраняем отметку…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось сохранить");
    expect(acknowledgeReleaseReads).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Старый пункт")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ознакомился" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(acknowledgeReleaseReads).toHaveBeenCalledTimes(2);
  });
  it("never treats a failed load as empty account state and can retry", async () => {
    loadReleaseReads.mockRejectedValueOnce(new Error("offline"));
    render(tree());
    fireEvent.click(await screen.findByRole("button", { name: "Повторить проверку" }));
    expect(await dialog()).toBeInTheDocument();
    expect(acknowledgeReleaseReads).not.toHaveBeenCalled();
  });
  it("defers to another modal and shows history once it is closed", async () => {
    const other = document.createElement("div");
    other.setAttribute("role", "dialog"); other.setAttribute("aria-modal", "true");
    document.body.append(other);
    try {
      render(tree());
      await waitFor(() => expect(loadReleaseReads).toHaveBeenCalled());
      expect(screen.queryByRole("dialog", { name: "Что изменилось в Workspace" })).not.toBeInTheDocument();
      other.remove();
      expect(await dialog()).toBeInTheDocument();
    } finally { other.remove(); }
  });
  it("refreshes another device's acknowledgement on focus without writing it again", async () => {
    render(tree());
    await dialog();
    loadReleaseReads.mockResolvedValue({ readEntryIds: entries.map(value => value.id) });
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(acknowledgeReleaseReads).not.toHaveBeenCalled();
  });
  it("does not let a stale in-flight GET erase a successful acknowledgement", async () => {
    let finishRead: ((value: { readEntryIds: string[] }) => void) | undefined;
    render(tree());
    await dialog();
    loadReleaseReads.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    fireEvent.focus(window);
    fireEvent.click(screen.getByRole("button", { name: "Ознакомился" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await act(async () => { finishRead?.({ readEntryIds: [] }); });
    await waitFor(() => expect(loadReleaseReads).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
