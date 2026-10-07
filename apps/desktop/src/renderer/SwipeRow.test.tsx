import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
it("reveals the action on a short left swipe without deleting or opening the row", async () => {
  const { surface, action, open } = setup();
  swipe(surface, -80);
  fireEvent.click(screen.getByText("Открыть"), { detail: 1 });
  expect(open).not.toHaveBeenCalled();
  expect(action).not.toHaveBeenCalled();
  expect(await screen.findByRole("button", { name: "Удалить: Диалог" })).toBeVisible();
});
it("commits a full swipe exactly once after release", () => {
  const { surface, action } = setup();
  swipe(surface, -240);
  expect(action).toHaveBeenCalledOnce();
  fireEvent.pointerUp(surface);
  expect(action).toHaveBeenCalledOnce();
});
it("keeps keyboard deletion usable without media-query support", async () => {
  vi.stubGlobal("matchMedia", undefined);
  const { action } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Показать действие: Удалить: Диалог" }));
  fireEvent.click(await screen.findByRole("button", { name: "Удалить: Диалог" }));
  expect(action).toHaveBeenCalledOnce();
});
it("does not swallow keyboard activation after a swipe", () => {
  const { surface, open } = setup();
  swipe(surface, -80);
  fireEvent.click(screen.getByText("Открыть"), { detail: 0 });
  expect(open).toHaveBeenCalledOnce();
});
it("does not cancel a touch gesture when a child transfers implicit capture to the surface", () => {
  const { surface, action } = setup();
  const child = screen.getByText("Открыть");
  fireEvent.pointerDown(child, { button: 0, clientX: 280, clientY: 50 });
  fireEvent.pointerMove(child, { clientX: 250, clientY: 50 });
  fireEvent.lostPointerCapture(child);
  fireEvent.pointerMove(surface, { clientX: 40, clientY: 50 });
  fireEvent.pointerUp(surface);
  expect(action).toHaveBeenCalledOnce();
});
it("cancels a swipe when the surface itself loses capture", () => {
  const { surface, action } = setup();
  fireEvent.pointerDown(surface, { button: 0, clientX: 280, clientY: 50 });
  fireEvent.pointerMove(surface, { clientX: 40, clientY: 50 });
  fireEvent.lostPointerCapture(surface);
  fireEvent.pointerUp(surface);
  expect(action).not.toHaveBeenCalled();
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
it("fully hides the destructive backdrop before any swipe", () => {
  const { container } = setup();
  expect(container.querySelector(".swipe-row-reveal")).toHaveStyle({ visibility: "hidden" });
  expect(container.querySelector(".swipe-row-action")).toHaveAttribute("aria-hidden", "true");
  expect(container.querySelector(".swipe-row-action")).toHaveAttribute("tabindex", "-1");
});
it("extends the fixed backdrop under rounded trailing corners during a held swipe", async () => {
  const { container, surface, action } = setup();
  const reveal = container.querySelector(".swipe-row-reveal") as HTMLElement;
  const button = container.querySelector(".swipe-row-action") as HTMLElement;
  fireEvent.pointerDown(surface, { button: 0, clientX: 280, clientY: 50 });
  fireEvent.pointerMove(surface, { clientX: 100, clientY: 50 });
  await waitFor(() => {
    expect(reveal).toHaveStyle({ visibility: "visible", transform: "translateX(calc(100% - 180px - var(--swipe-row-radius)))" });
    expect(button).toHaveStyle({ transform: "translateX(calc(-100% + 180px + var(--swipe-row-radius)))" });
    expect(surface).toHaveStyle({ transform: "translateX(-180px)" });
  });
  expect(action).not.toHaveBeenCalled();
  expect(button).toHaveAttribute("aria-hidden", "true");
  fireEvent.pointerMove(surface, { clientX: 280, clientY: 50 });
  await waitFor(() => expect(reveal).toHaveStyle({ visibility: "hidden" }));
  fireEvent.pointerCancel(surface);
  expect(action).not.toHaveBeenCalled();
});
it("removes all backdrop paint after Escape or gesture cancellation", async () => {
  const { container, surface, action } = setup();
  const reveal = container.querySelector(".swipe-row-reveal");
  swipe(surface, -80);
  await waitFor(() => expect(reveal).toHaveStyle({ visibility: "visible" }));
  fireEvent.keyDown(surface, { key: "Escape" });
  await waitFor(() => expect(reveal).toHaveStyle({ visibility: "hidden" }));
  fireEvent.pointerDown(surface, { button: 0, clientX: 280, clientY: 50 });
  fireEvent.pointerMove(surface, { clientX: 30, clientY: 50 });
  await waitFor(() => expect(reveal).toHaveStyle({ visibility: "visible" }));
  fireEvent.pointerCancel(surface);
  await waitFor(() => expect(reveal).toHaveStyle({ visibility: "hidden" }));
  expect(action).not.toHaveBeenCalled();
});
it("keeps Enter/Space on swipe controls out of a parent sortable row", async () => {
  const sortable = vi.fn();
  render(<div onKeyDown={sortable}><SwipeRow label="Удалить: Диалог" onAction={vi.fn()}><button>Открыть</button></SwipeRow></div>);
  const toggle = screen.getByRole("button", { name: "Показать действие: Удалить: Диалог" });
  fireEvent.keyDown(toggle, { key: "Enter" });
  fireEvent.keyDown(toggle, { key: " " });
  expect(sortable).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  const action = await screen.findByRole("button", { name: "Удалить: Диалог" });
  fireEvent.keyDown(action, { key: "Enter" });
  fireEvent.keyDown(action, { key: " " });
  expect(sortable).not.toHaveBeenCalled();
});
it("closes from the focused destructive action and returns focus to the reveal control", async () => {
  const { container, action } = setup();
  const toggle = screen.getByRole("button", { name: "Показать действие: Удалить: Диалог" });
  fireEvent.click(toggle);
  const button = await screen.findByRole("button", { name: "Удалить: Диалог" });
  button.focus();
  fireEvent.keyDown(button, { key: "Escape" });
  expect(toggle).toHaveFocus();
  await waitFor(() => expect(container.querySelector(".swipe-row-reveal")).toHaveStyle({ visibility: "hidden" }));
  expect(action).not.toHaveBeenCalled();
});
