import { useEffect, type RefObject } from "react";

/** The same damped pointer-following feel as achievement cards, without foil,
 * text scaling, React renders per frame or interference with board dragging. */
export function useCardTilt(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const forced = window.matchMedia?.("(forced-colors: active)");
    let frame = 0;
    let previousTime: number | undefined;
    let followingPointer = false;
    let x = 0, y = 0, targetX = 0, targetY = 0;
    let bounds: DOMRect | undefined;
    const paint = (timestamp: number) => {
      const frameDuration = 1000 / 60;
      const elapsed = previousTime === undefined ? frameDuration : Math.max(0, Math.min(48, timestamp - previousTime));
      previousTime = timestamp;
      // Keep the same feel on 60/120/144 Hz screens. Returning is deliberately
      // softer than pointer tracking, and never clears the current rotation.
      const blend = 1 - Math.pow(1 - (followingPointer ? .12 : .09), elapsed / frameDuration);
      x += (targetX - x) * blend;
      y += (targetY - y) * blend;
      const moving = Math.abs(targetX - x) > .002 || Math.abs(targetY - y) > .002;
      if (!moving) { x = targetX; y = targetY; }
      element.style.setProperty("--ws-card-tilt-x", `${-y * 12}deg`);
      element.style.setProperty("--ws-card-tilt-y", `${x * 16}deg`);
      frame = moving ? requestAnimationFrame(paint) : 0;
      if (!moving) previousTime = undefined;
    };
    const schedule = () => { if (!frame) { previousTime = undefined; frame = requestAnimationFrame(paint); } };
    const reset = () => { followingPointer = false; targetX = targetY = 0; bounds = undefined; schedule(); };
    const clear = () => {
      cancelAnimationFrame(frame); frame = 0;
      previousTime = undefined; followingPointer = false;
      x = y = targetX = targetY = 0; bounds = undefined;
      element.style.removeProperty("--ws-card-tilt-x");
      element.style.removeProperty("--ws-card-tilt-y");
    };
    const syncPreference = () => {
      clear();
      element.classList.toggle("has-pointer-tilt", !reduced?.matches && !forced?.matches);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.buttons || reduced?.matches || forced?.matches) return;
      bounds ??= element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      followingPointer = true;
      targetX = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
      targetY = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
      schedule();
    };
    const visibility = () => { if (document.hidden) clear(); };
    syncPreference();
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", reset);
    element.addEventListener("pointerdown", clear);
    element.addEventListener("pointercancel", clear);
    reduced?.addEventListener("change", syncPreference);
    forced?.addEventListener("change", syncPreference);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clear(); element.classList.remove("has-pointer-tilt");
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", reset);
      element.removeEventListener("pointerdown", clear);
      element.removeEventListener("pointercancel", clear);
      reduced?.removeEventListener("change", syncPreference);
      forced?.removeEventListener("change", syncPreference);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [ref, enabled]);
}
