import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent, PointerEvent, RefObject } from "react";

export type MessageBand = { id: string; top: number; bottom: number };

export function shouldStartMessagePaint(dx: number, dy: number, text: boolean) {
  // A deliberate 20px drag starts painting immediately; no hold timer. Keep
  // horizontal text selection native even beyond that distance.
  return text ? Math.abs(dy) >= 20 : Math.hypot(dx, dy) >= 20;
}

export function crossedMessageBands(bands: readonly MessageBand[], from: number, to: number, previous?: string) {
  const ordered = to >= from ? bands : [...bands].reverse();
  const crossed = ordered.filter(band => band.bottom > Math.min(from, to) && band.top <= Math.max(from, to));
  const ids = crossed.filter((band, index) => index > 0 || band.id !== previous).map(band => band.id);
  return { ids, current: bands.find(band => band.top <= to && band.bottom > to)?.id };
}

type Stroke = {
  pointerId: number; startX: number; startY: number; x: number; y: number; text: boolean; started: boolean;
  top: number; left: number; right: number; height: number; lastY: number; lastId?: string; bands: MessageBand[];
};
const interactive = "a,button,input,textarea,select,[contenteditable],[role=button],audio,video,.voice-player-track";

export function useMessagePaintSelection({ paneRef, messages, enabled, onPaint }: {
  paneRef: RefObject<HTMLDivElement | null>; messages: readonly { id: string }[];
  enabled: boolean; onPaint: (ids: readonly string[]) => void;
}) {
  const stroke = useRef<Stroke | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);
  const isPending = useCallback(() => !!stroke.current, []);
  const stop = useCallback(() => {
    const previous = stroke.current;
    stroke.current = undefined;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    const pane = paneRef.current;
    pane?.removeAttribute("data-paint-selecting");
    if (previous?.started) suppressClick.current = true;
    if (previous && pane?.hasPointerCapture?.(previous.pointerId)) pane.releasePointerCapture(previous.pointerId);
  }, [paneRef]);
  useEffect(() => {
    window.addEventListener("blur", stop);
    window.addEventListener("resize", stop);
    return () => { stop(); window.removeEventListener("blur", stop); window.removeEventListener("resize", stop); };
  }, [stop]);
  // New history/layout or a chat switch invalidates the cached bands, not the selection.
  useEffect(() => () => stop(), [messages, enabled, stop]);

  const paint = useCallback(() => {
    const current = stroke.current, pane = paneRef.current;
    if (!current?.started || !pane) return;
    const y = current.y - current.top + pane.scrollTop;
    if (current.x < current.left || current.x > current.right) {
      current.lastId = undefined; current.lastY = y; return;
    }
    const crossed = crossedMessageBands(current.bands, current.lastY, y, current.lastId);
    current.lastY = y; current.lastId = crossed.current;
    if (crossed.ids.length) onPaint(crossed.ids);
  }, [onPaint, paneRef]);
  const autoScroll = useCallback(function tick() {
    frame.current = undefined;
    const current = stroke.current, pane = paneRef.current;
    if (!current?.started || !pane || current.x < current.left || current.x > current.right) return;
    const y = current.y - current.top;
    const speed = y < 24 ? -Math.min(18, 24 - y) : y > current.height - 24 ? Math.min(18, y - current.height + 24) : 0;
    if (!speed) return;
    const previous = pane.scrollTop;
    pane.scrollTop += speed;
    if (pane.scrollTop === previous) return;
    paint(); frame.current = requestAnimationFrame(tick);
  }, [paint, paneRef]);
  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    if (!enabled || event.defaultPrevented || event.pointerType !== "mouse" || event.button !== 0
      || !event.isPrimary || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || (event.target as HTMLElement).closest(interactive)) return;
    stop();
    const pane = event.currentTarget, bounds = pane.getBoundingClientRect();
    // Do not capture native scrollbar dragging.
    if (event.clientX >= bounds.left + pane.clientWidth) return;
    const bands = [...pane.querySelectorAll<HTMLElement>(".message-row:not(.is-removing) > .message[data-message-id]")].map(row => {
      const rect = row.getBoundingClientRect();
      return { id: row.dataset.messageId!, top: rect.top - bounds.top + pane.scrollTop, bottom: rect.bottom - bounds.top + pane.scrollTop };
    });
    stroke.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, text: !!(event.target as HTMLElement).closest(".message-text, [data-message-text]"),
      started: false, top: bounds.top, left: bounds.left, right: bounds.left + pane.clientWidth,
      height: pane.clientHeight, lastY: event.clientY - bounds.top + pane.scrollTop, bands };
  }, [enabled, stop]);
  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const current = stroke.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (!(event.buttons & 1)) { stop(); return; }
    current.x = event.clientX; current.y = event.clientY;
    if (!current.started) {
      // Horizontal text selection/copy stays native; vertical painting selects rows.
      if (!shouldStartMessagePaint(event.clientX - current.startX, event.clientY - current.startY, current.text)) return;
      current.started = true;
      event.currentTarget.setAttribute("data-paint-selecting", "true");
      event.currentTarget.setPointerCapture?.(event.pointerId);
      window.getSelection()?.removeAllRanges();
      event.currentTarget.focus({ preventScroll: true });
    }
    event.preventDefault(); paint();
    if (frame.current === undefined) frame.current = requestAnimationFrame(autoScroll);
  }, [autoScroll, paint, stop]);
  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (stroke.current?.pointerId !== event.pointerId) return;
    if (stroke.current.started) { stroke.current.x = event.clientX; stroke.current.y = event.clientY; paint(); }
    stop();
  }, [paint, stop]);
  const onClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current || event.detail === 0) return;
    suppressClick.current = false; event.preventDefault(); event.stopPropagation();
  }, []);
  return { onPointerDown, onPointerMove, onPointerUp, onClickCapture, onScroll: paint, stop, isPending };
}
