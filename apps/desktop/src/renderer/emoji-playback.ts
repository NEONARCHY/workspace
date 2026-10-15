// One observer/listener set for the whole renderer, not one per emoji.
// Native WebP playback does not schedule React updates or JS animation frames.
const preferenceQuery = "(prefers-reduced-motion: reduce), (forced-colors: active)";
const maximumPlaying = 64;
interface Entry { readonly notify: () => void; readonly picker: boolean; visible: boolean }
const entries = new Map<HTMLElement, Entry>();
let playing = new Set<HTMLElement>();
let observer: IntersectionObserver | undefined;
let preferences: MediaQueryList | undefined;

function reconcile() {
  const next = new Set<HTMLElement>();
  if (document.visibilityState === "visible" && !preferences?.matches) {
    // An open chooser takes priority over reaction chips behind it.
    const visible = [...entries].filter(([, entry]) => entry.visible)
      .sort(([, left], [, right]) => Number(right.picker) - Number(left.picker));
    for (const [node] of visible.slice(0, maximumPlaying)) next.add(node);
  }
  const previous = playing;
  playing = next;
  for (const [node, entry] of entries) {
    if (previous.has(node) !== next.has(node)) entry.notify();
  }
}

export const isEmojiPlaying = (node: HTMLElement | null) => node !== null && playing.has(node);

export function subscribeEmoji(node: HTMLElement | null, notify: () => void) {
  if (!node || typeof IntersectionObserver === "undefined") return () => {};
  if (!observer) {
    preferences = window.matchMedia?.(preferenceQuery);
    observer = new IntersectionObserver(records => {
      for (const record of records) {
        const entry = entries.get(record.target as HTMLElement);
        if (entry) entry.visible = record.isIntersecting && record.intersectionRatio >= .01;
      }
      reconcile();
    }, { threshold: .01 });
    document.addEventListener("visibilitychange", reconcile);
    preferences?.addEventListener("change", reconcile);
  }
  entries.set(node, { notify, picker: Boolean(node.closest(".reaction-picker-popover")), visible: false });
  observer.observe(node);
  return () => {
    observer?.unobserve(node);
    entries.delete(node);
    playing.delete(node);
    reconcile();
    if (!entries.size) {
      observer?.disconnect(); observer = undefined;
      document.removeEventListener("visibilitychange", reconcile);
      preferences?.removeEventListener("change", reconcile); preferences = undefined;
    }
  };
}
