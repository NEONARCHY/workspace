import { createContext, useContext, useEffect, useState } from "react";
import type { ComponentProps, RefObject } from "react";

// One observer for the conversation; offscreen rows need no selector controls.
export function useMessageSelectionVisibility(paneRef: RefObject<HTMLDivElement | null>, messages: readonly { id: string }[]) {
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string> | undefined>(() =>
    typeof IntersectionObserver === "undefined" ? undefined : new Set());
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || typeof IntersectionObserver === "undefined") return;
    const currentIds = new Set(messages.map(message => message.id));
    const observer = new IntersectionObserver(entries => {
      setVisibleIds(previous => {
        const next = new Set([...previous ?? []].filter(id => currentIds.has(id)));
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.messageId;
          if (!id) continue;
          if (entry.isIntersecting) next.add(id); else next.delete(id);
        }
        return previous?.size === next.size && [...next].every(id => previous.has(id)) ? previous : next;
      });
    }, { root: pane, rootMargin: "80px 0px" });
    pane.querySelectorAll(".message[data-message-id]").forEach(row => observer.observe(row));
    return () => observer.disconnect();
  }, [paneRef, messages]);
  return visibleIds;
}

export const MessageSelectionContext = createContext<{
  active: boolean; ids: ReadonlySet<string>; visibleIds?: ReadonlySet<string>; toggle: (id: string) => void; cancel: () => void;
}>({
  active: false,
  ids: new Set<string>(),
  toggle: () => undefined,
  cancel: () => undefined,
});

// Selection updates only this light shell, not the stable rich-message children.
export function SelectableMessage({ messageId, label, className, children, onKeyDown,
  onFocus, onBlur, onPointerEnter, onPointerLeave, ...props
}: ComponentProps<"div"> & { messageId: string; label: string }) {
  const selection = useContext(MessageSelectionContext);
  const visible = !selection.visibleIds || selection.visibleIds.has(messageId);
  const selected = selection.active && selection.ids.has(messageId);
  return <><div {...props} className={`${className ?? ""}${selection.active && visible ? " is-selecting" : ""}${selected ? " is-selected" : ""}`}
    onClickCapture={event => {
      if (!selection.active || (event.target as HTMLElement).closest(".message-select")) return;
      event.preventDefault(); event.stopPropagation(); selection.toggle(messageId);
    }}
    onKeyDown={event => {
      if (selection.active && event.key === "Escape") {
        event.preventDefault(); selection.cancel(); return;
      }
      if (selection.active && event.target === event.currentTarget && [" ", "Enter"].includes(event.key)) {
        event.preventDefault(); selection.toggle(messageId); return;
      }
      onKeyDown?.(event);
    }}
    onFocus={event => { if (!selection.active) onFocus?.(event); }}
    onBlur={event => { if (!selection.active) onBlur?.(event); }}
    onPointerEnter={event => { if (!selection.active) onPointerEnter?.(event); }}
    onPointerLeave={event => { if (!selection.active) onPointerLeave?.(event); }}>
    {children}
  </div>
    {visible ? <input className="message-select" type="checkbox" data-satin-excluded="true" hidden={!selection.active}
      checked={selected} aria-hidden={!selection.active} inert={!selection.active} aria-label={label} onChange={() => selection.toggle(messageId)}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); selection.cancel(); } }} /> : null}
  </>;
}
