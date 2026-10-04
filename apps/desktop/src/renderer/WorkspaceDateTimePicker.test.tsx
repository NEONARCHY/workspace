import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";
import { WorkspaceFileDropzone } from "./WorkspaceFileDropzone";

describe("workspace date and file inputs", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("routes a latched wheel event by cursor position and preserves the other value", () => {
    function Controlled() {
      const [value, setValue] = useState("14:10");
      return <WorkspaceDateTimePicker ariaLabel="Время" mode="time" value={value} onChange={setValue} />;
    }
    render(<Controlled />);
    fireEvent.click(screen.getByRole("button", { name: "Время: открыть выбор" }));
    const hours = screen.getByRole("listbox", { name: "Часы" });
    const minutes = screen.getByRole("listbox", { name: "Минуты" });
    const hourScroll = vi.fn(), minuteScroll = vi.fn();
    Object.defineProperty(hours, "scrollTo", { configurable: true, value: hourScroll });
    Object.defineProperty(minutes, "scrollTo", { configurable: true, value: minuteScroll });
    const originalHitTest = document.elementFromPoint;
    const hitTest = vi.fn().mockReturnValue(minutes);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hitTest });
    try {
      fireEvent.wheel(minutes, { deltaY: 34 });
      expect(screen.getByRole("button", { name: "Время: открыть выбор" })).toHaveTextContent("14:11");
      expect(minuteScroll).toHaveBeenCalledWith({ top: 374, behavior: "smooth" });
      expect(hourScroll).not.toHaveBeenCalled();
      // Chromium still dispatches to minutes while the cursor is over hours.
      hitTest.mockReturnValue(hours);
      fireEvent.wheel(minutes, { deltaY: 34, clientX: 10, clientY: 10 });
      expect(screen.getByRole("button", { name: "Время: открыть выбор" })).toHaveTextContent("15:11");
      expect(hourScroll).toHaveBeenCalledWith({ top: 510, behavior: "smooth" });
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
      expect(hourScroll).toHaveBeenLastCalledWith({ top: 510, behavior: "instant" });
    } finally {
      Object.defineProperty(document, "elementFromPoint", { configurable: true, value: originalHitTest });
    }
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
