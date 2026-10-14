import { useCallback, useEffect, useState } from "react";

/** Public read-only snapshots: pause hidden tabs, abort old sessions, retain errors. */
export function useContextSnapshot<T>(token: string,
  load: (token: string, signal?: AbortSignal) => Promise<T>, interval: number) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ token: string; value?: T; error?: string; pending: boolean }>({ token, pending: true });
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true;
    let running = false;
    let lastRead = 0;
    const abort = new AbortController();
    const read = () => {
      if (document.visibilityState === "hidden" || running) return;
      running = true;
      setState(current => ({ token, value: current.token === token ? current.value : undefined, pending: true }));
      void load(token, abort.signal).then(value => {
        if (active) { lastRead = Date.now(); setState({ token, value, pending: false }); }
      }).catch((error: unknown) => {
        if (active) setState(current => ({ ...current, pending: false,
          error: error instanceof Error ? error.message : "Данные временно недоступны" }));
      }).finally(() => { running = false; });
    };
    const visible = () => { if (Date.now() - lastRead >= interval) read(); };
    read();
    const timer = window.setInterval(read, interval);
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; abort.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [token, load, interval, revision]);
  return { ...(state.token === token ? state : { token, pending: true }), refresh };
}
