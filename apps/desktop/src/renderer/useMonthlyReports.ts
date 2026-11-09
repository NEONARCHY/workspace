import { useCallback, useEffect, useRef, useState } from "react";
import type { MonthlyOverview } from "@yuksalish/contracts";
import { loadMonthlyReports } from "./workspace-api";

export function useMonthlyReports(token: string | undefined, enabled: boolean) {
  const [state, setState] = useState<{ token: string; data?: MonthlyOverview; error?: string }>();
  const requests = useRef({ generation: 0 });
  const refresh = useCallback(async () => {
    if (!token || !enabled) return;
    const current = ++requests.current.generation;
    try {
      const data = await loadMonthlyReports(token);
      if (requests.current.generation === current) setState({ token, data });
    } catch (error) {
      if (requests.current.generation === current) setState(previous => ({ token,
        data: previous?.token === token ? previous.data : undefined,
        error: error instanceof Error ? error.message : "Не удалось загрузить отчёты" }));
    }
  }, [token, enabled]);
  useEffect(() => {
    if (!enabled || !token) return;
    const pending = requests.current;
    const visible = () => { if (document.visibilityState !== "hidden") void refresh(); };
    visible();
    const timer = window.setInterval(visible, 30_000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => { ++pending.generation; window.clearInterval(timer); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [token, enabled, refresh]);
  const current = enabled && state?.token === token ? state : undefined;
  return { data: current?.data, error: current?.error, loading: enabled && !current, refresh };
}
export type MonthlyReportsResource = ReturnType<typeof useMonthlyReports>;

export function useMonthlyReportWindow(userId: string | undefined) {
  const [owner, setOwner] = useState<string>();
  const target = useRef<HTMLElement | null>(null);
  const frame = useRef<number | undefined>(undefined);
  const show = useCallback((launcher?: HTMLElement) => {
    if (frame.current !== undefined) window.cancelAnimationFrame(frame.current);
    target.current = launcher ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setOwner(userId);
  }, [userId]);
  const hide = useCallback(() => setOwner(undefined), []);
  const afterClose = useCallback((closedSurface?: HTMLElement | null) => {
    if (frame.current !== undefined) window.cancelAnimationFrame(frame.current);
    let attempts = 0;
    const restore = () => {
      // Fluent finishes exit motion before React/Tabster remove the old modal.
      // Wait for that surface to detach; another open dialog keeps its own focus.
      if (closedSurface?.isConnected && attempts++ < 20) {
        frame.current = window.requestAnimationFrame(restore);
        return;
      }
      frame.current = undefined;
      if (target.current?.isConnected && !document.querySelector('[role="dialog"]')) target.current.focus({ preventScroll: true });
    };
    frame.current = window.requestAnimationFrame(restore);
  }, []);
  useEffect(() => () => { if (frame.current !== undefined) window.cancelAnimationFrame(frame.current); }, [userId]);
  return { open: Boolean(userId && owner === userId), show, hide, afterClose };
}
