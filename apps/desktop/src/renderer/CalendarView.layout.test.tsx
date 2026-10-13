import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarView } from "./CalendarView";
import { workspaceTheme } from "./workspace-theme";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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
