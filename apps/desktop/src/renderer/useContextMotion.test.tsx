import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContextMotion } from "./useContextMotion";

const animate = vi.fn();
let reduced = false;
const mediaListeners = new Set<() => void>();
function Example({ value = "working", height = 40, enter = false }: {
  readonly value?: string; readonly height?: number; readonly enter?: boolean;
}) {
  const ref = useContextMotion(value, { resize: true, enter });
  return <div ref={ref} data-height={height}>Visible content</div>;
}
beforeEach(() => {
  reduced = false; mediaListeners.clear(); animate.mockReset();
  animate.mockImplementation(() => ({ cancel: vi.fn(), playState: "finished" }));
  vi.stubGlobal("matchMedia", () => ({ matches: reduced,
    addEventListener: (_event: string, callback: () => void) => mediaListeners.add(callback),
    removeEventListener: (_event: string, callback: () => void) => mediaListeners.delete(callback),
  }));
  vi.stubGlobal("Animation", class {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { height: Number(this.dataset.height ?? 0), width: 300, x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 40, toJSON: () => ({}) };
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (HTMLElement.prototype as Partial<HTMLElement>).animate; });

describe("context motion", () => {
  it("resizes only explicit context swaps and returns to natural layout", () => {
    const view = render(<Example />);
    expect(animate).not.toHaveBeenCalled();
    view.rerender(<Example value="all" height={280} />);
    expect(animate.mock.calls[0]?.[0]).toEqual([{ height: "40px" }, { height: "280px" }]);
    expect(animate.mock.calls[0]?.[1]).not.toHaveProperty("fill");
    view.rerender(<Example value="all" height={290} />);
    expect(animate).toHaveBeenCalledTimes(2);
    view.rerender(<Example height={40} />);
    expect(animate.mock.calls[2]?.[0]).toEqual([{ height: "290px" }, { height: "40px" }]);
  });
  it("cancels the previous transition before a rapid reverse", () => {
    const cancel = vi.fn(); animate.mockImplementation(() => ({ cancel, playState: "running" }));
    const view = render(<Example />);
    view.rerender(<Example value="all" height={280} />);
    view.rerender(<Example height={40} />);
    expect(cancel).toHaveBeenCalledTimes(2);
  });
  it("honours reduced motion at entry and filter changes", () => {
    reduced = true;
    const view = render(<Example enter />);
    view.rerender(<Example value="all" height={280} enter />);
    expect(animate).not.toHaveBeenCalled();
  });
  it("stops current movement when the preference changes and cleans up", () => {
    const cancel = vi.fn(); animate.mockImplementation(() => ({ cancel, playState: "running" }));
    const view = render(<Example enter />);
    reduced = true; mediaListeners.forEach(callback => callback());
    expect(cancel).toHaveBeenCalledTimes(1);
    view.unmount(); expect(mediaListeners.size).toBe(0);
  });
  it("does not animate keyboard-focused interactions", () => {
    const matches = vi.spyOn(Element.prototype, "matches").mockImplementation(selector => selector === ":focus-visible");
    render(<Example enter />);
    expect(animate).not.toHaveBeenCalled(); matches.mockRestore();
  });
  it("cancels animations when the page is hidden or the viewport changes", () => {
    const cancel = vi.fn(); animate.mockImplementation(() => ({ cancel, playState: "running" }));
    const view = render(<Example enter />);
    window.dispatchEvent(new Event("resize")); expect(cancel).toHaveBeenCalledTimes(1);
    view.rerender(<Example value="all" height={280} enter />);
    document.dispatchEvent(new Event("visibilitychange")); expect(cancel).toHaveBeenCalledTimes(3);
  });
});
