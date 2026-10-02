import { useLayoutEffect, useRef, useState } from "react";
import type { HTMLAttributes, ReactNode } from "react";

interface SlidingSegmentedProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  readonly children: ReactNode;
  readonly as?: "div" | "nav" | "span";
}

interface IndicatorPosition {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A shared moving selection surface for button groups and tab lists. */
export function SlidingSegmented({ children, className = "", as = "div", ...props }: SlidingSegmentedProps) {
  const containerRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<IndicatorPosition>();
  const Element = as;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const active = container.querySelector<HTMLButtonElement>(
        ':scope > button[aria-pressed="true"], :scope > button[aria-selected="true"]',
      );
      if (!active) {
        setPosition(undefined);
        return;
      }
      const frame = container.getBoundingClientRect();
      const button = active.getBoundingClientRect();
      const next = {
        x: button.left - frame.left + container.scrollLeft,
        y: button.top - frame.top + container.scrollTop,
        width: button.width,
        height: button.height,
      };
      setPosition((previous) => previous
        && previous.x === next.x && previous.y === next.y
        && previous.width === next.width && previous.height === next.height
        ? previous : next);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(container);
    container.querySelectorAll(":scope > button").forEach((button) => observer?.observe(button));
    container.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer?.disconnect();
      container.removeEventListener("scroll", measure);
    };
  }, [children]);

  return <Element {...props} ref={(node) => { containerRef.current = node; }} className={`sliding-segmented ${className}`.trim()}>
    {children}
    <span className="sliding-segmented-indicator" aria-hidden="true" style={position ? {
      width: position.width,
      height: position.height,
      transform: `translate(${position.x}px, ${position.y}px)`,
      opacity: 1,
    } : undefined} />
  </Element>;
}
