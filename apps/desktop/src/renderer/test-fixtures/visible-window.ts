import { vi } from "vitest";

/** jsdom has no layout. Model a visible window, not Tabster's focus/ARIA decisions. */
export function mockVisibleWindowLayout(): void {
  // Tabster considers a zero-sized body a hidden iframe.
  vi.spyOn(document.body, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1440, 900));
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(function (this: HTMLElement) {
    if (!this.isConnected || this === document.body || this.hidden || getComputedStyle(this).display === "none") return null;
    for (let node: HTMLElement | null = this.parentElement; node; node = node.parentElement) {
      if (node.hidden || getComputedStyle(node).display === "none") return null;
    }
    return getComputedStyle(this).position === "fixed" ? null : this.parentElement;
  });
}
