import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

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
  document.documentElement.style.backgroundColor = theme === "dark" ? "#0b1724" : "";
}
export function initializeColorTheme() { applyColorTheme(resolveColorTheme(readPreference(undefined))); }

// Fade the live document, not a replacement React tree. Dialogs, drafts, focus,
// media and drag state retain their identity. Rapid changes retarget the fade.
let transition: Animation | undefined;
let revision = 0;
export async function transitionColorTheme(update: () => void): Promise<void> {
  const current = ++revision;
  const opacity = getComputedStyle(document.body).opacity;
  transition?.cancel();
  transition = undefined;
  const accessibility = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)") : undefined;
  if (accessibility?.matches || typeof document.body.animate !== "function" || document.hidden) { update(); return; }
  let updated = false;
  const apply = () => { if (!updated) { updated = true; update(); } };
  const interrupt = () => {
    if (revision !== current || (!document.hidden && !accessibility?.matches)) return;
    transition?.cancel(); transition = undefined;
    apply(); // A hidden tab or newly enabled reduced-motion mode must not wait.
  };
  document.addEventListener("visibilitychange", interrupt);
  accessibility?.addEventListener("change", interrupt);
  try {
    const out = document.body.animate([{ opacity }, { opacity: 0 }],
      { duration: 120, easing: "cubic-bezier(.2,0,0,1)", fill: "forwards" });
    transition = out;
    try { await out.finished; } catch { return; }
    if (revision !== current) return;
    apply(); out.cancel();
    if (document.hidden || accessibility?.matches) return;
    const inside = document.body.animate([{ opacity: 0 }, { opacity: 1 }],
      { duration: 200, easing: "cubic-bezier(.2,0,0,1)" });
    transition = inside;
    try { await inside.finished; } catch { /* A later choice owns the fade. */ }
  } finally {
    document.removeEventListener("visibilitychange", interrupt);
    accessibility?.removeEventListener("change", interrupt);
    if (revision === current) { transition?.cancel(); transition = undefined; }
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
