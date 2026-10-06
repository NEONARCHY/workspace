import { act, cleanup, render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { AbsencesView } from "./AbsencesView";
import { workspaceTheme } from "./workspace-theme";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const view = (canAdmin: boolean) => render(<FluentProvider theme={workspaceTheme}><AbsencesView
  currentUserId="test" people={[]} requests={[]} summary={[]} canAdmin={canAdmin}
  onCreate={vi.fn()} onAction={vi.fn()} onUploadDocument={vi.fn()}
/></FluentProvider>);

it("gives all seven summary tiles stable semantic status identities", () => {
  view(true);
  const tiles = screen.getByRole("region", { name: "Сводка присутствия" }).children;
  expect(Array.from(tiles, (tile) => tile.getAttribute("data-presence-status"))).toEqual([
    "working", "trip", "vacation", "personal_time", "late_arrival", "sick_leave", "business_event",
  ]);
  expect(Array.from(tiles, (tile) => tile.querySelector("strong")?.textContent)).toEqual(Array(7).fill("0"));
});
it("keeps the organization summary hidden without administration rights", () => {
  view(false);
  expect(screen.queryByRole("region", { name: "Сводка присутствия" })).not.toBeInTheDocument();
});
it("includes the actual scrollbar in the requested absence edge and releases its observer", () => {
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
  const result = view(true);
  const frame = screen.getByRole("region", { name: "Отсутствия" });
  expect(frame.style.getPropertyValue("--ws-absence-scrollbar-inset")).toBe("4px");
  clientWidth = 992;
  act(measure);
  expect(frame.style.getPropertyValue("--ws-absence-scrollbar-inset")).toBe("8px");
  clientWidth = 1000;
  act(measure);
  expect(frame.style.getPropertyValue("--ws-absence-scrollbar-inset")).toBe("0px");
  result.unmount();
  expect(disconnect).toHaveBeenCalled();
});
