import { useSyncExternalStore } from "react";

const query = "(max-width: 1180px)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia?.(query);
  media?.addEventListener("change", notify);
  return () => media?.removeEventListener("change", notify);
};
export function useCompactWindow() {
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? false, () => false);
}
