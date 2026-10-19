import { Suspense, useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

function CommittedPage({ section, resetScroll, children }: { section: string; resetScroll: () => void; children: ReactNode }) {
  const previous = useRef(section);
  useLayoutEffect(() => {
    if (previous.current !== section) resetScroll();
    previous.current = section;
  }, [section, resetScroll]);
  return <>{children}</>;
}

/** Measure native reservation separately from painted width (overlay scrollbars). */
export function observePageScrollRail(pane: HTMLElement) {
  let frame = 0;
  const measure = () => {
    frame = 0;
    const style = getComputedStyle(pane);
    const inset = Math.max(0, pane.offsetWidth - pane.clientWidth - (parseFloat(style.borderLeftWidth) || 0) - (parseFloat(style.borderRightWidth) || 0));
    const pseudo = typeof CSS !== "undefined" && CSS.supports?.("selector(::-webkit-scrollbar)")
      ? parseFloat(getComputedStyle(pane, "::-webkit-scrollbar").width) : 0;
    const width = Math.max(inset, pseudo || parseFloat(style.getPropertyValue("--ws-page-scrollbar-fallback")) || 6);
    for (const [key, value] of [["width", width], ["inset", inset]] as const) {
      const next = `${value}px`, name = `--ws-page-scrollbar-${key}`;
      if (pane.style.getPropertyValue(name) !== next) pane.style.setProperty(name, next);
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
  const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
  const pointer = typeof matchMedia === "undefined" ? undefined : matchMedia("(pointer: coarse)");
  pointer?.addEventListener?.("change", schedule);
  resize?.observe(pane);
  window.addEventListener("resize", schedule);
  measure();
  return () => {
    resize?.disconnect(); window.removeEventListener("resize", schedule); cancelAnimationFrame(frame);
    pointer?.removeEventListener?.("change", schedule);
    pane.style.removeProperty("--ws-page-scrollbar-width"); pane.style.removeProperty("--ws-page-scrollbar-inset");
  };
}

function DeferredSection({ children, section }: { readonly children: ReactNode; readonly section: string }) {
  const pane = useRef<HTMLElement>(null);
  const resetScroll = useCallback(() => { if (pane.current) pane.current.scrollTop = 0; }, []);
  useLayoutEffect(() => pane.current ? observePageScrollRail(pane.current) : undefined, []);
  // Defer one coherent screen snapshot, including navigation targets/drafts.
  // Deferring only the section key would mix old-screen props with new targets.
  const screen = useMemo(() => ({ section, children }), [section, children]);
  const prepared = useDeferredValue(screen);
  const navigating = section !== prepared.section;
  // Updates inside an already mounted section (save results, chat messages,
  // task/board mutations) remain urgent; only a section change is deferred.
  const content = navigating ? prepared.children : children;
  return <main className="app-content" id="workspace-content" ref={pane} tabIndex={-1} aria-busy={navigating}>
    <Suspense fallback={null}><CommittedPage section={navigating ? prepared.section : section} resetScroll={resetScroll}>{content}</CommittedPage></Suspense>
  </main>;
}

export function WorkspaceSectionContent({ children, authorityKey, section }: { readonly children: ReactNode; readonly authorityKey: string; readonly section: string }) {
  // Never retain a screen across identity or access changes, even if the next
  // chunk is pending. The auth shell unmounts this boundary on logout as well.
  return <DeferredSection key={authorityKey} section={section}>{children}</DeferredSection>;
}
