import { useCallback, type RefCallback } from "react";

/** Wheel over empty board space moves between lanes. All other input stays native. */
export function useHorizontalBoardScroll<T extends HTMLElement>(): RefCallback<T> {
  return useCallback((board: T | null) => {
    if (!board) return;
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey
        || event.altKey || event.shiftKey || event.buttons || event.deltaX || !event.deltaY) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest(
        '[data-spatial-card], button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"]',
      )) return;
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
    // React 19 ref cleanup also runs when the board switches to list/designer.
    return () => board.removeEventListener("wheel", onWheel);
  }, []);
}
