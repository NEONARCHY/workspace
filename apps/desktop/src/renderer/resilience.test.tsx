import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, WorkspaceTask } from "@yuksalish/contracts";
import { RecoveryBoundary } from "./RecoveryBoundary";
import { CalendarView } from "./CalendarView";
import { DecisionReason } from "./DecisionReason";
import { createRefreshQueue } from "./refresh-queue";
import { fitWindowBounds } from "../main/window-state";
import { loadWorkspace, subscribeToWorkspaceEvents } from "./workspace-api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("Window and UI recovery", () => {
  it("uses a nonblocking reason form and keeps the entered reason on failure", async () => {
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const cancel = vi.fn();
    render(<DecisionReason title="Причина решения" onConfirm={confirm} onCancel={cancel} />);
    expect(screen.getByRole("button", { name: "Подтвердить решение" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Причина решения" }), { target: { value: "Нужен документ" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить решение" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось сохранить");
    expect(screen.getByRole("textbox")).toHaveValue("Нужен документ");
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить решение" }));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  });
  it("recovers an erroring section without removing the navigation", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let broken = true;
    function Broken() { if (broken) throw new Error("synthetic render failure"); return <p>Рабочий экран</p>; }
    render(<><nav>Навигация</nav><RecoveryBoundary><Broken /></RecoveryBoundary></>);
    expect(screen.getByText("Навигация")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось показать экран");
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Открыть заново" }));
    expect(screen.getByText("Рабочий экран")).toBeInTheDocument();
  });

  it("clamps a moved window after a monitor disappears", () => {
    expect(fitWindowBounds({ x: 2400, y: -400, width: 1800, height: 1100 }, { x: 0, y: 0, width: 1366, height: 728 }))
      .toEqual({ x: 0, y: 0, width: 1366, height: 728 });
    expect(fitWindowBounds({ width: 100, height: 10 }, { x: -1280, y: 0, width: 1280, height: 720 }))
      .toEqual({ x: -960, y: 120, width: 640, height: 480 });
  });

  it("rejects empty calendar dates without leaving Save busy", async () => {
    const create = vi.fn();
    render(<CalendarView events={[]} people={[]} currentUserId="tester" onCreate={create} onUpdate={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Новое событие" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название события" }), { target: { value: "Проверка" } });
    fireEvent.change(screen.getByLabelText("Начало"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать мероприятие" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("корректные начало и окончание");
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Создать мероприятие" })).toBeEnabled();
  });

  it("keeps the event card and its fields after a server error", async () => {
    const create = vi.fn().mockRejectedValue(new Error("Сервер временно недоступен"));
    render(<CalendarView events={[]} people={[]} currentUserId="tester" onCreate={create} onUpdate={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Новое событие" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название события" }), { target: { value: "Совещание отдела" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать мероприятие" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Сервер временно недоступен");
    expect(screen.getByRole("dialog", { name: "Новое мероприятие" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Название события" })).toHaveValue("Совещание отдела");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("opens the complete agenda for a day instead of hiding events after the third item", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T08:00:00+05:00"));
    const events = Array.from({ length: 4 }, (_unused, index): CalendarEvent => ({
      id: `event-${index}`,
      organizerUserId: "tester",
      title: `Событие ${index + 1}`,
      description: "",
      eventType: "meeting",
      startsAt: `2026-09-10T0${index + 4}:00:00Z`,
      endsAt: `2026-09-10T0${index + 5}:00:00Z`,
      allDay: false,
      location: "",
      status: "scheduled",
      attendeeIds: ["tester"],
      attendees: [{ userId: "tester", status: "accepted", respondedAt: "2026-09-08T03:00:00Z" }],
      currentUserAttendanceStatus: "accepted",
      canRespond: false,
      canEdit: true,
      createdAt: "2026-09-08T03:00:00Z",
      updatedAt: "2026-09-08T03:00:00Z",
    }));
    render(<CalendarView events={events} people={[]} currentUserId="tester" onCreate={vi.fn()} onUpdate={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("gridcell", { name: /событий: 4/i }));
    const dayPanel = screen.getByLabelText("События выбранного дня");
    expect(within(dayPanel).getByText("Событие 4")).toBeInTheDocument();
    expect(within(dayPanel).getByText("4")).toBeInTheDocument();
  });

  it("shows meetings in the shared calendar and keeps linked tasks inside the event card", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T08:00:00+05:00"));
    const meeting: CalendarEvent = {
      id: "meeting-1", organizerUserId: "tester", title: "Планирование форума",
      description: "", eventType: "meeting", startsAt: "2026-09-10T05:00:00Z",
      endsAt: "2026-09-10T06:00:00Z", allDay: false, location: "",
      status: "scheduled", attendeeIds: ["tester"],
      attendees: [{ userId: "tester", status: "accepted", respondedAt: "2026-09-08T03:00:00Z" }],
      currentUserAttendanceStatus: "accepted", canRespond: false, canEdit: true,
      createdAt: "2026-09-08T03:00:00Z", updatedAt: "2026-09-08T03:00:00Z",
    };
    const legacyTaskEvent: CalendarEvent = {
      ...meeting, id: "old-task-event", title: "Старый календарный срок", eventType: "task",
    };
    const forum: CalendarEvent = {
      ...meeting, id: "forum-1", title: "Общий форум", eventType: "general",
    };
    const task: WorkspaceTask = {
      id: "task-1", title: "Подготовить материалы", project: "", authorId: "tester",
      assigneeId: "tester", dueLabel: "10 сентября", dueAt: "2026-09-10T04:00:00Z",
      calendarEventId: meeting.id, status: "new", priority: "normal",
      checklistDone: 0, checklistTotal: 0, participants: [], checklist: [], comments: [], dependencies: [],
    };
    render(<CalendarView events={[meeting, forum, legacyTaskEvent]} tasks={[task]} people={[]}
      currentUserId="tester" onCreate={vi.fn()} onUpdate={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("gridcell", { name: /событий: 2/i }));
    const dayPanel = screen.getByLabelText("События выбранного дня");
    expect(within(dayPanel).getByText("Общий форум")).toBeInTheDocument();
    expect(within(dayPanel).queryByText("Подготовить материалы")).not.toBeInTheDocument();
    expect(screen.queryByText("Старый календарный срок")).not.toBeInTheDocument();
    fireEvent.click(within(dayPanel).getByRole("button", { name: /Планирование форума/i }));
    expect(within(dayPanel).getByRole("button", { name: /Подготовить материалы/i })).toBeInTheDocument();
  });

  it("blocks backdated creation but keeps past events editable", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T08:00:00+05:00"));
    const pastEvent: CalendarEvent = {
      id: "past-event",
      organizerUserId: "tester",
      title: "Архивная встреча",
      description: "Итоги уже состоявшейся встречи",
      eventType: "meeting",
      startsAt: "2026-09-07T05:00:00Z",
      endsAt: "2026-09-07T06:00:00Z",
      allDay: false,
      location: "Переговорная",
      status: "scheduled",
      attendeeIds: ["tester"],
      attendees: [{ userId: "tester", status: "accepted", respondedAt: "2026-09-06T05:00:00Z" }],
      currentUserAttendanceStatus: "accepted",
      canRespond: false,
      canEdit: true,
      createdAt: "2026-09-06T05:00:00Z",
      updatedAt: "2026-09-06T05:00:00Z",
    };
    const update = vi.fn();
    render(<CalendarView events={[pastEvent]} people={[]} currentUserId="tester" onCreate={vi.fn()} onUpdate={update} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("gridcell", { name: /событий: 1/i }));
    const dayPanel = screen.getByLabelText("События выбранного дня");
    expect(within(dayPanel).getByText(/задним числом недоступны/i)).toBeInTheDocument();
    expect(within(dayPanel).queryByRole("button", { name: "Добавить" })).not.toBeInTheDocument();
    fireEvent.click(within(dayPanel).getByRole("button", { name: /Архивная встреча/i }));
    fireEvent.click(within(dayPanel).getByRole("button", { name: "Изменить" }));
    expect(within(dayPanel).getByRole("textbox", { name: "Название события" })).toHaveValue("Архивная встреча");
    expect(within(dayPanel).getByLabelText("Начало")).not.toHaveAttribute("min");

    fireEvent.click(within(dayPanel).getByRole("button", { name: "Закрыть форму" }));
    fireEvent.click(screen.getByRole("button", { name: "Новое событие" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название события" }), { target: { value: "Задним числом" } });
    fireEvent.change(screen.getByLabelText("Начало"), { target: { value: "2026-09-07T10:00" } });
    fireEvent.change(screen.getByLabelText("Окончание"), { target: { value: "2026-09-07T11:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать мероприятие" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Нельзя создавать новые события на прошедшие дни");
  });
});

describe("Background refresh", () => {
  it("coalesces a burst and performs a trailing refresh", async () => {
    const first = deferred<number>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(2);
    const apply = vi.fn();
    const refresh = createRefreshQueue(load, apply, () => "token");
    const pending = refresh("token");
    for (let i = 0; i < 50; i++) void refresh("token");
    expect(load).toHaveBeenCalledTimes(1);
    first.resolve(1);
    await pending;
    expect(load).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls).toEqual([[1], [2]]);
  });

  it("ignores a response from a signed-out account and allows retry after failure", async () => {
    let token: string | undefined = "old";
    const old = deferred<number>();
    const apply = vi.fn();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(3);
    const refresh = createRefreshQueue(load, apply, () => token);
    const pending = refresh("old");
    token = "new";
    old.resolve(1);
    await pending;
    expect(apply).not.toHaveBeenCalled();
    await expect(refresh("new")).rejects.toThrow("offline");
    await refresh("new");
    expect(apply).toHaveBeenCalledWith(3);
    token = undefined;
  });

  it("aborts a stalled API call instead of keeping the interface busy", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const pending = expect(loadWorkspace("test-token")).rejects.toThrow("не ответил вовремя");
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
  });

  it("contains malformed websocket events, batches updates and reconnects only while mounted", async () => {
    vi.useFakeTimers();
    class Socket extends EventTarget {
      static instances: Socket[] = [];
      send = vi.fn();
      close = vi.fn();
      constructor() { super(); Socket.instances.push(this); }
    }
    vi.stubGlobal("WebSocket", Socket);
    const update = vi.fn();
    const error = vi.fn();
    const stop = subscribeToWorkspaceEvents("test-token", update, error);
    const socket = Socket.instances[0]!;
    socket.dispatchEvent(new MessageEvent("message", { data: "invalid" }));
    expect(error).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 30; i++) socket.dispatchEvent(new MessageEvent("message", { data: '{"type":"changed"}' }));
    await vi.advanceTimersByTimeAsync(200);
    expect(update).toHaveBeenCalledTimes(1);
    socket.dispatchEvent(new CloseEvent("close", { code: 1006 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(Socket.instances).toHaveLength(2);
    stop();
    Socket.instances[1]!.dispatchEvent(new CloseEvent("close", { code: 1006 }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(Socket.instances).toHaveLength(2);
  });
});
