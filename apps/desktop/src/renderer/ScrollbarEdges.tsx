import { useEffect } from "react";

const fadeDistance = 24;

export function scrollbarEdgeOpacity(position: number, viewport: number, extent: number) {
  const maximum = Math.max(0, extent - viewport);
  const clamped = Math.max(0, Math.min(maximum, position));
  return {
    start: Math.min(1, clamped / fadeDistance),
    end: Math.min(1, (maximum - clamped) / fadeDistance),
  };
}

/** Native scrollbar feedback only: never intercepts wheel, pointer or keyboard input. */
export function observeScrollbarEdges(root: HTMLElement) {
  const tracked = new Set<HTMLElement>();
  const pending = new Set<HTMLElement>([root]);
  let frame = 0;
  const update = (element: HTMLElement) => {
    const vertical = scrollbarEdgeOpacity(element.scrollTop, element.clientHeight, element.scrollHeight);
    const horizontal = scrollbarEdgeOpacity(Math.abs(element.scrollLeft), element.clientWidth, element.scrollWidth);
    for (const [key, value] of Object.entries({
      "--ws-scroll-start": vertical.start,
      "--ws-scroll-end": vertical.end,
      "--ws-scroll-left": horizontal.start,
      "--ws-scroll-right": horizontal.end,
    })) {
      const next = String(Math.round(value * 100) / 100);
      if (element.style.getPropertyValue(key) !== next) element.style.setProperty(key, next);
    }
  };
  const resize = new ResizeObserver(() => schedule());
  const discover = (node: HTMLElement) => {
    for (const element of [node, ...node.querySelectorAll("*")]) {
      if (!(element instanceof HTMLElement) || !element.clientHeight || tracked.has(element)) continue;
      if (element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth) continue;
      const style = getComputedStyle(element);
      if (!/(auto|scroll|overlay)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
      tracked.add(element);
      resize.observe(element);
    }
  };
  function flush() {
    frame = 0;
    pending.forEach(discover);
    pending.clear();
    tracked.forEach((element) => {
      if (!root.contains(element)) { resize.unobserve(element); tracked.delete(element); }
      else update(element);
    });
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(flush);
  }
  const onScroll = (event: Event) => {
    if (event.target instanceof HTMLElement && !tracked.has(event.target)) pending.add(event.target);
    schedule();
  };
  const mutation = new MutationObserver((records) => {
    for (const record of records) {
      const parent = record.target instanceof HTMLElement ? record.target : record.target.parentElement;
      if (parent) pending.add(parent);
    }
    schedule();
  });
  const onResize = () => { pending.add(root); schedule(); };
  root.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);
  mutation.observe(root, { childList: true, subtree: true, characterData: true });
  flush();
  return () => {
    root.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
    mutation.disconnect();
    resize.disconnect();
    cancelAnimationFrame(frame);
    tracked.forEach((element) => {
      for (const key of ["start", "end", "left", "right"]) element.style.removeProperty(`--ws-scroll-${key}`);
    });
  };
}

export function ScrollbarEdges() {
  useEffect(() => observeScrollbarEdges(document.body), []);
  return null;
}
