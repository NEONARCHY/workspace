import { useLayoutEffect, useRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";

interface SlidingSegmentedProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  readonly children: ReactNode;
  readonly as?: "div" | "nav" | "span";
  readonly onContainer?: (node: HTMLElement | null) => void;
  readonly activeSelector?: string;
}

interface IndicatorPosition {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly animate: boolean;
}

/** A shared moving selection surface for button groups and tab lists. */
export function SlidingSegmented({ children, className = "", as = "div", onContainer, activeSelector = ':scope > button[aria-pressed="true"], :scope > button[aria-selected="true"]', ...props }: SlidingSegmentedProps) {
  const containerRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const positionRef = useRef<IndicatorPosition | undefined>(undefined);
  const Element = as;

  useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;
    const hide = () => {
      selectedRef.current = null;
      positionRef.current = undefined;
      indicator.style.opacity = "0";
    };
    const measure = () => {
      const active = container.querySelector<HTMLButtonElement>(activeSelector);
      if (!active) {
        hide();
        return;
      }
      // Layout offsets share the indicator's padding-box origin. Screen rects
      // include the container border and temporary page-entry transforms.
      if (!active.offsetWidth || !active.offsetHeight) {
        hide();
        return;
      }
      let x = active.offsetLeft, y = active.offsetTop;
      // Navigation may have relative slots. Use layout coordinates so page
      // transforms, zoom and scrolling do not shift the selection surface.
      let parent = active.offsetParent;
      while (parent instanceof HTMLElement && parent !== container) {
        x += parent.offsetLeft; y += parent.offsetTop;
        parent = parent.offsetParent;
      }
      const next = {
        x, y,
        width: active.offsetWidth,
        height: active.offsetHeight,
        animate: selectedRef.current !== null && selectedRef.current !== active,
      };
      selectedRef.current = active;
      const previous = positionRef.current;
      if (previous && previous.x === next.x && previous.y === next.y
        && previous.width === next.width && previous.height === next.height) return;
      positionRef.current = next;
      // Disclosure transitions move unchanged buttons each frame. Follow layout
      // directly without rerendering the group or animating its labels.
      Object.assign(indicator.style, {
        width: `${next.width}px`, height: `${next.height}px`,
        transform: `translate(${next.x}px, ${next.y}px)`, opacity: "1",
        transition: next.animate ? "" : "none",
      });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(container);
    // Fixed-height menus can rearrange rows without resizing their buttons.
    Array.from(container.children).forEach((child) => {
      if (child !== indicator) observer?.observe(child);
    });
    container.querySelectorAll("button").forEach((button) => observer?.observe(button));
    container.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer?.disconnect();
      container.removeEventListener("scroll", measure);
    };
  }, [children, containerRef, activeSelector]);

  return <Element {...props} ref={(node) => { containerRef.current = node; onContainer?.(node); }} className={`sliding-segmented ${className}`.trim()}>
    {children}
    <span ref={indicatorRef} className="sliding-segmented-indicator" aria-hidden="true" />
  </Element>;
}
