// One bounded task per idle slot, never a hidden mounted dialog.
export function scheduleProfileWork(work: () => void, delay = 0): () => void {
  let stopped = false;
  let idle: number | undefined;
  const timer = window.setTimeout(() => {
    if (stopped) return;
    if (window.requestIdleCallback) {
      idle = window.requestIdleCallback(() => { if (!stopped) work(); }, { timeout: 1500 });
    } else work();
  }, delay || 80);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}
