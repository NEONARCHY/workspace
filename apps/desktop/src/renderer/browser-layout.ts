import { useCallback, useSyncExternalStore } from "react";

// Compact browser windows and touch tablets use the same labelled menu.
export const browserNavigationQuery = "(max-width: 1023px), (max-width: 1366px) and (any-pointer: coarse)";

export function useBrowserCompactLayout(enabled: boolean, query = browserNavigationQuery) {
  const subscribe = useCallback((notify: () => void) => {
    const media = window.matchMedia?.(query);
    media?.addEventListener("change", notify);
    return () => media?.removeEventListener("change", notify);
  }, [query]);
  const compact = useSyncExternalStore(subscribe,
    () => window.matchMedia?.(query).matches ?? false, () => false);
  return enabled && compact;
}

/** Layout dimensions only. Pinch zoom must not re-layout the application. */
export function observeBrowserViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let frame = 0;
  const update = () => {
    frame = 0;
    if (viewport && viewport.scale !== 1) return;
    root.style.setProperty("--ws-browser-height", `${viewport?.height ?? window.innerHeight}px`);
    root.style.setProperty("--ws-browser-top", `${viewport?.offsetTop ?? 0}px`);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  update();
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  return () => {
    cancelAnimationFrame(frame);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    root.style.removeProperty("--ws-browser-height");
    root.style.removeProperty("--ws-browser-top");
  };
}
