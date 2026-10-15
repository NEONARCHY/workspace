import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SpatialSort, SpatialSortItem } from "./SpatialSort";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function fixture() {
  const move = vi.fn();
  render(<SpatialSort ids={["a", "b"]} onMove={move} verticalIntent>
    <SpatialSortItem id="a" label="Первый чат" disabled={false} activation="item">Первый чат</SpatialSortItem>
    <SpatialSortItem id="b" label="Второй чат" disabled={false} activation="item">Второй чат</SpatialSortItem>
  </SpatialSort>);
  return { row: screen.getByRole("button", { name: "Переставить: Первый чат" }), move };
}
const touch = (target: HTMLElement, y: number) => ({ identifier: 1, target, clientX: 30, clientY: y });

it("leaves an ordinary vertical touch swipe native instead of activating chat sorting", () => {
  vi.useFakeTimers();
  const { row, move } = fixture();
  fireEvent.touchStart(row, { touches: [touch(row, 30)] });
  const swipe = new Event("touchmove", { bubbles: true, cancelable: true });
  Object.defineProperty(swipe, "touches", { value: [touch(row, 80)] });
  fireEvent(row, swipe);
  act(() => vi.advanceTimersByTime(300));
  expect(swipe.defaultPrevented).toBe(false);
  expect(row).not.toHaveClass("is-lifted");
  fireEvent.touchEnd(row, { touches: [], changedTouches: [touch(row, 80)] });
  expect(move).not.toHaveBeenCalled();
});

it("still permits deliberate long-press sorting and cancels it with Escape", () => {
  vi.useFakeTimers();
  const { row } = fixture();
  fireEvent.touchStart(row, { touches: [touch(row, 30)] });
  act(() => vi.advanceTimersByTime(249));
  expect(row).not.toHaveClass("is-lifted");
  act(() => vi.advanceTimersByTime(1));
  expect(row).toHaveClass("is-lifted");
  fireEvent.keyDown(document, { code: "Escape", key: "Escape" });
  expect(row).not.toHaveClass("is-lifted");
});

it("retains immediate distance-based mouse dragging on the desktop", () => {
  const { row } = fixture();
  fireEvent.mouseDown(row, { button: 0, clientX: 30, clientY: 30 });
  fireEvent.mouseMove(document, { clientX: 30, clientY: 60 });
  expect(row).toHaveClass("is-lifted");
  fireEvent.mouseUp(document);
  expect(row).not.toHaveClass("is-lifted");
});
