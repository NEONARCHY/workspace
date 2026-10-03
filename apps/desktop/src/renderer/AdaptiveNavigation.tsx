import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal24Regular } from "@fluentui/react-icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export interface AdaptiveNavigationItem {
  readonly key: string;
  readonly label: string;
}

export function AdaptiveNavigation<T extends AdaptiveNavigationItem>({
  items,
  renderItem,
}: {
  readonly items: readonly T[];
  readonly renderItem: (item: T, inOverflow: boolean, closeOverflow: () => void) => ReactNode;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();

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
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !moreRef.current?.parentElement?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [open]);

  const visible = items.slice(0, visibleCount);
  const overflow = items.slice(visibleCount);
  const drawerOpen = open && overflow.length > 0;
  return <nav ref={containerRef} className="rail-nav personal-rail-nav adaptive-rail-nav"
    onClickCapture={(event) => {
      if (event.target instanceof Element && event.target.closest(".rail-action:not(.rail-more-action):not(.rail-ai-trigger)")) {
        setOpen(false);
      }
    }}>
    {visible.map((item) => renderItem(item, false, () => setOpen(false)))}
    {overflow.length ? <div className="rail-slot rail-more-slot">
      <button ref={moreRef} type="button" className={`rail-action rail-more-action ${drawerOpen ? "active" : ""}`}
        aria-label={`Ещё, ${overflow.length} разделов`} aria-expanded={drawerOpen} aria-controls="rail-more-drawer" onClick={() => setOpen((current) => !current)}>
        <span className="rail-icon"><MoreHorizontal24Regular /></span>
        <span className="rail-label">Ещё</span>
        <span className="rail-more-count">{overflow.length}</span>
      </button>
      <AnimatePresence initial={false}>
        {drawerOpen ? <motion.aside id="rail-more-drawer" className="rail-more-drawer" aria-label="Другие разделы"
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: reducedMotion ? 0 : 0.24, ease: [0.2, 0, 0, 1] }}>
          <header><span>Другие разделы</span><small>{overflow.length}</small></header>
          <div>
            {overflow.map((item) => (
              <div key={item.key} className="rail-more-entry">
                {renderItem(item, true, () => setOpen(false))}
              </div>
            ))}
          </div>
        </motion.aside> : null}
      </AnimatePresence>
    </div> : null}
  </nav>;
}
