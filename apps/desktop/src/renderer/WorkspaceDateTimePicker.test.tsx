import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";
import { WorkspaceFileDropzone } from "./WorkspaceFileDropzone";

describe("workspace date and file inputs", () => {
  afterEach(cleanup);

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
