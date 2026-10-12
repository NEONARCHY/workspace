import { useCallback, type RefCallback } from "react";

/** Boards scroll over empty space; employee strips opt into delayed wheel over buttons. */
export function useHorizontalBoardScroll<T extends HTMLElement>({ hoverDelayMs = 0, overButtons = false }: {
  hoverDelayMs?: number; overButtons?: boolean;
} = {}): RefCallback<T> {
  return useCallback((board: T | null) => {
    if (!board) return;
    let enteredAt: number | undefined;
    const enter = () => { enteredAt = Date.now(); };
    const leave = () => { enteredAt = undefined; };
    const onWheel = (event: WheelEvent) => {
      if (hoverDelayMs > 0 && (enteredAt === undefined || Date.now() - enteredAt < hoverDelayMs)) return;
      if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey
        || event.altKey || event.shiftKey || event.buttons || event.deltaX || !event.deltaY) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest(
        '[data-spatial-card], input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"]',
      ) || !overButtons && target.closest('button, a, [role="button"]')) return;
      // Keep a lane's own vertical scrolling, including at its boundaries.
      for (let node: Element | null = target; node && node !== board; node = node.parentElement) {
        if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight
          && /auto|scroll/.test(getComputedStyle(node).overflowY)) return;
      }
      const maximum = board.scrollWidth - board.clientWidth;
      if (maximum <= 0 || getComputedStyle(board).direction === "rtl") return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? board.clientWidth
        : event.deltaMode === WheelEvent.DOM_DELTA_LINE ? Number.parseFloat(getComputedStyle(board).lineHeight) || 16 : 1;
      const next = Math.max(0, Math.min(maximum, board.scrollLeft + event.deltaY * unit));
      if (next === board.scrollLeft) return;
      event.preventDefault();
      board.scrollLeft = next;
    };
    board.addEventListener("wheel", onWheel, { passive: false });
    board.addEventListener("mouseenter", enter);
    board.addEventListener("mouseleave", leave);
    window.addEventListener("blur", leave);
    // React 19 ref cleanup also runs when the board switches to list/designer.
    return () => {
      board.removeEventListener("wheel", onWheel);
      board.removeEventListener("mouseenter", enter);
      board.removeEventListener("mouseleave", leave);
      window.removeEventListener("blur", leave);
    };
  }, [hoverDelayMs, overButtons]);
}
