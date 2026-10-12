import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarView } from "./CalendarView";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("moves keyboard focus to the complete day agenda using the compact jump action", () => {
  render(<CalendarView events={[]} people={[]} currentUserId="test"
    onCreate={vi.fn()} onUpdate={vi.fn()} onCancel={vi.fn()} />);
  const pane = screen.getByRole("complementary", { name: "События выбранного дня" });
  const scroll = vi.fn();
  pane.scrollIntoView = scroll;
  fireEvent.click(screen.getByRole("button", { name: "События выбранного дня · 0" }));
  expect(pane).toHaveFocus();
  expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
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
