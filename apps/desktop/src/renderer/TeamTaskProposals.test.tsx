import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskProposal, WorkspacePerson } from "@yuksalish/contracts";
import { TeamDashboardView } from "./TeamDashboardView";
import { workspaceTheme } from "./workspace-theme";
import { loadTaskProposals } from "./workspace-api";

vi.mock("./TeamPresencePanel", () => ({ TeamPresencePanel: () => <div /> }));
vi.mock("./workspace-api", () => ({ loadTaskProposals: vi.fn() }));

const people: readonly WorkspacePerson[] = [
  { id: "manager", name: "Азиза Каримова", initials: "АК", role: "manager", color: "#0f6cbd" },
  { id: "employee", name: "Дилшод Рахимов", initials: "ДР", role: "employee", color: "#107c10" },
];
const proposal: TaskProposal = {
  id: "request-1", creatorUserId: "employee", authorUserId: "manager", status: "pending",
  task: { title: "Подготовить отчёт", assigneeId: "employee", dueAt: "2026-10-22T09:00:00Z" },
  taskId: null, reason: "", createdAt: "2026-10-19T09:00:00Z", decidedAt: null,
};

const dashboard = (onSelectTaskProposal: ((id: string) => void) | undefined = vi.fn()) =>
  <FluentProvider theme={workspaceTheme}><TeamDashboardView token="test-token" tasks={[]} people={people} currentUserId="manager" efficiencyLoading={false} onSelectTask={vi.fn()} onSelectTaskProposal={onSelectTaskProposal} /></FluentProvider>;

describe("team task proposal inbox", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(loadTaskProposals).mockReset().mockResolvedValue([proposal]); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("counts only incoming requests and opens their existing approval card", async () => {
    const onSelect = vi.fn();
    vi.mocked(loadTaskProposals).mockResolvedValue([proposal, { ...proposal, id: "outgoing", creatorUserId: "manager", authorUserId: "employee" }, { ...proposal, id: "approved", status: "approved" }]);
    await act(async () => { render(dashboard(onSelect)); });
    const tile = screen.getByRole("button", { name: /Постановка задач/ });
    expect(tile).toHaveTextContent("1");
    fireEvent.click(tile);
    const dialog = screen.getByRole("dialog", { name: "Запросы на постановку задач" });
    expect(within(dialog).getByText("Подготовить отчёт")).toBeInTheDocument();
    expect(within(dialog).getByText(/Дилшод Рахимов/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Подготовить отчёт/ }));
    expect(onSelect).toHaveBeenCalledWith("request-1");
  });

  it("shows fetch errors without pretending the inbox is empty and supports retry", async () => {
    vi.mocked(loadTaskProposals).mockRejectedValueOnce(new Error("Сервис недоступен"));
    await act(async () => { render(dashboard()); });
    const tile = screen.getByRole("button", { name: /Постановка задач/ });
    expect(tile).toHaveTextContent("—");
    fireEvent.click(tile);
    const dialog = screen.getByRole("dialog", { name: "Запросы на постановку задач" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Сервис недоступен");
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Повторить загрузку" })); });
    expect(within(dialog).getByText("Подготовить отчёт")).toBeInTheDocument();
  });

  it("does not load proposals when this navigation action is unavailable", async () => {
    await act(async () => { render(<FluentProvider theme={workspaceTheme}><TeamDashboardView token="test-token" tasks={[]} people={people} currentUserId="manager" efficiencyLoading={false} onSelectTask={vi.fn()} /></FluentProvider>); });
    expect(screen.queryByRole("button", { name: /Постановка задач/ })).not.toBeInTheDocument();
    expect(loadTaskProposals).not.toHaveBeenCalled();
  });
});
