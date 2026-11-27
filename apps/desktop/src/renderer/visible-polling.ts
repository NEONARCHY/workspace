/** One read at a time; hidden pages and disposed screens do not keep polling. */
export function startVisiblePolling<T>(load: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void,
  fail: (error: unknown) => void, interval: number, paused: () => boolean = () => false) {
  let active = true;
  let pending: AbortController | undefined;
  const refresh = () => {
    if (!active || document.hidden || pending || paused()) return;
    const controller = new AbortController(); pending = controller;
    void Promise.resolve().then(() => { controller.signal.throwIfAborted(); return load(controller.signal); }).then(value => {
      if (active && !controller.signal.aborted) apply(value);
    }).catch(error => { if (active && !controller.signal.aborted) fail(error); })
      .finally(() => { if (pending === controller) pending = undefined; });
  };
  const visibility = () => {
    if (document.hidden) { pending?.abort(); pending = undefined; } else refresh();
  };
  refresh();
  const timer = window.setInterval(refresh, interval);
  document.addEventListener("visibilitychange", visibility);
  const invalidate = () => { pending?.abort(); pending = undefined; };
  return Object.assign(() => { active = false; invalidate(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visibility); }, { refresh, invalidate });
}
