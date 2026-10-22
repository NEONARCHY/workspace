import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TeamDashboardView } from "./TeamDashboardView";
import { workspaceTheme } from "./workspace-theme";

const inbox = vi.hoisted(() => ({ use: vi.fn(), refresh: vi.fn() }));
vi.mock("./TeamPresencePanel", () => ({ TeamPresencePanel: () => null }));
vi.mock("./useTeamGrantInbox", () => ({ useTeamGrantInbox: inbox.use }));
const pending = { id: "pending", title: "Новая инициатива", initiatorUserId: "initiator", dueAt: "2099-11-01T12:00:00Z" };
const reviewing = { ...pending, id: "result", title: "Готовая заявка" };
const select = vi.fn();
function show(enabled = true) {
  render(<FluentProvider theme={workspaceTheme}><TeamDashboardView token="token" tasks={[]} people={[]}
    currentUserId="chair" efficiencyLoading={false} onSelectTask={vi.fn()}
    onSelectGrant={enabled ? select : undefined} /></FluentProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  inbox.use.mockReturnValue({ launches: [pending], reviews: [reviewing], loading: false, refresh: inbox.refresh });
});
afterEach(cleanup);

it("opens separate launch and result windows from one split grant block", async () => {
  show();
  const group = screen.getByRole("group", { name: "Гранты: проверка и запуск" });
  expect(within(group).getAllByRole("button")).toHaveLength(2);
  fireEvent.click(within(group).getByRole("button", { name: /Запросы на постановку грантов/ }));
  const launch = await screen.findByRole("dialog", { name: "Запросы на запуск грантов" });
  expect(within(launch).queryByText(reviewing.title)).not.toBeInTheDocument();
  fireEvent.click(within(launch).getByRole("button", { name: /Новая инициатива/ }));
  expect(select).toHaveBeenCalledWith("pending");
  fireEvent.click(within(group).getByRole("button", { name: /Заявки на гранты/ }));
  const result = await screen.findByRole("dialog", { name: "Гранты на вашей проверке" });
  expect(within(result).queryByText(pending.title)).not.toBeInTheDocument();
  fireEvent.click(within(result).getByRole("button", { name: /Готовая заявка/ }));
  expect(select).toHaveBeenLastCalledWith("result");
});

it("does not display unavailable queues or replace a loading error with zero", async () => {
  show(false);
  expect(screen.queryByRole("group", { name: "Гранты: проверка и запуск" })).not.toBeInTheDocument();
  cleanup();
  inbox.use.mockReturnValue({ error: "Нет связи", loading: false, refresh: inbox.refresh });
  show();
  const launch = screen.getByRole("button", { name: /Запросы на постановку грантов/ });
  expect(within(launch).getByText("—")).toBeInTheDocument();
  fireEvent.click(launch);
  const dialog = await screen.findByRole("dialog", { name: "Запросы на запуск грантов" });
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Нет связи");
  fireEvent.click(within(dialog).getByRole("button", { name: "Повторить загрузку" }));
  expect(inbox.refresh).toHaveBeenCalledTimes(1);
});
