import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarView } from "./CalendarView";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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
