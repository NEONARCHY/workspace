/** Coalesce event bursts; never apply a previous account's response after logout/login. */
export function createRefreshQueue<T>(
  load: (token: string) => Promise<T>,
  apply: (value: T) => void,
  currentToken: () => string | undefined,
) {
  const running = new Map<string, { again: boolean; promise: Promise<void> }>();
  return (token: string): Promise<void> => {
    const existing = running.get(token);
    if (existing) {
      existing.again = true;
      return existing.promise;
    }
    const entry = { again: false, promise: Promise.resolve() };
    entry.promise = (async () => {
      do {
        entry.again = false;
        const value = await load(token);
        if (currentToken() !== token) return;
        apply(value);
      } while (entry.again);
    })().finally(() => { running.delete(token); });
    running.set(token, entry);
    return entry.promise;
  };
}
