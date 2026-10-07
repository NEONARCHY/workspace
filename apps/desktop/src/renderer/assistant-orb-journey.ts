import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { hasBlockingDialog } from "./components/ui/use-blocking-dialog";

export type OrbJourneyPhase = "closed" | "waiting" | "travelling" | "revealing" | "ready" | "docking" | "returning";
export interface OrbPose { readonly x: number; readonly y: number; readonly size: number }
const ORB_SIZE = 96;
const EASING = "cubic-bezier(.2, 0, 0, 1)";

export function orbPose(rect: Pick<DOMRect, "left" | "top" | "width" | "height">, zoom: number): OrbPose {
  return { x: (rect.left + rect.width / 2) / zoom, y: (rect.top + rect.height / 2) / zoom,
    size: Math.min(rect.width, rect.height) / zoom };
}
export function orbTransform(pose: OrbPose) {
  return `translate(${pose.x - ORB_SIZE / 2}px, ${pose.y - ORB_SIZE / 2}px) scale(${pose.size / ORB_SIZE})`;
}
export function orbReveal(pose: OrbPose, panel: DOMRect, zoom: number) {
  const x = pose.x - panel.left / zoom, y = pose.y - panel.top / zoom;
  const radius = Math.hypot(Math.max(x, panel.width / zoom - x), Math.max(y, panel.height / zoom - y));
  return [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`];
}

/** One persistent canvas, measured destination slots, and cancellable transform-only travel. */
export function useAssistantOrbJourney({ open, ready, empty, blocked, reducedMotion, zoom, geometryKey,
  launcher, panel, header, welcome, visual }: {
  readonly open: boolean; readonly ready: boolean; readonly empty: boolean; readonly blocked: boolean;
  readonly reducedMotion: boolean; readonly zoom: number; readonly geometryKey: string;
  readonly launcher: RefObject<HTMLElement | null>; readonly panel: RefObject<HTMLElement | null>;
  readonly header: RefObject<HTMLElement | null>; readonly welcome: RefObject<HTMLElement | null>;
  readonly visual: RefObject<HTMLElement | null>;
}) {
  const [phase, setPhase] = useState<OrbJourneyPhase>("closed");
  const phaseRef = useRef<OrbJourneyPhase>("closed");
  const revealedRef = useRef(false);
  const geometryRef = useRef(geometryKey);
  useLayoutEffect(() => {
    let active = true;
    const animations = new Set<Animation>();
    const element = visual.current;
    const panelElement = panel.current;
    if (!element) return;
    const resized = geometryRef.current !== geometryKey;
    const returning = !open && phaseRef.current !== "closed";
    geometryRef.current = geometryKey;
    const set = (next: OrbJourneyPhase) => {
      if (!active) return;
      phaseRef.current = next; setPhase(next);
    };
    const slot = () => open && ready && !blocked ? empty ? welcome.current : header.current : launcher.current;
    const place = () => {
      const destination = slot();
      if (!destination) return;
      const bounds = destination.getBoundingClientRect();
      if (!bounds.width) return;
      element.style.transform = orbTransform(orbPose(bounds, zoom));
      element.style.opacity = "1";
      element.style.clipPath = "none";
      if (open && empty && phaseRef.current === "ready") {
        const stream = panelElement?.querySelector(".assistant-stream")?.getBoundingClientRect();
        if (stream) element.style.clipPath = `inset(${Math.max(0, stream.top - bounds.top) / bounds.height * 100}% 0 ${Math.max(0, bounds.bottom - stream.bottom) / bounds.height * 100}% 0)`;
      }
    };
    const animate = async (target: HTMLElement, keyframes: Keyframe[], duration: number) => {
      const animation = target.animate(keyframes, { duration, easing: EASING });
      animations.add(animation);
      try { await animation.finished; } catch { /* Cancellation owns the next destination. */ }
      animations.delete(animation);
    };
    const fly = async (to: OrbPose) => {
      const from = orbPose(element.getBoundingClientRect(), zoom);
      element.style.transform = orbTransform(to);
      element.style.opacity = "1";
      element.style.clipPath = "none";
      if (reducedMotion || resized || !element.animate || !from.size
        || Math.hypot(from.x - to.x, from.y - to.y) + Math.abs(from.size - to.size) < .5) return;
      // Enter/leave the header from below its icon slot, never fly across its copy.
      const docking = open && revealedRef.current;
      const middle = { x: docking ? (empty ? from.x : to.x) - 18
        : (from.x + to.x) / 2 + Math.sign(to.x - from.x) * 18,
        y: (from.y + to.y) / 2 - (docking ? 0 : 24), size: (from.size + to.size) / 2 };
      await animate(element, [from, middle, to].map((pose) => ({ transform: orbTransform(pose) })), 420);
    };
    const finish = () => {
      set(open ? "ready" : "closed");
      place();
      if (returning && !hasBlockingDialog() && document.visibilityState !== "hidden") launcher.current?.focus({ preventScroll: true });
    };
    const run = async () => {
      if (!active) return;
      if (blocked || (open && !ready)) { place(); set(open ? "waiting" : "closed"); return; }
      const destination = slot();
      const bounds = destination?.getBoundingClientRect();
      if (!destination || !bounds?.width) { revealedRef.current = open; finish(); return; }
      const to = orbPose(bounds, zoom);
      if (!open) {
        const wasRevealed = revealedRef.current;
        revealedRef.current = false;
        if (!wasRevealed && phaseRef.current === "closed") { place(); return; }
        set("returning"); await fly(to);
        if (active) finish();
        return;
      }
      const opening = !revealedRef.current;
      set(opening ? "travelling" : "docking");
      await fly(to);
      if (!active) return;
      if (opening && panel.current && !reducedMotion && !resized && typeof panel.current.animate === "function") {
        set("revealing");
        const masks = orbReveal(to, panel.current.getBoundingClientRect(), zoom);
        await animate(panel.current, [{ clipPath: masks[0], opacity: 0 },
          { clipPath: masks[1], opacity: 1 }], 320);
        if (!active) return;
      }
      revealedRef.current = true;
      finish();
    };
    // Measure after the DOM commit, before painting; never update React on animation frames.
    queueMicrotask(() => { void run(); });
    const update = () => {
      if (phaseRef.current === "ready" || phaseRef.current === "closed") place();
    };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    [launcher.current, panelElement, panelElement?.querySelector(".assistant-stream"),
      panelElement?.querySelector(".assistant-header")].forEach((target) => { if (target) observer?.observe(target); });
    panelElement?.addEventListener("scroll", update, true);
    const settleHidden = () => { if (document.visibilityState === "hidden") animations.forEach((animation) => animation.finish()); };
    document.addEventListener("visibilitychange", settleHidden);
    return () => {
      active = false;
      // Pin the visible intermediate pose before cancelling, so rapid reversal never jumps.
      if (animations.size) element.style.transform = orbTransform(orbPose(element.getBoundingClientRect(), zoom));
      animations.forEach((animation) => animation.cancel());
      observer?.disconnect(); panelElement?.removeEventListener("scroll", update, true);
      document.removeEventListener("visibilitychange", settleHidden);
    };
  }, [open, ready, empty, blocked, reducedMotion, zoom, geometryKey, launcher, panel, header, welcome, visual]);
  return phase;
}
