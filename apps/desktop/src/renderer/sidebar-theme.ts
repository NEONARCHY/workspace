import { useCallback, useSyncExternalStore } from "react";

export type SidebarTheme = "blue-teal" | "navy" | "light";
export const defaultSidebarTheme: SidebarTheme = "blue-teal";
const prefix = "yuksalish:sidebar-theme:";
const listeners = new Set<() => void>();
// Storage can be unavailable in private/restricted profiles. Keep the live choice.
const sessionChoices = new Map<string, SidebarTheme>();
const isTheme = (value: string | null): value is SidebarTheme =>
  value === "blue-teal" || value === "navy" || value === "light";

function readTheme(userId: string | undefined): SidebarTheme {
  if (!userId) return defaultSidebarTheme;
  const key = prefix + userId;
  const temporary = sessionChoices.get(key);
  if (temporary) return temporary;
  try {
    const value = localStorage.getItem(key);
    return isTheme(value) ? value : defaultSidebarTheme;
  } catch { return defaultSidebarTheme; }
}

const notify = () => { for (const listener of listeners) listener(); };
function onStorage(event: StorageEvent) {
  if (event.key !== null && !event.key.startsWith(prefix)) return;
  if (event.key === null) sessionChoices.clear();
  else sessionChoices.delete(event.key);
  notify();
}
function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}

export function useSidebarTheme(userId: string | undefined) {
  const getSnapshot = useCallback(() => readTheme(userId), [userId]);
  const theme = useSyncExternalStore(subscribe, getSnapshot, () => defaultSidebarTheme);
  const setTheme = useCallback((next: SidebarTheme): boolean => {
    if (!userId) return false;
    const key = prefix + userId;
    let saved = true;
    try { localStorage.setItem(key, next); sessionChoices.delete(key); }
    catch { sessionChoices.set(key, next); saved = false; }
    notify();
    return saved;
  }, [userId]);
  return { theme, setTheme };
}
