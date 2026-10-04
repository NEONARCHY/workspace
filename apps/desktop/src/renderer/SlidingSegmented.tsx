import { useLayoutEffect, useRef, useState } from "react";
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
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const [position, setPosition] = useState<IndicatorPosition>();
  const Element = as;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const active = container.querySelector<HTMLButtonElement>(activeSelector);
      if (!active) {
        selectedRef.current = null;
        setPosition(undefined);
        return;
      }
      // Layout offsets share the indicator's padding-box origin. Screen rects
      // include the container border and temporary page-entry transforms.
      if (!active.offsetWidth || !active.offsetHeight) {
        selectedRef.current = null;
        setPosition(undefined);
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
      setPosition((previous) => previous
        && previous.x === next.x && previous.y === next.y
        && previous.width === next.width && previous.height === next.height
        ? previous : next);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(container);
    container.querySelectorAll("button").forEach((button) => observer?.observe(button));
    container.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer?.disconnect();
      container.removeEventListener("scroll", measure);
    };
  }, [children, containerRef, activeSelector]);

  return <Element {...props} ref={(node) => { containerRef.current = node; onContainer?.(node); }} className={`sliding-segmented ${className}`.trim()}>
    {children}
    <span className="sliding-segmented-indicator" aria-hidden="true" style={position ? {
      width: position.width,
      height: position.height,
      transform: `translate(${position.x}px, ${position.y}px)`,
      opacity: 1,
      // Initial placement, font loading and resizing snap into place. Only a
      // change of selection in this mounted group uses the shared transition.
      transition: position.animate ? undefined : "none",
    } : undefined} />
  </Element>;
}
