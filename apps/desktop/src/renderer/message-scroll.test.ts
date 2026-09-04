import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollToLatest } from "./message-scroll";

function pane(distance = 60) {
  return { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 - distance, scrollTo: vi.fn() } as unknown as HTMLElement;
}

describe("Message scroll policy", () => {
  afterEach(() => vi.restoreAllMocks());
  it("opens at the end without animating through history", () => {
    const node = pane(); scrollToLatest(node, false);
    expect(node.scrollTop).toBe(1000); expect(node.scrollTo).not.toHaveBeenCalled();
  });
  it("uses interruptible native smooth scrolling for a nearby new message", () => {
    const node = pane(); scrollToLatest(node, true);
    expect(node.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
  });
  it("does not animate a long journey from older history", () => {
    const node = pane(500); scrollToLatest(node, true);
    expect(node.scrollTop).toBe(1000); expect(node.scrollTo).not.toHaveBeenCalled();
  });
  it("does not restart scrolling when already at the end", () => {
    const node = pane(0); scrollToLatest(node, true);
    expect(node.scrollTo).not.toHaveBeenCalled(); expect(node.scrollTop).toBe(600);
  });
  it("honours reduced motion / forced colours", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    try {
      const node = pane(); scrollToLatest(node, true);
      expect(node.scrollTop).toBe(1000); expect(node.scrollTo).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("does not run animation in a hidden window", () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const node = pane(); scrollToLatest(node, true);
    expect(node.scrollTo).not.toHaveBeenCalled(); expect(node.scrollTop).toBe(1000);
  });
  it("falls back without scrollTo support", () => {
    const node = pane(); Object.defineProperty(node, "scrollTo", { value: undefined });
    scrollToLatest(node, true); expect(node.scrollTop).toBe(1000);
  });
});
