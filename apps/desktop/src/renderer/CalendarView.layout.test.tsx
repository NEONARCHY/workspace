import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarView } from "./CalendarView";
import { workspaceTheme } from "./workspace-theme";
import { sampleEvent } from "./test-fixtures/calendar-filter-data";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("reclaims the header and keeps every event in its day instead of a two-entry preview", () => {
  const events = Array.from({ length: 9 }, (_, index) => sampleEvent(`Полная запись ${index + 1}`));
  render(<FluentProvider theme={workspaceTheme} className="app-provider"><CalendarView events={events} people={[]} currentUserId="me"
    onCreate={vi.fn()} onUpdate={vi.fn()} onCancel={vi.fn()} /></FluentProvider>);
  expect(screen.queryByText("Рабочий календарь")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Календарь" })).not.toBeInTheDocument();
  expect(screen.queryByText("Встречи, мероприятия и Zoom")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Новое событие" }).closest(".calendar-filter-heading")).not.toBeNull();
  expect(screen.getByRole("button", { name: "Фильтры" })).toHaveAttribute("aria-expanded", "false");
  fireEvent.change(screen.getByLabelText("Перейти к дате"), { target: { value: "2026-10-13" } });
  const day = screen.getByRole("gridcell", { name: /13 октября 2026.*событий: 9/ });
  expect(within(day).getAllByRole("button", { name: /Полная запись/ })).toHaveLength(9);
  const last = within(day).getByRole("button", { name: /Полная запись 9/ });
  last.focus();
  fireEvent.keyDown(last, { key: "ArrowRight" });
  expect(last).toHaveFocus();
  fireEvent.click(last);
  expect(screen.getByRole("dialog", { name: "Полная запись 9" })).toBeInTheDocument();
});
it("reserves only two layout rows and reveals a stable 3px day scrollbar on hover or keyboard focus", () => {
  const css = readFileSync("src/renderer/calendar-ux.css", "utf8");
  expect(css).not.toContain("grid-row: 3");
  expect(css).not.toContain("grid-template-rows: auto auto minmax");
  expect(css).toContain("grid-template-rows: auto minmax(360px, 1fr)");
  expect(css).toContain("grid-template-rows: auto minmax(0, 1fr)");
  expect(css).toContain("overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable");
  expect(css).toContain(".calendar-day:is(:hover, :focus-within) .calendar-day-events::-webkit-scrollbar-thumb");
  expect(css).toContain("::-webkit-scrollbar { width: 3px; height: 3px; }");
  expect(css).toContain("::-webkit-scrollbar-thumb { background: transparent");
  expect(css).toContain("@media (hover: none), (forced-colors: active)");
});
it("opens the compact day agenda as a dialog and returns keyboard focus without a below-grid pane", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function(this: HTMLElement) {
    return this.classList.contains("calendar-view") ? 390 : 0;
  });
  render(<FluentProvider theme={workspaceTheme}><CalendarView events={[]} people={[]} currentUserId="test"
    onCreate={vi.fn()} onUpdate={vi.fn()} onCancel={vi.fn()} /></FluentProvider>);
  expect(screen.queryByRole("complementary", { name: "События выбранного дня" })).not.toBeInTheDocument();
  const trigger = screen.getByRole("button", { name: "События выбранного дня · 0" });
  trigger.focus(); fireEvent.click(trigger);
  const pane = screen.getByRole("dialog", { name: "Расписание выбранного дня" });
  await waitFor(() => expect(pane.contains(document.activeElement)).toBe(true));
  fireEvent.keyDown(pane, {key: "Escape"});
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Расписание выбранного дня" })).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.getByRole("grid")).toBeInTheDocument();
});
it("measures the scrollbar rather than adding it to the requested calendar edge", () => {
  let clientWidth = 996;
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => clientWidth);
  let measure = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { measure = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const view = render(<CalendarView events={[]} people={[]} currentUserId="test"
    onCreate={vi.fn()} onUpdate={vi.fn()} onCancel={vi.fn()} />);
  const frame = screen.getByRole("region", { name: "Календарь" });
  expect(frame.style.getPropertyValue("--ws-calendar-scrollbar-inset")).toBe("4px");
  clientWidth = 992;
  act(measure);
  expect(frame.style.getPropertyValue("--ws-calendar-scrollbar-inset")).toBe("8px");
  clientWidth = 1000;
  act(measure);
  expect(frame.style.getPropertyValue("--ws-calendar-scrollbar-inset")).toBe("0px");
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
});
