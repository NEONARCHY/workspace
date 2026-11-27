import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Portal } from "@fluentui/react-components";
import { MoreHorizontal24Regular } from "@fluentui/react-icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { defaultSidebarTheme, type SidebarTheme } from "./sidebar-theme";

export interface AdaptiveNavigationItem {
  readonly key: string;
  readonly label: string;
}

export function AdaptiveNavigation<T extends AdaptiveNavigationItem>({
  items,
  renderItem,
  expandedItem,
  activeKey,
  sidebarTheme = defaultSidebarTheme,
  scrollable = false,
}: {
  readonly items: readonly T[];
  readonly renderItem: (item: T, inOverflow: boolean, closeOverflow: () => void) => ReactNode;
  readonly expandedItem?: { readonly key: string; readonly height: number };
  readonly activeKey?: string;
  readonly sidebarTheme?: SidebarTheme;
  readonly scrollable?: boolean;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  // Labels, badges and parent polling do not change row capacity.
  const itemKeys = JSON.stringify(items.map(item => item.key));

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || scrollable) return;
    const keys: readonly string[] = JSON.parse(itemKeys);
    const update = () => {
      // Fit the actual hit target and gap, without overflowing into the profile.
      const action = container.querySelector<HTMLElement>(":scope > .rail-slot > .rail-action, :scope > .rail-action");
      const actionHeight = action?.offsetHeight || 44;
      const gap = Number.parseFloat(getComputedStyle(container).rowGap) || 4;
      const slotHeight = actionHeight + gap;
      if (container.clientHeight <= 0) {
        setVisibleCount(keys.length);
        return;
      }
      const heights = keys.map(key => slotHeight + (key === expandedItem?.key ? expandedItem.height : 0));
      if (heights.reduce((total, height) => total + height, 0) - gap <= container.clientHeight) {
        setVisibleCount(keys.length);
        return;
      }
      let used = actionHeight; // Reserve More, with no unused trailing gap.
      let count = 0;
      while (count < keys.length && used + heights[count]! <= container.clientHeight) used += heights[count++]!;
      // Never unmount the expanded trigger while moving the items below it to More.
      const expandedIndex = keys.findIndex(key => key === expandedItem?.key);
      const collapsedCapacity = Math.max(0, Math.floor((container.clientHeight + gap) / slotHeight) - 1);
      if (expandedIndex >= 0 && expandedIndex < collapsedCapacity) count = Math.max(count, expandedIndex + 1);
      setVisibleCount(count);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [itemKeys, expandedItem?.key, expandedItem?.height, scrollable]);

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

  const count = scrollable ? items.length : visibleCount;
  const visible = items.slice(0, count);
  const overflow = items.slice(count);
  const activeOverflow = overflow.find(item => item.key === activeKey);
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
      const width = Math.min(284, Math.max(48, viewportWidth - 24));
      const maxHeight = Math.max(48, Math.min(520, viewportHeight - 24));
      const height = Math.min(drawer.scrollHeight, maxHeight);
      // Read first, then write: positioning must not force layout between assignments.
      Object.assign(drawer.style, {
        width: `${width}px`, maxHeight: `${maxHeight}px`,
        left: `${Math.max(12, Math.min(railRect.right / scale + 12, viewportWidth - width - 12))}px`,
        bottom: `${Math.min(82, Math.max(12, viewportHeight - height - 12))}px`,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(rail);
    observer.observe(drawer);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, [drawerOpen]);
  return <nav ref={containerRef} className="rail-nav personal-rail-nav adaptive-rail-nav" aria-label="Разделы Workspace"
    onClick={(event) => {
      if (event.target instanceof Element && event.target.closest(".rail-action:not(.rail-more-action):not(.rail-ai-trigger)")) {
        setOpen(false);
      }
    }}>
    {visible.map((item) => renderItem(item, false, () => setOpen(false)))}
    {overflow.length ? <div className="rail-slot rail-more-slot">
      <button ref={moreRef} type="button" className={`rail-action rail-more-action ${drawerOpen ? "active" : ""}${activeOverflow ? " has-active-section" : ""}`}
        aria-label={`Ещё, ${overflow.length} разделов`} aria-description={activeOverflow ? `Текущий раздел: ${activeOverflow.label}` : undefined} aria-expanded={drawerOpen} aria-controls="rail-more-drawer" onClick={() => setOpen((current) => !current)}>
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
  </nav>;
}
