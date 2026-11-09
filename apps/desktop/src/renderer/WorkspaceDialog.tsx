import { Dialog, type DialogProps } from "@fluentui/react-components";
import { useEffect, useRef } from "react";

/** Activate a lazy surface after Tabster registers it; preserve input/document focus. */
export function focusWorkspaceDialog(surface: HTMLElement | null) {
  if (!surface) return;
  const active = surface.ownerDocument.activeElement;
  const activeDialog = active?.closest('[role="dialog"]');
  if (activeDialog && activeDialog !== surface) return;
  if (active && surface.contains(active) && active !== surface
    && surface.getAttribute("aria-hidden") !== "true") return;
  const target = surface.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), a[href], [tabindex="0"]:not([data-tabster-dummy])');
  if (active === target) surface.focus({ preventScroll: true });
  target?.focus({ preventScroll: true });
}

/** Keep Fluent's presence/focus lifecycle, but never scale text during a transition. */
export function WorkspaceDialog({ onAfterClose, onAfterOpen, ...props }: DialogProps & {
  readonly onAfterClose?: () => void;
  readonly onAfterOpen?: () => void;
}) {
  const lifecycle = useRef({
    open: Boolean(props.open ?? props.defaultOpen),
    opened: Boolean(props.open ?? props.defaultOpen),
    onAfterClose, onAfterOpen,
  });
  useEffect(() => {
    const current = lifecycle.current;
    if (props.open !== undefined) current.open = props.open;
    if (current.open) current.opened = true;
    current.onAfterClose = onAfterClose;
    current.onAfterOpen = onAfterOpen;
  }, [props.open, onAfterClose, onAfterOpen]);
  return <Dialog
    surfaceMotion={{ outScale: 1, inScale: 1, duration: 240, exitDuration: 160,
      easing: "cubic-bezier(0.2, 0, 0, 1)", exitEasing: "cubic-bezier(0.4, 0, 1, 1)",
      onMotionFinish: (_, data) => {
        const current = lifecycle.current;
        if (data.direction === "exit") {
          if (current.opened && (props.open === undefined || !current.open)) {
            current.opened = false;
            if (props.open === undefined) current.open = false;
            current.onAfterClose?.();
          }
        } else {
          if (props.open === undefined) current.open = true;
          if (current.open) { current.opened = true; current.onAfterOpen?.(); }
        }
      } }}
    {...props}
  />;
}
