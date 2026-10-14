import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";
import { WorkspaceFileDropzone } from "./WorkspaceFileDropzone";
import * as timeMotion from "./time-wheel-motion";

describe("workspace date and file inputs", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("uses a compact numeric date only when requested, keeping the full date elsewhere", () => {
    render(<><WorkspaceDateTimePicker mode="date" dateFormat="numeric" ariaLabel="Перейти к дате" value="2026-09-04" onChange={vi.fn()} />
      <WorkspaceDateTimePicker mode="date" ariaLabel="Дата события" value="2026-09-04" onChange={vi.fn()} /></>);
    expect(screen.getByRole("button", { name: "Перейти к дате: открыть выбор" })).toHaveTextContent("04.09.2026");
    expect(screen.getByRole("button", { name: "Дата события: открыть выбор" })).toHaveTextContent("04 сентября 2026");
  });

  it("routes a latched wheel event by cursor position and preserves the other value", () => {
    const createMotion = timeMotion.createTimeWheelMotion;
    const scrolls = new Map<string, ReturnType<typeof vi.fn>>();
    vi.spyOn(timeMotion, "createTimeWheelMotion").mockImplementation((wheel, reduced) => {
      const motion = createMotion(wheel, reduced);
      const moveTo = vi.fn(motion.moveTo);
      scrolls.set(wheel.dataset.wheel!, moveTo);
      return { ...motion, moveTo };
    });
    function Controlled() {
      const [value, setValue] = useState("14:10");
      return <WorkspaceDateTimePicker ariaLabel="Время" mode="time" value={value} onChange={setValue} />;
    }
    render(<Controlled />);
    fireEvent.click(screen.getByRole("button", { name: "Время: открыть выбор" }));
    const hours = screen.getByRole("listbox", { name: "Часы" });
    const minutes = screen.getByRole("listbox", { name: "Минуты" });
    const hourScroll = scrolls.get("hour")!, minuteScroll = scrolls.get("minute")!;
    hourScroll.mockClear(); minuteScroll.mockClear();
    const originalHitTest = document.elementFromPoint;
    const hitTest = vi.fn().mockReturnValue(minutes);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hitTest });
    try {
      fireEvent.wheel(minutes, { deltaY: 34 });
      expect(screen.getByRole("button", { name: "Время: открыть выбор" })).toHaveTextContent("14:11");
      expect(minuteScroll).toHaveBeenCalledWith(374, false);
      expect(hourScroll).not.toHaveBeenCalled();
      // Chromium still dispatches to minutes while the cursor is over hours.
      hitTest.mockReturnValue(hours);
      fireEvent.wheel(minutes, { deltaY: 34, clientX: 10, clientY: 10 });
      expect(screen.getByRole("button", { name: "Время: открыть выбор" })).toHaveTextContent("15:11");
      expect(hourScroll).toHaveBeenCalledWith(510, false);
      expect(minuteScroll).toHaveBeenCalledTimes(1);
      hitTest.mockReturnValue(minutes);
      fireEvent.wheel(hours, { deltaY: -34 });
      expect(screen.getByRole("button", { name: "Время: открыть выбор" })).toHaveTextContent("15:10");
      hitTest.mockReturnValue(hours);
      fireEvent.wheel(minutes, { deltaY: -34 });
      expect(screen.getByRole("button", { name: "Время: открыть выбор" })).toHaveTextContent("14:10");
      fireEvent.wheel(hours, { deltaY: -34, ctrlKey: true });
      expect(screen.getByRole("button", { name: "Время: открыть выбор" })).toHaveTextContent("14:10");
      vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
      fireEvent.wheel(hours, { deltaY: 34 });
      expect(hourScroll).toHaveBeenLastCalledWith(510, true);
    } finally {
      Object.defineProperty(document, "elementFromPoint", { configurable: true, value: originalHitTest });
    }
  });

  it("advances one step per coarse mouse notch for both hours and minutes", () => {
    function Controlled() {
      const [value, setValue] = useState("09:10");
      return <WorkspaceDateTimePicker ariaLabel="Время" mode="time" value={value} onChange={setValue} />;
    }
    render(<Controlled />);
    const trigger = screen.getByRole("button", { name: "Время: открыть выбор" });
    fireEvent.click(trigger);
    const hours = screen.getByRole("listbox", { name: "Часы" });
    const minutes = screen.getByRole("listbox", { name: "Минуты" });
    fireEvent.wheel(hours, { deltaY: 100 });
    expect(trigger).toHaveTextContent("10:10");
    fireEvent.wheel(hours, { deltaY: 120 });
    expect(trigger).toHaveTextContent("11:10");
    fireEvent.wheel(hours, { deltaY: -120 });
    expect(trigger).toHaveTextContent("10:10");
    fireEvent.wheel(minutes, { deltaY: 100 });
    expect(trigger).toHaveTextContent("10:11");
    fireEvent.wheel(minutes, { deltaY: -120 });
    expect(trigger).toHaveTextContent("10:10");
    fireEvent.wheel(hours, { deltaY: 3, deltaMode: 1 });
    expect(trigger).toHaveTextContent("11:10");
    fireEvent.wheel(minutes, { deltaY: 1, deltaMode: 2 });
    expect(trigger).toHaveTextContent("11:11");
  });

  it("accumulates fine wheel deltas, respects bounds and retains PM in 12-hour mode", () => {
    const change = vi.fn();
    render(<WorkspaceDateTimePicker ariaLabel="Время" mode="time" value="23:59" onChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "Время: открыть выбор" }));
    const hours = screen.getByRole("listbox", { name: "Часы" });
    fireEvent.wheel(hours, { deltaY: 34 });
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "12" }));
    fireEvent.wheel(hours, { deltaY: -17 });
    expect(change).not.toHaveBeenCalled();
    fireEvent.wheel(hours, { deltaY: -17 });
    expect(change).toHaveBeenCalledWith("22:59");
  });

  it("opens the shared calendar and uses 24-hour time by default", () => {
    const change = vi.fn();
    render(<WorkspaceDateTimePicker ariaLabel="Срок" value="2026-09-27T09:15" onChange={change} />);

    fireEvent.click(screen.getByRole("button", { name: "Срок: открыть выбор" }));
    expect(screen.getByRole("group", { name: "Формат времени" })).toBeVisible();
    expect(screen.getByRole("button", { name: "24" })).toHaveAttribute("aria-pressed", "true");

    const minutes = screen.getByRole("listbox", { name: "Минуты" });
    fireEvent.click(within(minutes).getByRole("option", { name: "30" }));
    expect(change).toHaveBeenCalledWith("2026-09-27T09:30");
  });

  it("switches compactly to a 12-hour wheel", () => {
    render(<WorkspaceDateTimePicker ariaLabel="Время" mode="time" value="15:00" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Время: открыть выбор" }));
    fireEvent.click(screen.getByRole("button", { name: "12" }));
    expect(screen.getByRole("button", { name: "12" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "Половина дня" })).toBeVisible();
    const dials = screen.getByRole("listbox", { name: "Часы" }).closest(".ws-time-dials");
    expect(dials).toContainElement(screen.getByRole("listbox", { name: "Минуты" }));
    expect(dials).not.toContainElement(screen.getByRole("group", { name: "Половина дня" }));
  });

  it("returns the visible calendar to today before selecting the date", () => {
    const change = vi.fn();
    render(<WorkspaceDateTimePicker ariaLabel="Срок" value="2024-01-15T09:00" onChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "Срок: открыть выбор" }));
    fireEvent.click(screen.getByRole("button", { name: "Сегодня" }));
    const today = new Date();
    expect(screen.getByText(`${["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"][today.getMonth()]} ${today.getFullYear()}`)).toBeVisible();
    expect(change).toHaveBeenCalledWith(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}T09:00`);
  });

  it("selects the exact clicked digit without capturing a click as a drag", () => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: MouseEventInit & { pointerId?: number }) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    const capture = vi.fn();
    Element.prototype.setPointerCapture = capture;
    const change = vi.fn();
    function Controlled() {
      const [value, setValue] = useState("09:10");
      return <WorkspaceDateTimePicker ariaLabel="Время" mode="time" value={value} onChange={next => { change(next); setValue(next); }} />;
    }
    render(<Controlled />);
    fireEvent.click(screen.getByRole("button", { name: "Время: открыть выбор" }));
    const hours = screen.getByRole("listbox", { name: "Часы" });
    const minutes = screen.getByRole("listbox", { name: "Минуты" });
    const clickDigit = (wheel: HTMLElement, digit: string) => {
      const option = within(wheel).getByRole("option", { name: digit });
      fireEvent.pointerDown(option, { button: 0, pointerId: 1, clientY: 100 });
      fireEvent.pointerMove(option, { pointerId: 1, clientY: 102 });
      fireEvent.pointerUp(option, { pointerId: 1, clientY: 102 });
      fireEvent.click(option);
    };
    clickDigit(hours, "10");
    expect(change).toHaveBeenLastCalledWith("10:10");
    clickDigit(hours, "23");
    expect(change).toHaveBeenLastCalledWith("23:10");
    clickDigit(minutes, "57");
    expect(change).toHaveBeenLastCalledWith("23:57");
    clickDigit(hours, "03");
    expect(change).toHaveBeenLastCalledWith("03:57");
    fireEvent.click(screen.getByRole("button", { name: "12" }));
    fireEvent.click(screen.getByRole("button", { name: "PM" }));
    clickDigit(hours, "11");
    expect(change).toHaveBeenLastCalledWith("23:57");
    expect(capture).not.toHaveBeenCalled();
    expect(change).toHaveBeenCalledTimes(6);
  });

  it("selects time by dragging the minute wheel", () => {
    const change = vi.fn();
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: MouseEventInit & { pointerId?: number }) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    Element.prototype.setPointerCapture = vi.fn();
    render(<WorkspaceDateTimePicker ariaLabel="Время" mode="time" value="09:00" onChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "Время: открыть выбор" }));
    const wheel = screen.getByRole("listbox", { name: "Минуты" });
    fireEvent.pointerDown(wheel, { button: 0, pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(wheel, { pointerId: 1, clientY: 32 });
    expect(Element.prototype.setPointerCapture).toHaveBeenCalledWith(1);
    fireEvent.pointerUp(wheel, { pointerId: 1, clientY: 32 });
    expect(change).toHaveBeenCalledWith("09:02");
    vi.unstubAllGlobals();
  });

  it("accepts dropped files through the shared upload surface", () => {
    const onFiles = vi.fn();
    const file = new File(["document"], "proposal.docx");
    const { container } = render(<WorkspaceFileDropzone label="Документ" hint="DOCX" actionLabel="Выбрать" onFiles={onFiles} />);
    const zone = container.querySelector(".ws-file-dropzone");
    expect(zone).not.toBeNull();
    fireEvent.drop(zone!, { dataTransfer: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
  });
});
