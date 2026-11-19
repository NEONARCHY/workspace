import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@fluentui/react-components";
import type { WorkspaceNotification } from "@yuksalish/contracts";
import "./progressive-notifications.css";

export const NOTIFICATION_BATCH_SIZE = 15;

/** Page-local cards only. Leaving the section releases the list and its observer. */
export function ProgressiveNotificationList({ items, children }: {
  readonly items: readonly WorkspaceNotification[];
  readonly children: (item: WorkspaceNotification) => ReactNode;
}) {
  const [limit, setLimit] = useState(NOTIFICATION_BATCH_SIZE);
  const stream = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const manualFocusIndex = useRef<number | null>(null);
  const requestedAt = useRef(-1);
  const shown = Math.min(limit, items.length);
  const hasMore = shown < items.length;
  const loadMore = useCallback((manual = false) => {
    if (!hasMore || requestedAt.current === shown) return;
    requestedAt.current = shown;
    if (manual) manualFocusIndex.current = shown;
    setLimit(current => current + NOTIFICATION_BATCH_SIZE);
  }, [hasMore, shown]);

  useEffect(() => {
    const index = manualFocusIndex.current;
    if (index === null) return;
    manualFocusIndex.current = null;
    stream.current?.querySelectorAll<HTMLButtonElement>(".notification-open")[index]?.focus();
  }, [shown]);

  useEffect(() => {
    const node = sentinel.current;
    const scrollArea = stream.current;
    if (!hasMore || !node || !scrollArea || !window.IntersectionObserver) return;
    let active = true;
    let requested = false;
    // Desktop has an inner rail; compact layouts can use the enclosing page.
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

  return <div className="notification-stream" ref={stream}>
    {items.slice(0, shown).map(children)}
    {hasMore ? <div className="notification-load-more" ref={sentinel}>
      <span aria-live="polite">Показано {shown} из {items.length}</span>
      <Button onClick={() => loadMore(true)}>
        Показать ещё {Math.min(NOTIFICATION_BATCH_SIZE, items.length - shown)}
      </Button>
    </div> : null}
  </div>;
}
