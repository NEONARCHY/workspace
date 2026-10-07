import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { Delete20Regular } from "@fluentui/react-icons";
import "./swipe-row.css";

/** Horizontal intent only: vertical scrolling, context menus and ordinary clicks stay native. */
export function SwipeRow({ children, label, onAction, disabled = false, className = "" }: {
  readonly children: ReactNode;
  readonly label: string;
  readonly onAction: () => void;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  // Extend the reveal beneath the rounded trailing corners, not the card body.
  // Opposing transforms keep the full-width gradient fixed in the row.
  const revealX = useTransform(x, offset => `calc(100% - ${-offset}px - var(--swipe-row-radius))`);
  const actionX = useTransform(x, offset => `calc(-100% + ${-offset}px + var(--swipe-row-radius))`);
  const actionVisibility = useTransform(x, offset => offset < 0 ? "visible" : "hidden");
  const animation = useRef<ReturnType<typeof animate> | null>(null);
  const gesture = useRef<{ id: number; startX: number; startY: number; origin: number; axis: "pending" | "x" | "y"; lastX: number; lastAt: number; velocity: number } | null>(null);
  const moved = useRef(false);
  const [open, setOpen] = useState(false);
  const railWidth = 88;
  const settle = (value: number) => {
    animation.current?.stop();
    const instant = !window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)").matches;
    if (instant) x.set(value);
    else animation.current = animate(x, value, { duration: .22, ease: [.2, 0, 0, 1] });
    setOpen(value < 0);
  };
  useEffect(() => () => animation.current?.stop(), []);
  return <div ref={root} className={`swipe-row ${open ? "is-open" : ""} ${className}`}
    onKeyDown={event => {
      if (event.key === "Escape" && open) {
        event.preventDefault(); event.stopPropagation();
        if ((event.target as Element).closest(".swipe-row-action")) root.current?.querySelector<HTMLButtonElement>(".swipe-row-keyboard")?.focus({ preventScroll: true });
        settle(0);
      }
    }}>
    {!disabled ? <motion.div className="swipe-row-reveal" style={{ x: revealX, visibility: actionVisibility }}>
      <motion.button type="button" className="swipe-row-action" style={{ x: actionX }} aria-label={label}
        tabIndex={open ? 0 : -1} aria-hidden={!open} onClick={() => { settle(0); onAction(); }}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}>
        <span className="swipe-row-action-label"><Delete20Regular /><span>{label.split(":")[0]}</span></span>
      </motion.button>
    </motion.div> : null}
    <motion.div className="swipe-row-surface" style={{ x }}
      onPointerDown={event => {
        if (disabled || event.button !== 0 || !event.isPrimary || (event.target as Element).closest("input, textarea, select, [data-no-swipe]")) return;
        animation.current?.stop();
        moved.current = false;
        gesture.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, origin: x.get(), axis: "pending", lastX: event.clientX, lastAt: event.timeStamp, velocity: 0 };
      }}
      onPointerMove={event => {
        const g = gesture.current;
        if (!g || g.id !== event.pointerId || g.axis === "y") return;
        const dx = event.clientX - g.startX, dy = event.clientY - g.startY;
        if (g.axis === "pending") {
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
          if (Math.abs(dy) >= Math.abs(dx) || (dx > 0 && g.origin === 0)) { g.axis = "y"; return; }
          g.axis = "x";
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }
        event.preventDefault();
        moved.current = true;
        const width = root.current?.getBoundingClientRect().width ?? railWidth;
        x.set(Math.max(-width, Math.min(0, g.origin + dx)));
        g.velocity = (event.clientX - g.lastX) / Math.max(1, event.timeStamp - g.lastAt);
        g.lastX = event.clientX; g.lastAt = event.timeStamp;
      }}
      onPointerUp={event => {
        const g = gesture.current;
        gesture.current = null;
        if (!g || g.axis !== "x") return;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        const width = root.current?.getBoundingClientRect().width ?? railWidth;
        const threshold = Math.max(railWidth + 32, width * .68);
        const distance = -x.get();
        const velocity = event.timeStamp - g.lastAt < 100 ? g.velocity : 0;
        settle(distance > railWidth / 2 || velocity < -.45 ? -railWidth : 0);
        if (distance >= threshold) { settle(0); onAction(); }
      }}
      onPointerCancel={() => { gesture.current = null; settle(0); }}
      onLostPointerCapture={event => {
        // Touch starts with implicit capture on a child. Its bubbled loss when
        // this surface takes capture is a transfer, not a cancelled gesture.
        if (event.target === event.currentTarget && gesture.current?.id === event.pointerId && gesture.current.axis === "x") {
          gesture.current = null; settle(0);
        }
      }}
      onClickCapture={event => {
        if (moved.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
        moved.current = false;
      }}>
      {children}
      {!disabled ? <button type="button" className="swipe-row-keyboard" aria-label={`Показать действие: ${label}`} aria-expanded={open}
        onClick={() => settle(open ? 0 : -railWidth)}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}><Delete20Regular /></button> : null}
    </motion.div>
  </div>;
}
