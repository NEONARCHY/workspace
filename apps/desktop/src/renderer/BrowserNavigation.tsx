import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { DialogBody, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { WorkspaceDialog } from "./WorkspaceDialog";

/** The real, permission-filtered rail is reused; the work area never remounts. */
export function BrowserNavigation({ compact, open, onOpenChange, returnFocusRef, children }: {
  readonly compact: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly returnFocusRef?: RefObject<HTMLButtonElement | null>;
  readonly children: ReactNode;
}) {
  const wasOpen = useRef(false);
  useEffect(() => { if (!compact && open) onOpenChange(false); }, [compact, open, onOpenChange]);
  useEffect(() => {
    const restore = wasOpen.current && (!compact || !open);
    wasOpen.current = compact && open;
    if (!restore) return;
    const frame = requestAnimationFrame(() => {
      // Settings/profile opened from this menu own focus; never steal it back.
      if (document.querySelector('[role="dialog"]:not(.browser-navigation-dialog), [aria-modal="true"]:not(.browser-navigation-dialog)')) return;
      const trigger = returnFocusRef?.current;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else document.getElementById("workspace-content")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [compact, open, returnFocusRef]);
  if (!compact) return <>{children}</>;
  return <WorkspaceDialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
    <DialogSurface id="browser-navigation" className="browser-navigation-dialog" aria-label="Меню разделов">
      <DialogBody>
        <DialogTitle className="sr-only">Меню разделов</DialogTitle>
        {children}
      </DialogBody>
    </DialogSurface>
  </WorkspaceDialog>;
}
