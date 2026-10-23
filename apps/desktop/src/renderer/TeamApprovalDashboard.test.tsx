import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  return render(<FluentProvider theme={workspaceTheme}><TeamDashboardView token="token" tasks={[]} people={[]}
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

it("cancels a queued card transition when the source page unmounts", async () => {
  const { unmount } = show();
  fireEvent.click(screen.getByRole("button", { name: /Поездки на согласование/ }));
  const dialog = await screen.findByRole("dialog", { name: "Поездки на вашем согласовании" });
  fireEvent.click(within(dialog).getByRole("button", { name: /Встреча в Самарканде/ }));
  unmount();
  await act(async () => { await new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))); });
  expect(selectTrip).not.toHaveBeenCalled();
});

it.each(["trips", "leaves"] as const)("opens the %s queue and navigates to the exact request", async (kind) => {
  show();
  const metric = screen.getByRole("button", { name: kind === "trips" ? /Поездки на согласование/ : /Отпуска на согласование/ });
  expect(within(metric).getByText("1")).toBeInTheDocument();
  fireEvent.click(metric);
  const dialog = await screen.findByRole("dialog", { name: kind === "trips" ? "Поездки на вашем согласовании" : "Отпуска на вашем согласовании" });
  expect(within(dialog).queryByText(kind === "trips" ? "Заявление на отпуск" : "Встреча в Самарканде")).not.toBeInTheDocument();
  expect(within(dialog).getByText(/01.11.2026 — 10.11.2026/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: kind === "trips" ? /Встреча в Самарканде/ : /Заявление на отпуск/ }));
  await waitFor(() => expect(kind === "trips" ? selectTrip : selectLeave).toHaveBeenCalledWith(kind));
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
