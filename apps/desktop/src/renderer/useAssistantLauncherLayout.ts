import { useLayoutEffect, useRef, type RefObject } from "react";

const targets = ".workspace-workday-status, .connection-indicator, .context-trigger, .notification-bell-wrap, .color-theme-toggle-wrap, .workspace-workday-person, .workday-control, .workspace-identity, .workspace-identity-menu, .section-jump, .section-jump-trigger, .browser-menu-trigger";

/** Reflow the header once, then animate only its translated controls (never their text size). */
export function useAssistantLauncherLayout(launcher: RefObject<HTMLElement | null>, vacated: boolean, disabled: boolean, zoom: number, geometry: string) {
  const previous = useRef(new Map<HTMLElement, DOMRect>());
  const wasVacated = useRef(vacated);
  const animations = useRef(new Map<HTMLElement, Animation>());
  useLayoutEffect(() => {
    const button = launcher.current;
    const space = button?.closest<HTMLElement>(".assistant-launcher-space");
    const bar = button?.closest<HTMLElement>(".global-bar");
    if (!button || !space || !bar) return;
    const context = button.closest(".workspace-top-context");
    space.style.setProperty("--assistant-launcher-gap", context ? getComputedStyle(context).columnGap : "12px");
    // Compact headers flatten wrappers with display:contents. Animate their real
    // controls, but never both a painted parent and its child (double movement).
    const painted = Array.from(bar.querySelectorAll<HTMLElement>(targets))
      .filter(control => getComputedStyle(control).display !== "contents");
    const controls = painted.filter(control => !painted.some(parent => parent !== control && parent.contains(control)));
    // An interrupted reversal starts from the currently visible positions.
    animations.current.forEach((animation, control) => {
      const visible = control.getBoundingClientRect();
      const old = previous.current.get(control);
      animation.cancel();
      const current = control.getBoundingClientRect();
      if (old) previous.current.set(control, new DOMRect(old.left + visible.left - current.left,
        old.top + visible.top - current.top, old.width, old.height));
    });
    animations.current.clear();
    if (!vacated) {
      const base = space.getBoundingClientRect();
      const left = bar.querySelector(".color-theme-toggle")?.getBoundingClientRect();
      const right = (bar.querySelector(".workspace-workday-person")
        ?? bar.querySelector(".workspace-identity-menu .fui-Avatar"))?.getBoundingClientRect();
      const aligned = left?.width && right?.width && left.right <= base.left && right.left >= base.right
        && Math.abs(left.top + left.height / 2 - (right.top + right.height / 2)) <= 8;
      const offset = aligned ? ((left.right + right.left) / 2 - (base.left + base.width / 2)) / zoom : 0;
      button.style.setProperty("--assistant-launcher-offset", `${offset}px`);
    }
    const changed = wasVacated.current !== vacated;
    wasVacated.current = vacated;
    const next = new Map(controls.map((control) => [control, control.getBoundingClientRect()]));
    if (changed && !disabled && document.visibilityState !== "hidden") {
      next.forEach((bounds, control) => {
        const old = previous.current.get(control);
        if (!old || !bounds.width || typeof control.animate !== "function") return;
        const x = (old.left - bounds.left) / zoom, y = (old.top - bounds.top) / zoom;
        if (Math.abs(x) + Math.abs(y) < .5) return;
        const animation = control.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "translate(0, 0)" }],
          { duration: 320, easing: "cubic-bezier(.2, 0, 0, 1)" });
        animations.current.set(control, animation);
        void animation.finished.then(() => { if (animations.current.get(control) === animation) animations.current.delete(control); }).catch(() => {});
      });
    }
    previous.current = next;
    const measure = () => {
      if (!animations.current.size) previous.current = new Map(controls.map((control) => [control, control.getBoundingClientRect()]));
    };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(bar);
    return () => { observer?.disconnect(); };
  }, [launcher, vacated, disabled, zoom, geometry]);
  useLayoutEffect(() => () => {
    animations.current.forEach((animation) => animation.cancel()); animations.current.clear();
  }, []);
}
