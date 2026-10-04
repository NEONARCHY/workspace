import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RecordSection } from "./RecordComposer";

afterEach(cleanup);
it("preserves the same field and draft across native disclosure toggles", () => {
  const view = render(<RecordSection collapsible title="План"><input aria-label="Пункт плана" defaultValue="Черновик" /></RecordSection>);
  const input = screen.getByRole("textbox", { name: "Пункт плана", hidden: true });
  const details = view.container.querySelector("details")!;
  act(() => { details.open = true; details.dispatchEvent(new Event("toggle")); });
  fireEvent.change(input, { target: { value: "Изменённый черновик" } });
  act(() => { details.open = false; details.dispatchEvent(new Event("toggle")); });
  act(() => { details.open = true; details.dispatchEvent(new Event("toggle")); });
  expect(screen.getByRole("textbox", { name: "Пункт плана" })).toBe(input);
  expect(input).toHaveValue("Изменённый черновик");
});
it("keeps ordinary sections visible without disclosure controls", () => {
  const view = render(<RecordSection title="Общее"><input aria-label="Название" /></RecordSection>);
  expect(screen.getByRole("heading", { name: "Общее" })).toBeInTheDocument();
  expect(view.container.querySelector("details")).toBeNull();
});
