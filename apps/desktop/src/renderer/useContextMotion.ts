import { useEffect, useLayoutEffect, useRef } from "react";

/** Explicit context changes only: typing, polling and ordinary rerenders stay still. */
export function useContextMotion(key: string, { resize = false, enter = false, rows, duration: resizeDuration, fade = true }: {
  readonly resize?: boolean; readonly enter?: boolean; readonly rows?: string;
  readonly duration?: number; readonly fade?: boolean;
} = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<{ key: string; height: number }>(undefined);
  const animations = useRef<Animation[]>([]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      animations.current.forEach(animation => animation.cancel());
      animations.current = [];
      previous.current = undefined;
      return;
    }
    const old = previous.current;
    const changed = old ? old.key !== key : enter;
    const visibleHeight = node.getBoundingClientRect().height;
    const running = animations.current.some(animation => animation.playState === "running");
    const fromHeight = running ? visibleHeight : old?.height ?? visibleHeight;
    if (changed) {
      animations.current.forEach(animation => animation.cancel());
      animations.current = [];
    }
    const height = node.getBoundingClientRect().height;
    previous.current = { key, height: !changed && running && old ? old.height : height };
    if (!changed || !height || !node.animate || document.visibilityState === "hidden"
      || window.matchMedia?.("(prefers-reduced-motion: reduce), (forced-colors: active)").matches
      || document.activeElement?.matches(":focus-visible")) return;
    const style = getComputedStyle(node);
    const duration = resizeDuration ?? (parseFloat(style.getPropertyValue("--ws-motion-normal")) || 220);
    const easing = style.getPropertyValue("--ws-ease").trim() || "cubic-bezier(.2, 0, 0, 1)";
    // A deliberate, bounded exception for the requested auto-sizing presence
    // list. Text is never scaled, and layout is not driven by React per frame.
    if (resize && old && Math.abs(height - fromHeight) > 1) {
      animations.current.push(node.animate([
        { height: `${fromHeight}px` }, { height: `${height}px` },
      ], { duration, easing }));
    }
    if (!fade) return;
    const targets = rows ? [...node.querySelectorAll<HTMLElement>(rows)].slice(0, 8) : [node];
    targets.forEach((target, index) => {
      animations.current.push(target.animate([
        { opacity: .84, ...(rows ? { transform: "translateY(4px)" } : {}) },
        { opacity: 1, ...(rows ? { transform: "translateY(0)" } : {}) },
      ], { duration: 180, delay: Math.min(index * 24, 96), easing }));
    });
  });

  useEffect(() => {
    const preferences = window.matchMedia?.("(prefers-reduced-motion: reduce), (forced-colors: active)");
    const cancel = () => {
      animations.current.forEach(animation => animation.cancel());
      animations.current = [];
      if (ref.current && previous.current) previous.current.height = ref.current.getBoundingClientRect().height;
    };
    preferences?.addEventListener("change", cancel);
    document.addEventListener("visibilitychange", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      cancel();
      preferences?.removeEventListener("change", cancel);
      document.removeEventListener("visibilitychange", cancel);
      window.removeEventListener("resize", cancel);
    };
  }, []);
  return ref;
}
