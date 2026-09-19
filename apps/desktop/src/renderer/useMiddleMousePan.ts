import { useRef, type MouseEventHandler, type PointerEventHandler, type RefObject } from "react";

interface MiddleMousePanProps<T extends HTMLElement> {
  readonly ref: RefObject<T | null>;
  readonly onPointerDown: PointerEventHandler<T>;
  readonly onPointerMove: PointerEventHandler<T>;
  readonly onPointerUp: PointerEventHandler<T>;
  readonly onPointerCancel: PointerEventHandler<T>;
  readonly onLostPointerCapture: PointerEventHandler<T>;
  readonly onAuxClick: MouseEventHandler<T>;
}

interface PanSession {
  readonly pointerId: number;
  readonly startX: number;
  readonly scrollLeft: number;
}

export function useMiddleMousePan<T extends HTMLElement>(): MiddleMousePanProps<T> {
  const ref = useRef<T>(null);
  const sessionRef = useRef<PanSession | undefined>(undefined);

  const finish: PointerEventHandler<T> = (event) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    sessionRef.current = undefined;
    event.currentTarget.classList.remove("is-middle-panning");
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return {
    ref,
    onPointerDown: (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      sessionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        scrollLeft: event.currentTarget.scrollLeft,
      };
      event.currentTarget.classList.add("is-middle-panning");
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.currentTarget.scrollLeft = session.scrollLeft - (event.clientX - session.startX);
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    onAuxClick: (event) => {
      if (event.button === 1) event.preventDefault();
    },
  };
}
