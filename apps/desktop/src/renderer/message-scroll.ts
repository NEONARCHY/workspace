/** Native scrolling is interruptible and has no React render or custom RAF per frame. */
export function scrollToLatest(pane: HTMLElement, animate: boolean): void {
  const distance = pane.scrollHeight - pane.clientHeight - pane.scrollTop;
  if (distance <= 1) return;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce), (forced-colors: active)").matches;
  // Opening a chat / returning from distant history should land at the end, not
  // travel through hundreds of messages. Only nearby newly-arrived messages glide.
  if (animate && !reduced && !document.hidden && distance <= pane.clientHeight && typeof pane.scrollTo === "function") {
    pane.scrollTo({ top: pane.scrollHeight, behavior: "smooth" });
  } else {
    pane.scrollTop = pane.scrollHeight;
  }
}
