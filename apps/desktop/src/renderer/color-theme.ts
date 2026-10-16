import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import "./color-theme-motion.css";

export type ColorThemePreference = "light" | "dark" | "system";
export type ColorTheme = "light" | "dark";
const prefix = "yuksalish:color-theme:";
const bootstrapKey = "yuksalish:color-theme:last";
const listeners = new Set<() => void>();
const temporaryChoices = new Map<string, ColorThemePreference>();
const isPreference = (value: string | null): value is ColorThemePreference =>
  value === "light" || value === "dark" || value === "system";
const systemQuery = "(prefers-color-scheme: dark)";
let subscribedMedia: MediaQueryList | undefined;
let activePreference: ColorThemePreference = "light";

function readPreference(userId: string | undefined): ColorThemePreference {
  const key = userId ? prefix + userId : bootstrapKey;
  const temporary = temporaryChoices.get(key);
  if (temporary) return temporary;
  try { const value = localStorage.getItem(key); return isPreference(value) ? value : "light"; }
  catch { return "light"; }
}
export function resolveColorTheme(preference: ColorThemePreference): ColorTheme {
  return preference === "system" ? (typeof window.matchMedia === "function" && window.matchMedia(systemQuery).matches ? "dark" : "light") : preference;
}
function notify() { for (const listener of listeners) listener(); }
function systemChanged() {
  if (activePreference !== "system" || resolveColorTheme("system") === document.documentElement.dataset.colorTheme) { notify(); return; }
  void transitionColorTheme(() => flushSync(notify));
}
function storageChanged(event: StorageEvent) {
  if (event.key !== null && !event.key.startsWith(prefix)) return;
  if (event.key === null) temporaryChoices.clear(); else temporaryChoices.delete(event.key);
  notify();
}
function subscribe(listener: () => void) {
  if (!listeners.size) {
    window.addEventListener("storage", storageChanged);
    subscribedMedia = typeof window.matchMedia === "function" ? window.matchMedia(systemQuery) : undefined;
    subscribedMedia?.addEventListener("change", systemChanged);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.removeEventListener("storage", storageChanged);
      subscribedMedia?.removeEventListener("change", systemChanged);
      subscribedMedia = undefined;
    }
  };
}

export function useDocumentColorTheme(): ColorTheme {
  return useSyncExternalStore(useCallback((listener: () => void) => {
    const observer = new MutationObserver(listener);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-theme"] });
    return () => observer.disconnect();
  }, []), () => document.documentElement.dataset.colorTheme === "dark" ? "dark" : "light", () => "light");
}
export function applyColorTheme(theme: ColorTheme) {
  document.documentElement.dataset.colorTheme = theme;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.style.backgroundColor = theme === "dark" ? "#101115" : "";
}
export function initializeColorTheme() { applyColorTheme(resolveColorTheme(readPreference(undefined))); }

// Native document snapshots reveal the new theme without cloning/remounting UI.
let transition: ViewTransition | undefined;
let reveal: Animation | undefined;
let revision = 0;
export async function transitionColorTheme(update: () => void, origin?: { readonly x: number; readonly y: number }): Promise<void> {
  const current = ++revision;
  reveal?.cancel(); reveal = undefined;
  transition?.skipTransition();
  transition = undefined;
  const accessibility = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)") : undefined;
  let updated = false;
  const apply = () => { if (!updated && revision === current) { updated = true; update(); } };
  const root = document.documentElement;
  if (accessibility?.matches || !document.startViewTransition || !root.animate || document.hidden) {
    delete root.dataset.themeTransition;
    apply(); return;
  }
  const width = window.innerWidth, height = window.innerHeight;
  const x = Math.max(0, Math.min(width, origin?.x ?? width / 2));
  const y = Math.max(0, Math.min(height, origin?.y ?? height / 2));
  const radius = Math.ceil(Math.hypot(Math.max(x, width - x), Math.max(y, height - y))) + 2;
  root.dataset.themeTransition = "true";
  const interrupt = () => {
    if (revision !== current || (!document.hidden && !accessibility?.matches)) return;
    reveal?.cancel();
    transition?.skipTransition();
    apply();
  };
  document.addEventListener("visibilitychange", interrupt);
  accessibility?.addEventListener("change", interrupt);
  try {
    const view = document.startViewTransition(apply);
    transition = view;
    void view.finished.catch(() => undefined);
    try { await view.ready; } catch { apply(); return; }
    if (revision !== current) return;
    if (document.hidden || accessibility?.matches) return;
    const animation = root.animate([
      { clipPath: `circle(0px at ${x}px ${y}px)` },
      { clipPath: `circle(${radius}px at ${x}px ${y}px)` },
    ], { duration: 560, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards", pseudoElement: "::view-transition-new(root)" });
    reveal = animation;
    try { await animation.finished; } catch { /* A new choice owns the next wave. */ }
    await view.finished;
  } catch {
    // Unsupported snapshots/animations must never prevent applying the choice.
    apply();
  } finally {
    document.removeEventListener("visibilitychange", interrupt);
    accessibility?.removeEventListener("change", interrupt);
    if (revision === current) {
      reveal?.cancel(); reveal = undefined;
      transition?.skipTransition(); transition = undefined;
      delete root.dataset.themeTransition;
    }
  }
}

export function useColorTheme(userId: string | undefined) {
  const getPreference = useCallback(() => readPreference(userId), [userId]);
  const preference = useSyncExternalStore(subscribe, getPreference, () => "light" as const);
  const getTheme = useCallback(() => resolveColorTheme(readPreference(userId)), [userId]);
  const theme = useSyncExternalStore(subscribe, getTheme, () => "light" as const);
  const setPreference = useCallback((next: ColorThemePreference): boolean => {
    const key = userId ? prefix + userId : bootstrapKey;
    let saved = true;
    try { localStorage.setItem(key, next); localStorage.setItem(bootstrapKey, next); temporaryChoices.delete(key); }
    catch { temporaryChoices.set(key, next); saved = false; }
    applyColorTheme(resolveColorTheme(next));
    notify();
    return saved;
  }, [userId]);
  useLayoutEffect(() => {
    activePreference = preference;
    applyColorTheme(theme);
    // Pre-paint cache for the next launch; employee preferences remain separate.
    try { if (localStorage.getItem(bootstrapKey) !== preference) localStorage.setItem(bootstrapKey, preference); }
    catch { /* This optional launch cache does not replace the live choice. */ }
  }, [theme, preference]);
  return { preference, theme, setPreference };
}
