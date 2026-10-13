import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { observeScrollbarEdges, scrollbarEdgeOpacity } from "./ScrollbarEdges";

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("scrollbar edges", () => {
  it("uses one theme-aware thumb colour for both complete opacity gradients", () => {
    const css = readFileSync("src/renderer/scrollbars.css", "utf8");
    expect(css).toContain("html { --ws-scrollbar-thumb-rgb: 141 164 170; }");
    expect(css).toContain('html[data-color-theme="dark"] { --ws-scrollbar-thumb-rgb: 100 128 150; }');
    expect(css).not.toContain("--ws-theme-wash-teal");
    expect(css).not.toContain("rgb(141 164 170 /");
    const gradients = [...css.matchAll(/background: linear-gradient\(to (bottom|right),([\s\S]*?)\);/g)];
    expect(gradients).toHaveLength(2);
    for (const [, , gradient] of gradients) {
      expect(gradient!.match(/rgb\(var\(--ws-scrollbar-thumb-rgb\)/g)).toHaveLength(10);
    }
    expect(css).toContain("background: CanvasText");
  });
  it("does not paint an opaque dark backing under the fading thumb", () => {
    const css = readFileSync("src/renderer/dark-theme.css", "utf8");
    expect(css).not.toContain("::-webkit-scrollbar-thumb");
  });
  it("fades only the reached edge and stays solid in the middle", () => {
    expect(scrollbarEdgeOpacity(0, 100, 400)).toEqual({ start: 0, end: 1 });
    expect(scrollbarEdgeOpacity(150, 100, 400)).toEqual({ start: 1, end: 1 });
    expect(scrollbarEdgeOpacity(300, 100, 400)).toEqual({ start: 1, end: 0 });
  });
  it("softly fades over the last 48 pixels, symmetrically at either end", () => {
    expect(scrollbarEdgeOpacity(24, 100, 400)).toEqual({ start: 0.5, end: 1 });
    expect(scrollbarEdgeOpacity(276, 100, 400)).toEqual({ start: 1, end: 0.5 });
    expect(scrollbarEdgeOpacity(12, 100, 400).start).toBe(0.15625);
    expect(scrollbarEdgeOpacity(36, 100, 400).start).toBe(0.84375);
    for (const distance of [0, 12, 24, 36, 48]) {
      expect(scrollbarEdgeOpacity(distance, 100, 400).start).toBe(scrollbarEdgeOpacity(300 - distance, 100, 400).end);
    }
  });
  it("clamps overscroll and handles a container that no longer overflows", () => {
    expect(scrollbarEdgeOpacity(-4, 100, 400)).toEqual({ start: 0, end: 1 });
    expect(scrollbarEdgeOpacity(310, 100, 400)).toEqual({ start: 1, end: 0 });
    expect(scrollbarEdgeOpacity(0, 100, 80)).toEqual({ start: 0, end: 0 });
  });
  it("allows the task pane to start fading earlier without changing default scrollbars", () => {
    expect(scrollbarEdgeOpacity(100, 800, 2400)).toEqual({ start: 1, end: 1 });
    expect(scrollbarEdgeOpacity(100, 800, 2400, 200)).toEqual({ start: 0.5, end: 1 });
    expect(scrollbarEdgeOpacity(1500, 800, 2400, 200)).toEqual({ start: 1, end: 0.5 });
  });
  it("updates native thumb properties without changing scroll position and cleans up", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const panel = document.createElement("div");
    panel.style.overflowY = "auto";
    Object.defineProperties(panel, {
      clientHeight: { value: 100 }, scrollHeight: { value: 400 },
      clientWidth: { value: 100 }, scrollWidth: { value: 100 },
    });
    document.body.append(panel);
    const stop = observeScrollbarEdges(document.body);
    expect(panel.style.getPropertyValue("--ws-scroll-start")).toBe("0");
    panel.scrollTop = 300;
    panel.dispatchEvent(new Event("scroll"));
    frames.splice(0).forEach((callback) => callback(0));
    expect(panel.style.getPropertyValue("--ws-scroll-start")).toBe("1");
    expect(panel.style.getPropertyValue("--ws-scroll-end")).toBe("0");
    expect(panel.scrollTop).toBe(300);
    stop();
    expect(panel.style.getPropertyValue("--ws-scroll-end")).toBe("");
  });
});
