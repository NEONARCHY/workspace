import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Portal } from "@fluentui/react-components";
import { MoreHorizontal24Regular } from "@fluentui/react-icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { SlidingSegmented } from "./SlidingSegmented";
import { defaultSidebarTheme, type SidebarTheme } from "./sidebar-theme";

export interface AdaptiveNavigationItem {
  readonly key: string;
  readonly label: string;
}

export function AdaptiveNavigation<T extends AdaptiveNavigationItem>({
  items,
  renderItem,
  expandedItem,
  sidebarTheme = defaultSidebarTheme,
}: {
  readonly items: readonly T[];
  readonly renderItem: (item: T, inOverflow: boolean, closeOverflow: () => void) => ReactNode;
  readonly expandedItem?: { readonly key: string; readonly height: number };
  readonly sidebarTheme?: SidebarTheme;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      // Collapsed icons are taller than labelled rows. Fit the actual hit target,
      // including the gap, rather than letting More overflow into the profile.
      const action = container.querySelector<HTMLElement>(":scope > .rail-slot > .rail-action, :scope > .rail-action");
      const actionHeight = action?.offsetHeight || 45;
      const gap = Number.parseFloat(getComputedStyle(container).rowGap) || 5;
      const slotHeight = actionHeight + gap;
      if (container.clientHeight <= 0) {
        setVisibleCount(items.length);
        return;
      }
      const heights = items.map((item) => slotHeight + (item.key === expandedItem?.key ? expandedItem.height : 0));
      if (heights.reduce((total, height) => total + height, 0) - gap <= container.clientHeight) {
        setVisibleCount(items.length);
        return;
      }
      let used = actionHeight; // Reserve More, with no unused trailing gap.
      let count = 0;
      while (count < items.length && used + heights[count]! <= container.clientHeight) used += heights[count++]!;
      // Never unmount the expanded trigger while moving the items below it to More.
      const expandedIndex = items.findIndex((item) => item.key === expandedItem?.key);
      const collapsedCapacity = Math.max(0, Math.floor((container.clientHeight + gap) / slotHeight) - 1);
      if (expandedIndex >= 0 && expandedIndex < collapsedCapacity) count = Math.max(count, expandedIndex + 1);
      setVisibleCount(count);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [items, expandedItem?.key, expandedItem?.height]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        moreRef.current?.focus();
      }
    };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !moreRef.current?.contains(event.target) && !drawerRef.current?.contains(event.target)) {
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
  useLayoutEffect(() => {
    const drawer = drawerRef.current;
    const rail = moreRef.current?.closest<HTMLElement>(".app-rail") ?? containerRef.current;
    if (!drawerOpen || !drawer || !rail) return;
    const update = () => {
      const railRect = rail.getBoundingClientRect();
      const drawerRect = drawer.getBoundingClientRect();
      const scale = drawer.offsetWidth && drawerRect.width ? drawerRect.width / drawer.offsetWidth : 1;
      const viewportWidth = window.innerWidth / scale;
      const viewportHeight = window.innerHeight / scale;
      drawer.style.width = `${Math.min(284, Math.max(48, viewportWidth - 24))}px`;
      drawer.style.maxHeight = `${Math.max(48, Math.min(520, viewportHeight - 24))}px`;
      drawer.style.left = `${Math.max(12, Math.min(railRect.right / scale + 10, viewportWidth - drawer.offsetWidth - 12))}px`;
      drawer.style.bottom = `${Math.min(82, Math.max(12, viewportHeight - drawer.offsetHeight - 12))}px`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(rail);
    observer.observe(drawer);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, [drawerOpen]);
  return <SlidingSegmented as="nav" onContainer={(node) => { containerRef.current = node; }} activeSelector=":scope > .rail-slot .rail-action.active:not(.rail-more-action), :scope > button.rail-action.active:not(.rail-more-action)" className="rail-nav personal-rail-nav adaptive-rail-nav navigation-sliding"
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
        <span className="rail-more-count" aria-hidden="true">{overflow.length}</span>
      </button>
      <Portal><AnimatePresence initial={false}>
        {drawerOpen ? <motion.aside ref={drawerRef} id="rail-more-drawer" className="rail-more-drawer sidebar-palette" data-sidebar-theme={sidebarTheme} aria-label="Другие разделы"
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: reducedMotion ? 0 : 0.24, ease: [0.2, 0, 0, 1] }}>
          <header><span>Другие разделы</span></header>
          <div>
            {overflow.map((item) => (
              <div key={item.key} className="rail-more-entry">
                {renderItem(item, true, () => setOpen(false))}
              </div>
            ))}
          </div>
        </motion.aside> : null}
      </AnimatePresence></Portal>
    </div> : null}
  </SlidingSegmented>;
}
