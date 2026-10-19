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
  void transitionColorTheme(notify);
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

// Apply theme changes in place; do not snapshot or animate the whole document.
let revision = 0;
export async function transitionColorTheme(update: () => void): Promise<void> {
  const current = ++revision;
  const root = document.documentElement;
  const accessibility = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)")
    : undefined;
  if (document.hidden || accessibility?.matches) {
    try { update(); }
    finally { if (revision === current) delete root.dataset.themeTransition; }
    return;
  }
  root.dataset.themeTransition = "true";
  try {
    update();
  } catch (error) {
    if (revision === current) delete root.dataset.themeTransition;
    throw error;
  }

  if (document.hidden || typeof window.requestAnimationFrame !== "function") {
    if (revision === current) delete root.dataset.themeTransition;
    return;
  }

  await new Promise<void>((resolve) => {
    let frame: number | undefined;
    let suppressionPainted = false;
    const finish = () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (revision === current) delete root.dataset.themeTransition;
      resolve();
    };
    const schedule = () => {
      if (frame === undefined && !document.hidden) frame = window.requestAnimationFrame(() => {
        frame = undefined;
        if (!suppressionPainted) {
          suppressionPainted = true;
          schedule();
        } else {
          finish();
        }
      });
    };
    const onVisibilityChange = () => {
      if (document.hidden && frame !== undefined) {
        window.cancelAnimationFrame(frame);
        frame = undefined;
      } else {
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule();
  });
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
