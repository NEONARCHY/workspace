import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ChatMessage } from "@yuksalish/contracts";

// Viewport-local unread, not server receipts: opening a chat currently marks all
// receipts read. Retain unseen incoming IDs until they are viewed or jumped past.
export function useMessageScrollNavigation({ paneRef, messages, currentUserId, initialUnreadMessageId, active, opened }: {
  paneRef: RefObject<HTMLDivElement | null>;
  messages: readonly ChatMessage[];
  currentUserId: string;
  initialUnreadMessageId?: string;
  active: boolean;
  opened: boolean;
}) {
  const session = useRef<{ known: Set<string>; pending: Set<string>; seeded: boolean } | undefined>(undefined);
  const rows = useRef(new Map<string, HTMLElement>());
  const frame = useRef<number | undefined>(undefined);
  const [state, setState] = useState({ visible: false, unread: 0 });
  const update = useCallback(() => {
    const pane = paneRef.current;
    if (!active || !opened || !pane) return;
    if (!pane.clientHeight || !pane.getClientRects().length) {
      setState(current => current.visible ? { ...current, visible: false } : current);
      return;
    }
    const atLatest = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
    const pending = session.current?.pending;
    if (atLatest) pending?.clear();
    else if (pending?.size) {
      const bounds = pane.getBoundingClientRect();
      // Only measure unread candidates; scrolling through already-read long
      // histories must not walk/rebuild their rich message subtrees each frame.
      for (const id of pending) {
        const row = rows.current.get(id);
        if (!row?.isConnected) continue;
        const rect = row.getBoundingClientRect();
        const seen = Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top);
        if (rect.bottom <= bounds.top || seen >= Math.min(rect.height, bounds.height) / 2) pending.delete(id);
      }
    }
    const next = { visible: !atLatest && pane.clientHeight >= 80, unread: pending?.size ?? 0 };
    setState(current => current.visible === next.visible && current.unread === next.unread ? current : next);
  }, [active, opened, paneRef]);
  const onScroll = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => { frame.current = undefined; update(); });
  }, [update]);
  useLayoutEffect(() => {
    if (!opened) { session.current = undefined; rows.current.clear(); return; }
    const ids = new Set(messages.map(message => message.id));
    const current = session.current ??= { known: ids, pending: new Set(), seeded: false };
    for (const message of messages) {
      if (!current.known.has(message.id) && message.authorId !== currentUserId && !message.deletedAt) current.pending.add(message.id);
      if (message.deletedAt) current.pending.delete(message.id);
    }
    for (const id of current.pending) if (!ids.has(id)) current.pending.delete(id);
    current.known = ids;
    if (!current.seeded && initialUnreadMessageId) {
      const start = messages.findIndex(message => message.id === initialUnreadMessageId);
      if (start >= 0) {
        for (const message of messages.slice(start)) if (message.authorId !== currentUserId && !message.deletedAt) current.pending.add(message.id);
        current.seeded = true;
      }
    }
    rows.current = new Map([...paneRef.current?.querySelectorAll<HTMLElement>("[data-message-row-id]") ?? []]
      .map(row => [row.dataset.messageRowId!, row.querySelector<HTMLElement>("[data-message-id]") ?? row]));
    // The floating host restores its row anchor in its parent layout effect.
    // Read only the settled viewport, not the transient mini/full reflow.
    onScroll();
  }, [messages, currentUserId, initialUnreadMessageId, opened, paneRef, onScroll]);
  useEffect(() => {
    const pane = paneRef.current;
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(onScroll);
    if (pane) observer?.observe(pane);
    return () => observer?.disconnect();
  }, [onScroll, paneRef]);
  useEffect(() => () => { if (frame.current !== undefined) cancelAnimationFrame(frame.current); }, []);
  const jumpToLatest = useCallback((smooth: boolean) => {
    const pane = paneRef.current;
    if (!pane) return;
    session.current?.pending.clear();
    pane.scrollTo({ top: pane.scrollHeight, behavior: smooth ? "smooth" : "instant" });
    pane.focus({ preventScroll: true });
    update();
  }, [paneRef, update]);
  return { visible: active && opened && state.visible, unread: state.unread, onScroll, jumpToLatest };
}
