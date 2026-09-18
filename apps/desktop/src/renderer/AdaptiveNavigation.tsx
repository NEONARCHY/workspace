import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal24Regular } from "@fluentui/react-icons";

export interface AdaptiveNavigationItem {
  readonly key: string;
  readonly label: string;
}

export function AdaptiveNavigation<T extends AdaptiveNavigationItem>({
  items,
  renderItem,
}: {
  readonly items: readonly T[];
  readonly renderItem: (item: T, inOverflow: boolean) => ReactNode;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const slotHeight = 50;
      if (container.clientHeight <= 0) {
        setVisibleCount(items.length);
        return;
      }
      const capacity = Math.max(1, Math.floor(container.clientHeight / slotHeight));
      setVisibleCount(items.length <= capacity ? items.length : Math.max(0, capacity - 1));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [items.length]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        moreRef.current?.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  const visible = items.slice(0, visibleCount);
  const overflow = items.slice(visibleCount);
  const drawerOpen = open && overflow.length > 0;
  return <nav ref={containerRef} className="rail-nav personal-rail-nav adaptive-rail-nav">
    {visible.map((item) => renderItem(item, false))}
    {overflow.length ? <div className="rail-slot rail-more-slot">
      <button ref={moreRef} type="button" className={`rail-action rail-more-action ${drawerOpen ? "active" : ""}`}
        aria-label={`Ещё, ${overflow.length} разделов`} aria-expanded={drawerOpen} aria-controls="rail-more-drawer" onClick={() => setOpen((current) => !current)}>
        <span className="rail-icon"><MoreHorizontal24Regular /></span>
        <span className="rail-label">Ещё</span>
        <span className="rail-more-count">{overflow.length}</span>
      </button>
      {drawerOpen ? <aside id="rail-more-drawer" className="rail-more-drawer" aria-label="Другие разделы">
        <header><span>Другие разделы</span><small>{overflow.length}</small></header>
        <div>
          {overflow.map((item) => (
            <div key={item.key} className="rail-more-entry" onClick={() => setOpen(false)}>
              {renderItem(item, true)}
            </div>
          ))}
        </div>
      </aside> : null}
    </div> : null}
  </nav>;
}
