import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdoEmployeeSync } from "./EdoEmployeeSync";
import { workspaceTheme } from "./workspace-theme";
import { loadEdoEmployeeSync, retryEdoEmployeeSync } from "./workspace-api";

vi.mock("./workspace-api", () => ({ loadEdoEmployeeSync: vi.fn(), retryEdoEmployeeSync: vi.fn() }));
const status = {
  enabled: true, configured: true, entries: [{
    userId: "synthetic", name: "Тестовый сотрудник", status: "retry" as const,
    revision: 1, deliveredRevision: 0, edoUserId: null, attempts: 2,
    lastErrorCode: "http_503", lastSyncedAt: null,
  }],
};
function show() {
  render(<FluentProvider theme={workspaceTheme}><EdoEmployeeSync token="synthetic" /></FluentProvider>);
  const details = screen.getByText("Синхронизация сотрудников с ЭДО").parentElement!;
  details.setAttribute("open", ""); fireEvent(details, new Event("toggle"));
}
describe("employee directory sync status", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadEdoEmployeeSync).mockResolvedValue(status); });
  afterEach(cleanup);
  it("loads only when opened and does not send an automatic retry", async () => {
    render(<FluentProvider theme={workspaceTheme}><EdoEmployeeSync token="synthetic" /></FluentProvider>);
    expect(loadEdoEmployeeSync).not.toHaveBeenCalled();
    const details = screen.getByText("Синхронизация сотрудников с ЭДО").parentElement!;
    details.setAttribute("open", ""); fireEvent(details, new Event("toggle"));
    expect(await screen.findByText(/Тестовый сотрудник — Ожидает повтора/)).toBeVisible();
    expect(retryEdoEmployeeSync).not.toHaveBeenCalled();
  });
  it("queues retry but does not claim delivery success", async () => {
    vi.mocked(retryEdoEmployeeSync).mockResolvedValue(undefined);
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Повторить синхронизацию: Тестовый сотрудник" }));
    expect(await screen.findByRole("status")).toHaveTextContent("ещё не подтверждение синхронизации");
    expect(retryEdoEmployeeSync).toHaveBeenCalledWith("synthetic", "synthetic");
    await waitFor(() => expect(loadEdoEmployeeSync).toHaveBeenCalledTimes(2));
  });
  it("keeps employee status on failure and allows retry", async () => {
    vi.mocked(retryEdoEmployeeSync).mockRejectedValue(new Error("Нет связи"));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Повторить синхронизацию: Тестовый сотрудник" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Нет связи");
    expect(screen.getByText(/Тестовый сотрудник — Ожидает повтора/)).toBeVisible();
  });
  it("does not allow retry while synchronization is disabled", async () => {
    vi.mocked(loadEdoEmployeeSync).mockResolvedValue({ ...status, enabled: false });
    show();
    expect(await screen.findByText("Автоматическая синхронизация выключена.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Повторить синхронизацию: Тестовый сотрудник" })).toBeDisabled();
  });
});
