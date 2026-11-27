import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export const PROGRESSIVE_BATCH_SIZE = 15;

/** Mount batches in the real scroll rail; filter changes and unmount release the window. */
export function useProgressiveList(itemCount: number, resetKey: string, focusSelector: string) {
  const [page, setPage] = useState({ key: resetKey, limit: PROGRESSIVE_BATCH_SIZE });
  if (page.key !== resetKey) setPage({ key: resetKey, limit: PROGRESSIVE_BATCH_SIZE });
  const stream = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const requestedAt = useRef<{ key: string; shown: number } | null>(null);
  const manualFocus = useRef<{ key: string; index: number } | null>(null);
  const shown = Math.min(page.key === resetKey ? page.limit : PROGRESSIVE_BATCH_SIZE, itemCount);
  const hasMore = shown < itemCount;
  const loadMore = useCallback((manual = false) => {
    if (!hasMore || requestedAt.current?.key === resetKey && requestedAt.current.shown === shown) return;
    requestedAt.current = { key: resetKey, shown };
    if (manual) manualFocus.current = { key: resetKey, index: shown };
    setPage(current => current.key === resetKey ? { ...current, limit: current.limit + PROGRESSIVE_BATCH_SIZE } : current);
  }, [hasMore, shown, resetKey]);

  useLayoutEffect(() => {
    requestedAt.current = null;
    manualFocus.current = null;
    if (stream.current) stream.current.scrollTop = 0;
  }, [resetKey]);
  useEffect(() => {
    const target = manualFocus.current;
    manualFocus.current = null;
    if (target?.key === resetKey) stream.current?.querySelectorAll<HTMLElement>(focusSelector)[target.index]?.focus();
  }, [shown, resetKey, focusSelector]);
  useEffect(() => {
    const node = sentinel.current, scrollArea = stream.current;
    if (!hasMore || !node || !scrollArea || !window.IntersectionObserver) return;
    let active = true, requested = false;
    const root = /auto|scroll/.test(getComputedStyle(scrollArea).overflowY) ? scrollArea : null;
    const observer = new IntersectionObserver(entries => {
      if (!active || requested || !entries.some(entry => entry.isIntersecting)) return;
      requested = true;
      observer.disconnect();
      loadMore();
    }, { root, rootMargin: "160px 0px" });
    observer.observe(node);
    return () => { active = false; observer.disconnect(); };
  }, [hasMore, shown, loadMore]);
  return { stream, sentinel, shown, hasMore, loadMore };
}
