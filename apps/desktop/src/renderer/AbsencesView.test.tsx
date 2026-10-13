import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { AbsencesView } from "./AbsencesView";
import { workspaceTheme } from "./workspace-theme";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("keeps the absence draft and shows an error inside the form on failure", async () => {
  const create = vi.fn().mockRejectedValue(new Error("Временная ошибка"));
  render(<FluentProvider theme={workspaceTheme}><AbsencesView currentUserId="self" people={[]} requests={[]} summary={[]} canAdmin={false}
    onCreate={create} onAction={vi.fn()} onUploadDocument={vi.fn()} /></FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Сообщить об отсутствии" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Причина" }), { target: { value: "Сохранить основание" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Отправить руководителю" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Временная ошибка");
  expect(within(dialog).getByRole("textbox", { name: "Причина" })).toHaveValue("Сохранить основание");
  expect(within(dialog).getByRole("button", { name: "Отправить руководителю" })).toBeEnabled();
});
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
