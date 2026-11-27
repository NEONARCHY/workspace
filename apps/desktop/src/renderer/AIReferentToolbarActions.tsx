import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** Reuses the same controls and handlers in the register bar or standalone view. */
export function AIReferentToolbarActions({ target, children }: {
  readonly target?: HTMLElement | null;
  readonly children: ReactNode;
}) {
  const actions = <div className="ai-referent-toolbar-actions" role="group" aria-label="Действия реестра">{children}</div>;
  return target ? createPortal(actions, target) : actions;
}
