import { memo, useLayoutEffect, useRef } from "react";
import { formatMinorUnits } from "./approval-board";

export const amountAnimationMs = 260;

/** Interpolate integer hundredths, without converting the amount to a JS number. */
export function interpolateMinorUnits(from: bigint, to: bigint, progress: number): bigint {
  const clamped = Math.max(0, Math.min(1, progress));
  const eased = BigInt(Math.round((1 - (1 - clamped) ** 3) * 1_000_000));
  return from + (to - from) * eased / 1_000_000n;
}

/** Only this visual text node changes per frame; the board does not re-render. */
export const AnimatedAmount = memo(function AnimatedAmount({ minorUnits, currency }: {
  readonly minorUnits: bigint | null;
  readonly currency: string;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const visualRef = useRef<HTMLSpanElement>(null);
  const displayed = useRef({ minorUnits, currency });
  const formatted = formatMinorUnits(minorUnits, currency);

  useLayoutEffect(() => {
    const root = rootRef.current, visual = visualRef.current;
    if (!root || !visual) return;
    let frame = 0;
    const from = displayed.current.currency === currency ? displayed.current.minorUnits : null;
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce), (forced-colors: active)");
    const settle = () => {
      cancelAnimationFrame(frame);
      visual.textContent = formatted;
      displayed.current = { minorUnits, currency };
      delete root.dataset.animating;
    };
    const bounds = root.getBoundingClientRect();
    const offscreen = bounds.bottom < 0 || bounds.top > window.innerHeight || bounds.right < 0 || bounds.left > window.innerWidth;
    if (from === null || minorUnits === null || from === minorUnits || media?.matches || document.hidden || offscreen) {
      settle(); return;
    }

    const startedAt = performance.now();
    visual.textContent = formatMinorUnits(from, currency);
    root.dataset.animating = "true";
    const step = (now: number) => {
      const progress = (now - startedAt) / amountAnimationMs;
      if (progress >= 1 || document.hidden || media?.matches) { settle(); return; }
      const current = interpolateMinorUnits(from, minorUnits, progress);
      displayed.current = { minorUnits: current, currency };
      visual.textContent = formatMinorUnits(current, currency);
      frame = requestAnimationFrame(step);
    };
    const stopIfHidden = () => { if (document.hidden) settle(); };
    const stopIfReduced = () => { if (media?.matches) settle(); };
    document.addEventListener("visibilitychange", stopIfHidden);
    media?.addEventListener("change", stopIfReduced);
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      delete root.dataset.animating;
      document.removeEventListener("visibilitychange", stopIfHidden);
      media?.removeEventListener("change", stopIfReduced);
    };
  }, [minorUnits, currency, formatted]);

  return <strong ref={rootRef} className="animated-amount" data-total-currency={currency} data-total-value={formatted} title={formatted}>
    {/* Assistive technology gets the exact total, never intermediate frame values. */}
    <span className="amount-accessible">{formatted}</span>
    <span className="amount-visual" aria-hidden="true" ref={visualRef}>{formatted}</span>
  </strong>;
});
