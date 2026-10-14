import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ChatMessage } from "@yuksalish/contracts";

const preferences = "(prefers-reduced-motion: reduce), (forced-colors: active)";
const transition = { duration: 320, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" as const };

export function appendedMessageIds(previous: readonly string[], next: readonly string[]): string[] {
  const known = new Set(previous);
  let lastKnown = -1;
  next.forEach((id, index) => { if (known.has(id)) lastKnown = index; });
  return next.slice(lastKnown + 1).filter(id => !known.has(id));
}

function offset(element: HTMLElement): number {
  const transform = getComputedStyle(element).transform;
  const values = transform.match(/^matrix(?:3d)?\((.+)\)$/u)?.[1]?.split(",").map(Number);
  return values?.length === 16 ? values[13] ?? 0 : values?.[5] ?? 0;
}

export function useMessageArrivalMotion({ paneRef, messages, scope, followLatest, currentUserId }: {
  readonly paneRef: RefObject<HTMLDivElement | null>;
  readonly messages: readonly ChatMessage[];
  readonly scope: string;
  readonly followLatest: RefObject<boolean>;
  readonly currentUserId: string;
}) {
  const [disabled, setDisabled] = useState(() => document.hidden || Boolean(window.matchMedia?.(preferences).matches));
  const [arrivingIds, setArrivingIds] = useState<ReadonlySet<string>>(new Set());
  const previous = useRef<{ scope: string; ids: string[]; tops: Map<string, number>; scrollTop: number } | undefined>(undefined);
  const animations = useRef(new Map<HTMLElement, Animation>());
  const cancel = useCallback(() => {
    for (const animation of animations.current.values()) animation.cancel();
    animations.current.clear();
  }, []);
  useEffect(() => {
    const media = window.matchMedia?.(preferences);
    const changed = () => {
      const off = document.hidden || Boolean(media?.matches);
      setDisabled(off);
      if (off) cancel();
    };
    media?.addEventListener?.("change", changed);
    document.addEventListener("visibilitychange", changed);
    return () => { media?.removeEventListener?.("change", changed); document.removeEventListener("visibilitychange", changed); cancel(); };
  }, [cancel]);
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const ids = messages.map(message => message.id);
    const prior = previous.current;
    const sameScope = prior?.scope === scope;
    const additions = sameScope ? appendedMessageIds(prior.ids, ids) : [];
    const rows = [...pane.querySelectorAll<HTMLElement>("[data-message-row-id]")];
    const shifts = new Map(rows.map(row => [row, animations.current.has(row) ? offset(row) : 0]));
    if (!sameScope || additions.length) cancel();
    const beforeScroll = pane.scrollTop;
    const latest = messages.at(-1);
    const changedTail = prior?.ids.at(-1) !== latest?.id;
    const following = followLatest.current;
    if (!prior || changedTail && (following || latest?.authorId === currentUserId)) {
      // Move the logical viewport before paint, then compensate with FLIP.
      // No native smooth-scroll events can accidentally disable followLatest.
      pane.scrollTop = pane.scrollHeight;
    }
    const tops = new Map<string, number>();
    const canAnimate = !disabled && Boolean(pane.getClientRects().length) && sameScope && additions.length > 0;
    const bounds = pane.getBoundingClientRect();
    for (const row of rows) {
      const id = row.dataset.messageRowId!;
      const shift = shifts.get(row) ?? 0;
      const rect = row.getBoundingClientRect();
      const top = rect.top - (additions.length || !sameScope ? 0 : shift);
      tops.set(id, top);
      if (!canAnimate || typeof row.animate !== "function" || row.classList.contains("is-removing")) continue;
      let animation: Animation | undefined;
      if (additions.includes(id)) {
        animation = row.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "translateY(0)" }], transition);
      } else if (prior.tops.has(id)) {
        const delta = prior.tops.get(id)! + shift - (beforeScroll - prior.scrollTop) - top;
        const visibleNow = rect.bottom > bounds.top && top < bounds.bottom;
        const visibleBefore = rect.bottom + delta > bounds.top && top + delta < bounds.bottom;
        if (following && Math.abs(delta) > 1 && (visibleNow || visibleBefore)) {
          animation = row.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], transition);
        }
      }
      if (animation) {
        animations.current.set(row, animation);
        animation.onfinish = () => { if (animations.current.get(row) === animation) { animation.cancel(); animations.current.delete(row); } };
      }
    }
    previous.current = { scope, ids, tops, scrollTop: pane.scrollTop };
    if (!sameScope) setArrivingIds(current => current.size ? new Set() : current);
    else if (canAnimate) setArrivingIds(current => new Set([...current, ...additions]));
  }, [messages, scope, paneRef, followLatest, currentUserId, disabled, cancel]);
  return { arrivingIds, motionDisabled: disabled, cancelArrivalMotion: cancel };
}
