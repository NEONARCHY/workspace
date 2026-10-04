import { useEffect } from "react";

const dialogSelector = '.fui-DialogSurface, [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
const preferenceQuery = "(prefers-reduced-motion: reduce), (forced-colors: active)";
interface Size { readonly width: number; readonly height: number }
interface TrackedDialog {
  readonly node: HTMLElement;
  readonly resize: ResizeObserver;
  readonly mutation: MutationObserver;
  size: Size;
  animation?: Animation;
  bodyAnimation?: Animation;
}
const naturalSize = (node: HTMLElement): Size => ({ width: node.offsetWidth, height: node.offsetHeight });

/** Auto-sizing dialog frames only. No text scaling, DOM cloning or React renders per frame. */
export function observeDialogResizeMotion(root: HTMLElement) {
  const tracked = new Map<HTMLElement, TrackedDialog>();
  const pending = new Set<TrackedDialog>();
  const preferences = window.matchMedia?.(preferenceQuery);
  let frame = 0, viewportChanging = false, nativeResize = false;

  const cancel = (item: TrackedDialog) => {
    if (item.animation) { item.animation.onfinish = null; item.animation.cancel(); item.animation = undefined; }
    item.bodyAnimation?.cancel(); item.bodyAnimation = undefined;
  };
  const measure = (item: TrackedDialog) => {
    const { node } = item;
    if (!node.isConnected) return;
    const running = item.animation?.playState === "running";
    const rect = node.getBoundingClientRect();
    const from = running ? { width: rect.width, height: rect.height } : item.size;
    // Briefly remove only our effect to measure auto layout, then restore it
    // synchronously. Unchanged typing/polling must not restart a running tween.
    const active = running ? item.animation : undefined;
    const effect = active?.effect ?? null;
    const bodyEffect = item.bodyAnimation?.effect ?? null;
    if (active) active.effect = null;
    if (item.bodyAnimation) item.bodyAnimation.effect = null;
    const next = naturalSize(node);
    if (active) active.effect = effect;
    if (item.bodyAnimation) item.bodyAnimation.effect = bodyEffect;
    if (active && Math.abs(next.width - item.size.width) <= 1 && Math.abs(next.height - item.size.height) <= 1) return;
    cancel(item);
    item.size = next;
    if (!from.width || !from.height || !next.width || !next.height || !node.animate
      || document.visibilityState === "hidden" || preferences?.matches || viewportChanging || nativeResize
      || node.dataset.dialogResizeMotion === "off" || rect.bottom <= 0 || rect.top >= window.innerHeight) return;
    const widthChanged = Math.abs(next.width - from.width) > 1;
    const heightChanged = Math.abs(next.height - from.height) > 1;
    if (!widthChanged && !heightChanged) return;
    const style = getComputedStyle(node);
    const duration = Math.min(260, Math.max(160, parseFloat(style.getPropertyValue("--ws-motion-normal")) || 220));
    const easing = style.getPropertyValue("--ws-ease").trim() || "cubic-bezier(.2, 0, 0, 1)";
    // Explicit owner-requested exception to transform/opacity: one bounded
    // frame needs real layout dimensions, so its glyphs remain unscaled.
    const animation = node.animate([
      { ...(widthChanged ? { width: `${from.width}px` } : {}), ...(heightChanged ? { height: `${from.height}px` } : {}) },
      { ...(widthChanged ? { width: `${next.width}px` } : {}), ...(heightChanged ? { height: `${next.height}px` } : {}) },
    ], { duration, easing });
    item.animation = animation;
    const body = node.querySelector<HTMLElement>(":scope > .fui-DialogBody");
    if (heightChanged && body?.animate) {
      const inset = [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth]
        .reduce((total, value) => total + (parseFloat(value) || 0), 0);
      // Fluent's grid/flex body follows the same frame. Its scrollable content
      // absorbs the difference instead of spilling buttons outside the frame.
      item.bodyAnimation = body.animate([
        { height: `${Math.max(0, from.height - inset)}px` },
        { height: `${Math.max(0, next.height - inset)}px` },
      ], { duration, easing });
    }
    animation.onfinish = () => {
      if (item.animation !== animation) return;
      item.animation = undefined;
      item.bodyAnimation?.cancel(); item.bodyAnimation = undefined;
      // Natural sizing resumes; an image/font/content change during the
      // transition is reconciled without retaining a pixel height.
      schedule(item);
    };
  };
  function schedule(item: TrackedDialog) {
    pending.add(item);
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      pending.forEach(measure);
      pending.clear();
      viewportChanging = false;
    });
  }
  const discover = (node: HTMLElement) => {
    for (const element of [node, ...node.querySelectorAll<HTMLElement>(dialogSelector)]) {
      if (!element.matches(dialogSelector) || tracked.has(element)) continue;
      const resize = new ResizeObserver(() => {
        const item = tracked.get(element);
        // Our own size interpolation must not recursively restart itself.
        if (item && item.animation?.playState !== "running") schedule(item);
      });
      const mutation = new MutationObserver(() => {
        const item = tracked.get(element);
        if (item) schedule(item);
      });
      const item: TrackedDialog = { node: element, resize, mutation, size: naturalSize(element) };
      tracked.set(element, item);
      resize.observe(element);
      const body = element.querySelector<HTMLElement>(".fui-DialogBody");
      if (body) resize.observe(body);
      mutation.observe(element, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "open"] });
    }
  };
  const remove = (item: TrackedDialog) => {
    cancel(item); item.resize.disconnect(); item.mutation.disconnect(); pending.delete(item); tracked.delete(item.node);
  };
  const mutation = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement) discover(node);
    tracked.forEach(item => { if (!root.contains(item.node)) remove(item); });
  });
  const reset = () => tracked.forEach(item => { cancel(item); item.size = naturalSize(item.node); });
  const onViewportResize = () => {
    viewportChanging = true; reset(); tracked.forEach(schedule);
  };
  const onLoad = (event: Event) => {
    if (event.target instanceof HTMLElement) tracked.forEach(item => { if (item.node.contains(event.target as HTMLElement)) schedule(item); });
  };
  const onFonts = () => tracked.forEach(schedule);
  const onPointerDown = (event: PointerEvent) => {
    if (!(event.target instanceof HTMLTextAreaElement)) return;
    const rect = event.target.getBoundingClientRect();
    if (event.clientX >= rect.right - 20 && event.clientY >= rect.bottom - 20) { nativeResize = true; reset(); }
  };
  const onPointerUp = () => { if (nativeResize) { reset(); nativeResize = false; } };
  mutation.observe(root, { subtree: true, childList: true });
  discover(root);
  preferences?.addEventListener("change", reset);
  document.addEventListener("visibilitychange", reset);
  window.addEventListener("resize", onViewportResize);
  root.addEventListener("load", onLoad, true);
  document.fonts?.addEventListener("loadingdone", onFonts);
  root.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("blur", onPointerUp);
  return () => {
    mutation.disconnect(); tracked.forEach(remove); cancelAnimationFrame(frame); pending.clear();
    preferences?.removeEventListener("change", reset);
    document.removeEventListener("visibilitychange", reset);
    window.removeEventListener("resize", onViewportResize);
    root.removeEventListener("load", onLoad, true);
    document.fonts?.removeEventListener("loadingdone", onFonts);
    root.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("blur", onPointerUp);
  };
}

export function DialogResizeMotion() {
  useEffect(() => observeDialogResizeMotion(document.body), []);
  return null;
}
