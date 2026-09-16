import { memo, useLayoutEffect, useRef } from "react";

/** Animates only the visual glyphs; assistive technology always receives the exact value. */
export const AnimatedInteger = memo(function AnimatedInteger({ value, className, label }: {
  readonly value: number;
  readonly className?: string;
  readonly label?: string;
}) {
  const visualRef = useRef<HTMLSpanElement>(null);
  const displayed = useRef(value);

  useLayoutEffect(() => {
    const visual = visualRef.current;
    if (!visual) return;
    let frame = 0;
    const from = displayed.current;
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce), (forced-colors: active)");
    const settle = () => {
      cancelAnimationFrame(frame);
      displayed.current = value;
      visual.textContent = String(value);
    };
    if (from === value || media?.matches || document.hidden) { settle(); return; }

    const startedAt = performance.now();
    const duration = 220;
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      visual.textContent = String(Math.round(from + (value - from) * eased));
      if (progress < 1 && !document.hidden && !media?.matches) frame = requestAnimationFrame(step);
      else settle();
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <span className={className} aria-label={label}>
    <span className="amount-accessible">{value}</span>
    <span ref={visualRef} className="integer-visual" aria-hidden="true">{value}</span>
  </span>;
});
