import { useEffect, useRef, type RefObject } from "react";

/** Focus lifecycle for custom overlays. Fluent dialogs keep their own focus manager. */
export function useModalFocus(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const panel = ref.current;
    if (!open || !panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => [...panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]')]
      .filter((node) => node.tabIndex >= 0 && !node.matches(':disabled,[aria-disabled="true"]') && node.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => (focusable()[0] ?? panel).focus());
    // Disable siblings along the path, never an ancestor that contains this modal.
    const siblings: { node: HTMLElement; inert: boolean }[] = [];
    let ancestor: HTMLElement = panel;
    while (ancestor.parentElement && ancestor !== document.body) {
      for (const node of ancestor.parentElement.children) {
        if (node !== ancestor && node instanceof HTMLElement && !node.matches('script,style,link')) {
          siblings.push({ node, inert: node.hasAttribute("inert") }); node.setAttribute("inert", "");
        }
      }
      ancestor = ancestor.parentElement;
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const activeDialog = document.activeElement?.closest('[role="dialog"]');
      if (activeDialog && activeDialog !== panel && !panel.contains(activeDialog)) return;
      if (event.key === "Escape") { event.preventDefault(); close.current(); return; }
      if (event.key !== "Tab") return;
      const targets = focusable(), first = targets[0] ?? panel, last = targets.at(-1) ?? panel;
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      for (const { node, inert } of siblings) node.toggleAttribute("inert", inert);
      const target = previous?.isConnected ? previous : document.querySelector<HTMLElement>(".section-jump-trigger");
      target?.focus();
    };
  }, [open, ref]);
}
