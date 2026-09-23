import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkdayMe, WorkdayTeam } from "@yuksalish/contracts";

import { TeamPresencePanel } from "./TeamPresencePanel";
import { WorkdayControl } from "./WorkdayControl";
import { finishMyWorkday, loadMyWorkday, loadTeamWorkday, startMyWorkday } from "./workspace-api";
import { workspaceTheme } from "./workspace-theme";

vi.mock("./workspace-api", () => ({
  loadMyWorkday: vi.fn(), startMyWorkday: vi.fn(), finishMyWorkday: vi.fn(),
  loadTeamWorkday: vi.fn(), saveWorkdaySchedule: vi.fn(),
}));

const initial: WorkdayMe = {
  status: "not_started",
  schedule: { userId: "employee", startsAt: "09:00:00", endsAt: "18:00:00" },
  session: null,
  absenceKind: null,
  asOf: "2026-09-23T04:00:00Z",
};
const working: WorkdayMe = {
  ...initial,
  status: "working",
  session: {
    id: "session", userId: "employee", workDate: "2026-09-23",
    startedAt: "2026-09-23T04:00:00Z", endedAt: null,
    scheduledStartAt: "2026-09-23T04:00:00Z",
    scheduledEndAt: "2026-09-23T13:00:00Z",
    closedAt: null, closeSource: null, isWeekend: false,
  },
};

function show(element: ReactNode) {
  return render(<FluentProvider theme={workspaceTheme}>{element}</FluentProvider>);
}

describe("workday presence", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("starts and finishes only on explicit button clicks", async () => {
    vi.mocked(loadMyWorkday).mockResolvedValue(initial);
    vi.mocked(startMyWorkday).mockResolvedValue(working);
    vi.mocked(finishMyWorkday).mockResolvedValue({
      ...working, status: "finished",
      session: { ...working.session!, endedAt: "2026-09-23T13:00:00Z", closedAt: "2026-09-23T13:00:00Z", closeSource: "manual" },
    });
    show(<WorkdayControl token="test-token" />);
    fireEvent.click(await screen.findByRole("button", { name: "Начать работу" }));
    await screen.findByRole("button", { name: "Завершить работу" });
    expect(startMyWorkday).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Завершить работу" }));
    await screen.findByRole("button", { name: "Начать снова" });
    expect(finishMyWorkday).toHaveBeenCalledTimes(1);
  });

  it("does not offer a start button during approved absence", async () => {
    vi.mocked(loadMyWorkday).mockResolvedValue({ ...initial, status: "approved_absence", absenceKind: "sick_leave" });
    show(<WorkdayControl token="test-token" />);
    expect(await screen.findByText("Отсутствие оформлено")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Начать работу" })).not.toBeInTheDocument();
  });

  it("keeps the start action available after a failed request", async () => {
    vi.mocked(loadMyWorkday).mockResolvedValue(initial);
    vi.mocked(startMyWorkday).mockRejectedValue(new Error("Сервис временно недоступен"));
    show(<WorkdayControl token="test-token" />);
    fireEvent.click(await screen.findByRole("button", { name: "Начать работу" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ошибка · повторить");
    expect(screen.getByRole("button", { name: "Начать работу" })).toBeEnabled();
  });

  it("shows only checked-in people in the working count, with absence separate", async () => {
    const team: WorkdayTeam = {
      asOf: "2026-09-23T08:00:00Z", workingCount: 1,
      members: [
        { userId: "employee", name: "Дилшод Рахимов", jobTitle: "Специалист", status: "working", schedule: initial.schedule, session: working.session, absenceKind: null, canEditSchedule: false },
        { userId: "absent", name: "Малика Нурова", jobTitle: null, status: "approved_absence", schedule: initial.schedule, session: null, absenceKind: "sick_leave", canEditSchedule: false },
      ],
    };
    vi.mocked(loadTeamWorkday).mockResolvedValue(team);
    show(<TeamPresencePanel token="test-token" />);
    await screen.findByText("Дилшод Рахимов");
    expect(screen.getByText("На больничном")).toBeInTheDocument();
    expect(screen.getByText("из 2 работают")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Сейчас работают" }));
    await waitFor(() => expect(screen.queryByText("Малика Нурова")).not.toBeInTheDocument());
  });
});
