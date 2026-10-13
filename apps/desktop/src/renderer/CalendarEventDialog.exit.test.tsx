import { cleanup, render } from "@testing-library/react";
import { Dialog, type DialogProps } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarEventDialog } from "./CalendarEventDialog";

vi.mock("./WorkspaceDialog", () => ({
  WorkspaceDialog: (props: DialogProps) => <Dialog {...props} open />,
}));
afterEach(cleanup);
it("keeps the complete last card intact and inert during exit, then updates before reopening", () => {
  const onClose = vi.fn();
  const view = render(<CalendarEventDialog open title="Первое событие" onClose={onClose}><p>Первое описание</p></CalendarEventDialog>);
  view.rerender(<CalendarEventDialog open={false} title="" onClose={onClose}>{null}</CalendarEventDialog>);
  const surface = document.querySelector(".calendar-event-dialog");
  expect(surface).toHaveTextContent("Первое событие");
  expect(surface).toHaveTextContent("Первое описание");
  expect(surface?.querySelector(".calendar-event-dialog-frame")).toHaveAttribute("inert");
  view.rerender(<CalendarEventDialog open title="Второе событие" onClose={onClose}><p>Второе описание</p></CalendarEventDialog>);
  expect(surface).toHaveTextContent("Второе событие");
  expect(surface).toHaveTextContent("Второе описание");
  expect(surface).not.toHaveTextContent("Первое описание");
  expect(surface?.querySelector(".calendar-event-dialog-frame")).not.toHaveAttribute("inert");
});
