import { useEffect, useState, type RefObject } from "react";
import { scheduleProfileWork } from "./profile-idle";

interface PreparationGroup {
  observer: IntersectionObserver;
  targets: Map<Element, () => void>;
  pending: Set<Element>;
  cancel: () => void;
}
const groups = new WeakMap<Element, PreparationGroup>();

function subscribe(element: HTMLElement, ready: () => void) {
  const root = element.closest(".fui-DialogContent") ?? document.documentElement;
  let group = groups.get(root);
  if (!group) {
    const targets = new Map<Element, () => void>(), pending = new Set<Element>();
    const flush = () => {
      if (!group) return;
      for (const target of [...pending].slice(0, 4)) {
        pending.delete(target);
        targets.get(target)?.();
      }
      if (pending.size) group.cancel = scheduleProfileWork(flush);
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && targets.has(entry.target)) {
          pending.add(entry.target);
          observer.unobserve(entry.target);
        }
      }
      if (pending.size && group) {
        group.cancel();
        group.cancel = scheduleProfileWork(flush);
      }
    }, { root, rootMargin: "240px 0px" });
    group = { observer, targets, pending, cancel: () => undefined };
    groups.set(root, group);
  }
  group.targets.set(element, ready);
  group.observer.observe(element);
  const current = group;
  return () => {
    current.observer.unobserve(element);
    current.pending.delete(element);
    current.targets.delete(element);
    if (!current.targets.size) {
      current.cancel(); current.observer.disconnect(); groups.delete(root);
    }
  };
}

// Keep text and exact card geometry from the first frame, but prepare the
// layered artwork only near the profile's own scroll viewport. Once prepared,
// a card stays mounted so scrolling cannot interrupt hover or keyboard focus.
export function useRecognitionReady(ref: RefObject<HTMLElement | null>) {
  const [ready, setReady] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (ready || !element || typeof IntersectionObserver === "undefined") return;
    const unsubscribe = subscribe(element, () => setReady(true));
    // Tab/focus must not wait for idle work.
    const focus = () => setReady(true);
    element.addEventListener("focusin", focus);
    return () => { unsubscribe(); element.removeEventListener("focusin", focus); };
  }, [ready, ref]);
  return ready;
}
