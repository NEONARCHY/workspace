import { Suspense, useDeferredValue, useMemo, type ReactNode } from "react";

function DeferredSection({ children, section }: { readonly children: ReactNode; readonly section: string }) {
  // Defer one coherent screen snapshot, including navigation targets/drafts.
  // Deferring only the section key would mix old-screen props with new targets.
  const screen = useMemo(() => ({ section, children }), [section, children]);
  const prepared = useDeferredValue(screen);
  const navigating = section !== prepared.section;
  // Updates inside an already mounted section (save results, chat messages,
  // task/board mutations) remain urgent; only a section change is deferred.
  const content = navigating ? prepared.children : children;
  return <main className="app-content" id="workspace-content" tabIndex={-1} aria-busy={navigating}>
    <Suspense fallback={null}>{content}</Suspense>
  </main>;
}

export function WorkspaceSectionContent({ children, authorityKey, section }: { readonly children: ReactNode; readonly authorityKey: string; readonly section: string }) {
  // Never retain a screen across identity or access changes, even if the next
  // chunk is pending. The auth shell unmounts this boundary on logout as well.
  return <DeferredSection key={authorityKey} section={section}>{children}</DeferredSection>;
}
