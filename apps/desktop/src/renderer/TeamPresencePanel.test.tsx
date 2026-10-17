import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkdayTeam } from "@yuksalish/contracts";
import { TeamPresencePanel } from "./TeamPresencePanel";
import { workspaceTheme } from "./workspace-theme";
import { loadTeamWorkday } from "./workspace-api";

vi.mock("./workspace-api", () => ({ loadTeamWorkday: vi.fn(), saveWorkdaySchedule: vi.fn() }));

const schedule = { userId: "one", startsAt: "09:00:00", endsAt: "18:00:00" };
const team: WorkdayTeam = {
  asOf: "2026-10-17T09:00:00Z", workingCount: 1,
  members: [
    { userId: "one", name: "Азиза Каримова", jobTitle: "Специалист", status: "working", schedule, session: null, absenceKind: null, canEditSchedule: false },
    { userId: "two", name: "Дилшод Рахимов", jobTitle: "Специалист", status: "approved_absence", schedule, session: null, absenceKind: "vacation", canEditSchedule: false },
    { userId: "three", name: "Малика Нурова", jobTitle: "Специалист", status: "approved_absence", schedule, session: null, absenceKind: "trip", canEditSchedule: false },
  ],
};

describe("TeamPresencePanel", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("opens separate lists of employees on leave and on trips", async () => {
    vi.mocked(loadTeamWorkday).mockResolvedValue(team);
    render(<FluentProvider theme={workspaceTheme}><TeamPresencePanel token="test-token" /></FluentProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "1 в отпуске" })).toBeInTheDocument());
    expect(screen.getByText("Азиза Каримова")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1 в отпуске" }));
    expect(screen.getByText("Дилшод Рахимов")).toBeInTheDocument();
    expect(screen.queryByText("Азиза Каримова")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1 в поездке" }));
    expect(screen.getByText("Малика Нурова")).toBeInTheDocument();
    expect(screen.getByText("В поездке")).toBeInTheDocument();
  });
});
