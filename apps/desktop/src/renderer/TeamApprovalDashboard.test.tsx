import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TeamDashboardView } from "./TeamDashboardView";
import { workspaceTheme } from "./workspace-theme";

const inbox = vi.hoisted(() => ({ use: vi.fn(), refresh: vi.fn() }));
vi.mock("./TeamPresencePanel", () => ({ TeamPresencePanel: () => null }));
vi.mock("./useTeamApprovalInbox", () => ({ useTeamApprovalInbox: inbox.use }));
const selectTrip = vi.fn();
const selectLeave = vi.fn();
function show(enabled = true) {
  render(<FluentProvider theme={workspaceTheme}><TeamDashboardView token="token" tasks={[]} people={[]}
    currentUserId="deputy" efficiencyLoading={false} onSelectTask={vi.fn()}
    onSelectTrip={enabled ? selectTrip : undefined} onSelectLeave={enabled ? selectLeave : undefined} /></FluentProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  inbox.use.mockImplementation((_token: string, _user: string, kind: string, enabled: boolean) => ({
    visible: enabled, loading: false, refresh: inbox.refresh,
    items: [{ id: kind, title: kind === "trips" ? "Встреча в Самарканде" : "Заявление на отпуск", requesterName: "Тестовый сотрудник", startsOn: "2026-11-01", endsOn: "2026-11-10" }],
  }));
});
afterEach(cleanup);

it("shows two independent counters, opens separate windows and navigates to the exact request", async () => {
  show();
  const trips = screen.getByRole("button", { name: /Поездки на согласование/ });
  expect(within(trips).getByText("1")).toBeInTheDocument();
  fireEvent.click(trips);
  const dialog = await screen.findByRole("dialog", { name: "Поездки на вашем согласовании" });
  expect(within(dialog).queryByText("Заявление на отпуск")).not.toBeInTheDocument();
  expect(within(dialog).getByText(/01.11.2026 — 10.11.2026/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: /Встреча в Самарканде/ }));
  expect(selectTrip).toHaveBeenCalledWith("trips");
  fireEvent.click(screen.getByRole("button", { name: /Отпуска на согласование/ }));
  const leaves = await screen.findByRole("dialog", { name: "Отпуска на вашем согласовании" });
  fireEvent.click(within(leaves).getByRole("button", { name: /Заявление на отпуск/ }));
  expect(selectLeave).toHaveBeenCalledWith("leaves");
});

it("hides unavailable queues, displays unknown counts on failure and allows retry", async () => {
  show(false);
  expect(screen.queryByRole("button", { name: /Поездки на согласование/ })).not.toBeInTheDocument();
  cleanup();
  inbox.use.mockReturnValue({ visible: true, loading: false, error: "Нет связи", refresh: inbox.refresh });
  show();
  const trips = screen.getByRole("button", { name: /Поездки на согласование/ });
  expect(within(trips).getByText("—")).toBeInTheDocument();
  fireEvent.click(trips);
  const dialog = await screen.findByRole("dialog", { name: "Поездки на вашем согласовании" });
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Нет связи");
  fireEvent.click(within(dialog).getByRole("button", { name: "Повторить загрузку" }));
  expect(inbox.refresh).toHaveBeenCalledOnce();
});

it("explains an empty inbox without showing an error", async () => {
  inbox.use.mockReturnValue({ visible: true, loading: false, items: [], refresh: inbox.refresh });
  show();
  fireEvent.click(screen.getByRole("button", { name: /Отпуска на согласование/ }));
  const dialog = await screen.findByRole("dialog", { name: "Отпуска на вашем согласовании" });
  expect(within(dialog).getByText("Заявок, ожидающих вашего согласования, нет.")).toBeInTheDocument();
  expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
});
