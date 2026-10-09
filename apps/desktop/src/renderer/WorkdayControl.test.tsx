import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkdayMe, WorkdayTeam } from "@yuksalish/contracts";

import { TeamPresencePanel } from "./TeamPresencePanel";
import { WorkdayControl } from "./WorkdayControl";
import { finishMyWorkday, loadMyWorkday, loadProfileAvatar, loadTeamWorkday, startMyWorkday } from "./workspace-api";
import { workspaceTheme } from "./workspace-theme";

vi.mock("./workspace-api", () => ({
  loadMyWorkday: vi.fn(), startMyWorkday: vi.fn(), finishMyWorkday: vi.fn(),
  loadTeamWorkday: vi.fn(), saveWorkdaySchedule: vi.fn(),
  loadProfileAvatar: vi.fn(),
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
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("loads the team member photo from the version supplied by the team API", async () => {
    vi.mocked(loadProfileAvatar).mockResolvedValue(new Blob(["photo"], { type: "image/png" }));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:workday-avatar");
    vi.mocked(loadTeamWorkday).mockResolvedValue({ asOf: initial.asOf, workingCount: 1, members: [
      { userId: "presence-photo", name: "Дилшод Рахимов", avatarVersion: "photo-v1", jobTitle: "Специалист", status: "working", schedule: initial.schedule, session: working.session, absenceKind: null, canEditSchedule: false },
    ] });
    const view = show(<TeamPresencePanel token="test-token" />);
    await waitFor(() => expect(view.container.querySelector(".team-presence-person .fui-Avatar__image")).toHaveAttribute("src", "blob:workday-avatar"));
    expect(loadProfileAvatar).toHaveBeenCalledWith("test-token", "presence-photo", "photo-v1");
  });

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
    expect(screen.getByRole("button", { name: "Сейчас работают" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Малика Нурова")).not.toBeInTheDocument();
    expect(screen.getByText("из 2 работают")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Вся команда" }));
    await waitFor(() => expect(screen.getByText("Малика Нурова")).toBeInTheDocument());
    expect(screen.getByText("На больничном")).toBeInTheDocument();
  });
  it("keeps complete long roles and an action cell even without schedule permission", async () => {
    vi.mocked(loadTeamWorkday).mockResolvedValue({ asOf: initial.asOf, workingCount: 0, members: [
      { userId: "long", name: "Малика Нурова", jobTitle: "Председатель движения и руководитель региональных подразделений", status: "finished", schedule: initial.schedule,
        session: { ...working.session!, endedAt: "2026-09-23T13:00:00Z", isWeekend: true }, absenceKind: null, canEditSchedule: false },
      { userId: "short", name: "Азиза Каримова", jobTitle: "Бухгалтер", status: "weekend_off", schedule: initial.schedule, session: null, absenceKind: null, canEditSchedule: true },
    ] });
    const view = show(<TeamPresencePanel token="test-token" />);
    await screen.findByText("Сейчас никто не начал рабочий день.");
    fireEvent.click(screen.getByRole("button", { name: "Вся команда" }));
    expect(screen.getByText("Председатель движения и руководитель региональных подразделений")).toBeInTheDocument();
    expect(screen.getByText("Завершил работу")).toBeInTheDocument();
    expect(screen.getByText("Работа в выходной")).toBeInTheDocument();
    expect(view.container.querySelectorAll(".team-presence-actions")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "График" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Сейчас работают" }));
    expect(screen.getByText("Сейчас никто не начал рабочий день.")).toBeInTheDocument();
    expect(screen.queryByText("Малика Нурова")).not.toBeInTheDocument();
  });
  it("shows refresh failure without discarding the last successful team list", async () => {
    vi.mocked(loadTeamWorkday).mockResolvedValueOnce({ asOf: initial.asOf, workingCount: 1, members: [
      { userId: "employee", name: "Дилшод Рахимов", jobTitle: "Специалист", status: "working", schedule: initial.schedule, session: working.session, absenceKind: null, canEditSchedule: false },
    ] }).mockRejectedValueOnce(new Error("Сервис временно недоступен"));
    show(<TeamPresencePanel token="test-token" />);
    await screen.findByText("Дилшод Рахимов");
    fireEvent.click(screen.getByRole("button", { name: "Обновить отметки" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сервис временно недоступен");
    expect(screen.getByText("Дилшод Рахимов")).toBeInTheDocument();
  });
});
