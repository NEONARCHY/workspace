import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SwipeRow } from "./SwipeRow";

class Pointer extends MouseEvent {
  readonly pointerId = 1;
  readonly isPrimary = true;
}
beforeEach(() => {
  vi.stubGlobal("PointerEvent", Pointer);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(disabled = false) {
  const action = vi.fn(), open = vi.fn();
  const view = render(<SwipeRow label="Удалить: Диалог" onAction={action} disabled={disabled}><button onClick={open}>Открыть</button></SwipeRow>);
  const surface = view.container.querySelector(".swipe-row-surface")!;
  vi.spyOn(surface.parentElement!, "getBoundingClientRect").mockReturnValue({ width: 300 } as DOMRect);
  return { ...view, surface, action, open };
}
function swipe(surface: Element, dx: number, dy = 0, cancel = false) {
  fireEvent.pointerDown(surface, { button: 0, clientX: 280, clientY: 50 });
  fireEvent.pointerMove(surface, { clientX: 280 + dx, clientY: 50 + dy });
  if (cancel) fireEvent.pointerCancel(surface);
  else fireEvent.pointerUp(surface, { clientX: 280 + dx, clientY: 50 + dy });
}
it("reveals the action on a short left swipe without deleting or opening the row", () => {
  const { surface, action, open } = setup();
  swipe(surface, -80);
  fireEvent.click(screen.getByText("Открыть"), { detail: 1 });
  expect(open).not.toHaveBeenCalled();
  expect(action).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Удалить: Диалог" })).toBeVisible();
});
it("commits a full swipe exactly once after release", () => {
  const { surface, action } = setup();
  swipe(surface, -240);
  expect(action).toHaveBeenCalledOnce();
  fireEvent.pointerUp(surface);
  expect(action).toHaveBeenCalledOnce();
});
it("keeps keyboard deletion usable without media-query support", () => {
  vi.stubGlobal("matchMedia", undefined);
  const { action } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Показать действие: Удалить: Диалог" }));
  fireEvent.click(screen.getByRole("button", { name: "Удалить: Диалог" }));
  expect(action).toHaveBeenCalledOnce();
});
it("does not swallow keyboard activation after a swipe", () => {
  const { surface, open } = setup();
  swipe(surface, -80);
  fireEvent.click(screen.getByText("Открыть"), { detail: 0 });
  expect(open).toHaveBeenCalledOnce();
});
it("never commits a cancelled full swipe", () => {
  const { surface, action } = setup();
  swipe(surface, -250, 0, true);
  expect(action).not.toHaveBeenCalled();
  expect(surface.parentElement).not.toHaveClass("is-open");
});
it.each([[0, 100], [-15, 100], [150, 0]])("ignores vertical scrolling and rightward gestures (%i,%i)", (dx, dy) => {
  const { surface, action } = setup();
  swipe(surface, dx, dy);
  expect(action).not.toHaveBeenCalled();
  expect(surface.parentElement).not.toHaveClass("is-open");
});
it("preserves normal clicks and offers a keyboard alternative with Escape", () => {
  const { surface, open, action } = setup();
  fireEvent.click(screen.getByText("Открыть"));
  expect(open).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Показать действие: Удалить: Диалог" }));
  fireEvent.keyDown(surface, { key: "Escape" });
  expect(surface.parentElement).not.toHaveClass("is-open");
  expect(action).not.toHaveBeenCalled();
});
it("does not expose or trigger protected actions", () => {
  const { surface, action } = setup(true);
  swipe(surface, -250);
  expect(action).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Показать действие: Удалить: Диалог" })).not.toBeInTheDocument();
});
