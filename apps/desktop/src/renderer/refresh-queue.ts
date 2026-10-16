/** Coalesce event bursts; never apply a previous account's response after logout/login. */
export function createRefreshQueue<T>(
  load: (token: string) => Promise<T>,
  apply: (value: T) => void,
  currentToken: () => string | undefined,
) {
  const running = new Map<string, { again: boolean; invalidated: boolean; promise: Promise<void> }>();
  const refresh = (token: string, options?: { readonly trailing?: boolean }): Promise<void> => {
    const existing = running.get(token);
    if (existing) {
      if (options?.trailing !== false) existing.again = true;
      return existing.promise;
    }
    const entry = { again: false, invalidated: false, promise: Promise.resolve() };
    entry.promise = (async () => {
      do {
        entry.again = false;
        entry.invalidated = false;
        const value = await load(token);
        if (currentToken() !== token) return;
        // A local committed mutation is newer than this request. Ordinary
        // event bursts still apply intermediate snapshots to avoid starvation.
        if (!entry.invalidated) apply(value);
      } while (entry.again);
    })().finally(() => { running.delete(token); });
    running.set(token, entry);
    return entry.promise;
  };
  return Object.assign(refresh, { invalidate(token: string) {
    const entry = running.get(token);
    if (entry) { entry.invalidated = true; entry.again = true; }
  } });
}
