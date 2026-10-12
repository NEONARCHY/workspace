import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHorizontalBoardScroll } from "./useHorizontalBoardScroll";

function Surface({ visible = true, delayed = false }: { visible?: boolean; delayed?: boolean }) {
  const ref = useHorizontalBoardScroll<HTMLDivElement>(delayed ? { hoverDelayMs: 500, overButtons: true } : {});
  return visible ? <div ref={ref} data-testid="board" style={{ lineHeight: "20px" }}>
    <div data-testid="empty" />
    <article data-spatial-card="request"><span data-testid="card">Заявка</span></article>
    <button>Действие</button><input aria-label="Поиск" />
    <div data-testid="stack" style={{ overflowY: "auto" }}><span data-testid="stack-empty" /></div>
  </div> : null;
}
function setup(delayed = false) {
  const view = render(<Surface delayed={delayed} />);
  const board = view.getByTestId("board");
  Object.defineProperties(board, { clientWidth: { value: 400, configurable: true }, scrollWidth: { value: 1400, configurable: true } });
  const wheel = (target: Element = view.getByTestId("empty"), init: WheelEventInit = {}) => {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 40, ...init });
    fireEvent(target, event);
    return event;
  };
  return { ...view, board, wheel };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("useHorizontalBoardScroll", () => {
  it("enables wheel over employee buttons only after 500ms of continuous hover", () => {
    vi.useFakeTimers();
    const { board, wheel, getByRole } = setup(true);
    const button = getByRole("button");
    expect(wheel(button).defaultPrevented).toBe(false);
    fireEvent.mouseEnter(board);
    vi.advanceTimersByTime(499);
    expect(wheel(button).defaultPrevented).toBe(false);
    vi.advanceTimersByTime(1);
    expect(wheel(button).defaultPrevented).toBe(true);
    expect(board.scrollLeft).toBe(40);
    fireEvent.mouseLeave(board);
    fireEvent.mouseEnter(board);
    expect(wheel(button).defaultPrevented).toBe(false);
    vi.advanceTimersByTime(500);
    fireEvent.blur(window);
    expect(wheel(button).defaultPrevented).toBe(false);
  });
  it("preserves native gestures, boundaries and input fields after the hover delay", () => {
    vi.useFakeTimers();
    const { board, wheel, getByRole } = setup(true);
    fireEvent.mouseEnter(board);
    vi.advanceTimersByTime(500);
    for (const init of [{ ctrlKey: true }, { deltaX: 30 }, { shiftKey: true }, { deltaY: -40 }]) {
      expect(wheel(board, init).defaultPrevented).toBe(false);
    }
    expect(wheel(getByRole("textbox")).defaultPrevented).toBe(false);
    Object.defineProperty(board, "scrollWidth", { value: 400 });
    expect(wheel().defaultPrevented).toBe(false);
  });
  it("scrolls empty space horizontally and clamps to the board extent", () => {
    const { board, wheel } = setup();
    expect(wheel().defaultPrevented).toBe(true);
    expect(board.scrollLeft).toBe(40);
    wheel(board, { deltaY: 2000 });
    expect(board.scrollLeft).toBe(1000);
    expect(wheel().defaultPrevented).toBe(false);
    wheel(board, { deltaY: -60 });
    expect(board.scrollLeft).toBe(940);
  });
  it("preserves wheel input over cards and controls", () => {
    const { board, wheel, getByTestId, getByRole } = setup();
    for (const target of [getByTestId("card"), getByRole("button"), getByRole("textbox")]) {
      expect(wheel(target).defaultPrevented).toBe(false);
    }
    expect(board.scrollLeft).toBe(0);
  });
  it("preserves a nested lane's vertical scrolling, even at the bottom", () => {
    const { board, wheel, getByTestId } = setup();
    const stack = getByTestId("stack");
    Object.defineProperties(stack, { clientHeight: { value: 100 }, scrollHeight: { value: 400 } });
    for (const top of [0, 300]) {
      stack.scrollTop = top;
      expect(wheel(getByTestId("stack-empty")).defaultPrevented).toBe(false);
    }
    expect(board.scrollLeft).toBe(0);
  });
  it.each([{ deltaX: 20 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { buttons: 4 }, { deltaY: 0 }, { cancelable: false }])("leaves native gesture %o alone", init => {
    const { board, wheel } = setup();
    expect(wheel(board, init).defaultPrevented).toBe(false);
    expect(board.scrollLeft).toBe(0);
  });
  it("normalizes line and page deltas", () => {
    const { board, wheel } = setup();
    wheel(board, { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE });
    expect(board.scrollLeft).toBe(60);
    wheel(board, { deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE });
    expect(board.scrollLeft).toBe(460);
  });
  it("does not trap a non-overflowing board or its left boundary", () => {
    const { board, wheel } = setup();
    expect(wheel(board, { deltaY: -40 }).defaultPrevented).toBe(false);
    Object.defineProperty(board, "scrollWidth", { value: 400 });
    expect(wheel().defaultPrevented).toBe(false);
  });
  it("does not cancel middle clicks or capture the pointer for grabbing", () => {
    const { board } = setup();
    const capture = vi.fn();
    board.setPointerCapture = capture;
    for (const type of ["pointerdown", "mousedown", "mouseup", "auxclick"]) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 1 });
      fireEvent(board, event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(capture).not.toHaveBeenCalled();
    expect(board).not.toHaveClass("is-middle-panning");
  });
  it("cleans up when hidden and attaches to the new board on return", () => {
    const { board, wheel, rerender, getByTestId } = setup();
    const remove = vi.spyOn(board, "removeEventListener");
    rerender(<Surface visible={false} />);
    expect(remove).toHaveBeenCalledWith("wheel", expect.any(Function));
    expect(wheel(board).defaultPrevented).toBe(false);
    rerender(<Surface />);
    const next = getByTestId("board");
    Object.defineProperties(next, { clientWidth: { value: 400 }, scrollWidth: { value: 1400 } });
    expect(wheel(next).defaultPrevented).toBe(true);
    expect(next.scrollLeft).toBe(40);
  });
});
