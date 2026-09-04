import { Profiler } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnimatedAmount, amountAnimationMs, interpolateMinorUnits } from "./AnimatedAmount";
import { formatMinorUnits } from "./approval-board";

function animationClock() {
  let now = 0, nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId; });
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  return { frames, request, media, advance(time: number) {
    now = time;
    const pending = [...frames.values()]; frames.clear();
    act(() => pending.forEach((callback) => callback(time)));
  } };
}
const visual = (container: HTMLElement) => container.querySelector(".amount-visual")!.textContent;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Animated monetary totals", () => {
  it("interpolates huge positive and negative integer hundredths exactly and monotonically", () => {
    const start = 999999999999999999999999n, end = -12345n;
    expect(interpolateMinorUnits(start, end, -1)).toBe(start);
    expect(interpolateMinorUnits(start, end, 1)).toBe(end);
    expect(interpolateMinorUnits(start, end, 2)).toBe(end);
    expect(interpolateMinorUnits(0n, 800n, .5)).toBe(700n);
    let previous = start;
    for (let i = 0; i <= 100; i++) {
      const value = interpolateMinorUnits(start, end, i / 100);
      expect(value <= previous && value >= end).toBe(true); previous = value;
    }
  });
  it("shows the exact value on mount and does not animate unchanged props", () => {
    const clock = animationClock();
    const { container, rerender } = render(<AnimatedAmount currency="UZS" minorUnits={2500000019n} />);
    expect(visual(container)).toBe(formatMinorUnits(2500000019n, "UZS"));
    rerender(<AnimatedAmount currency="UZS" minorUnits={2500000019n} />);
    expect(clock.request).not.toHaveBeenCalled();
  });
  it("animates up, preserves fractional totals, and exposes only the exact target to assistive technology", () => {
    const clock = animationClock();
    const { container, rerender } = render(<AnimatedAmount currency="UZS" minorUnits={0n} />);
    rerender(<AnimatedAmount currency="UZS" minorUnits={2500000019n} />);
    expect(container.querySelector(".amount-accessible")!.textContent).toBe(formatMinorUnits(2500000019n, "UZS"));
    expect(container.querySelector(".amount-visual")).toHaveAttribute("aria-hidden", "true");
    expect(visual(container)).toBe("0 UZS");
    clock.advance(130);
    expect(visual(container)).toBe(formatMinorUnits(interpolateMinorUnits(0n, 2500000019n, .5), "UZS"));
    clock.advance(amountAnimationMs);
    expect(visual(container)).toBe(formatMinorUnits(2500000019n, "UZS"));
    expect(container.querySelector("[data-animating]")).toBeNull();
    expect(clock.frames.size).toBe(0);
  });
  it("animates down to an exact zero", () => {
    const clock = animationClock();
    const { container, rerender } = render(<AnimatedAmount currency="UZS" minorUnits={125099n} />);
    rerender(<AnimatedAmount currency="UZS" minorUnits={0n} />);
    clock.advance(100); expect(visual(container)).not.toBe("0 UZS");
    clock.advance(260); expect(visual(container)).toBe("0 UZS");
  });
  it("retargets from the currently displayed amount and cancels the old frame", () => {
    const clock = animationClock();
    const { container, rerender } = render(<AnimatedAmount currency="USD" minorUnits={0n} />);
    rerender(<AnimatedAmount currency="USD" minorUnits={800n} />);
    clock.advance(130); expect(visual(container)).toBe("7 USD");
    rerender(<AnimatedAmount currency="USD" minorUnits={-500n} />);
    expect(visual(container)).toBe("7 USD"); expect(clock.frames.size).toBe(1);
    clock.advance(390); expect(visual(container)).toBe("−5 USD");
    expect(clock.frames.size).toBe(0);
  });
  it("never interpolates across currencies or invalid data", () => {
    const clock = animationClock();
    const { container, rerender } = render(<AnimatedAmount currency="USD" minorUnits={900n} />);
    rerender(<AnimatedAmount currency="UZS" minorUnits={800n} />);
    expect(visual(container)).toBe("8 UZS");
    rerender(<AnimatedAmount currency="UZS" minorUnits={null} />);
    expect(visual(container)).toBe("Проверьте сумму (UZS)");
    rerender(<AnimatedAmount currency="UZS" minorUnits={500n} />);
    expect(visual(container)).toBe("5 UZS"); expect(clock.frames.size).toBe(0);
  });
  it("respects reduced motion and a preference change mid-animation", () => {
    const clock = animationClock(); clock.media.matches = true;
    const { container, rerender } = render(<AnimatedAmount currency="UZS" minorUnits={0n} />);
    rerender(<AnimatedAmount currency="UZS" minorUnits={500n} />);
    expect(visual(container)).toBe("5 UZS"); expect(clock.frames.size).toBe(0);
    clock.media.matches = false;
    rerender(<AnimatedAmount currency="UZS" minorUnits={900n} />);
    expect(clock.frames.size).toBe(1);
    clock.media.matches = true;
    act(() => clock.media.dispatchEvent(new Event("change")));
    expect(visual(container)).toBe("9 UZS"); expect(clock.frames.size).toBe(0);
  });
  it("settles immediately when the app is hidden, and does not schedule hidden work", () => {
    const clock = animationClock();
    const { container, rerender } = render(<AnimatedAmount currency="UZS" minorUnits={0n} />);
    rerender(<AnimatedAmount currency="UZS" minorUnits={500n} />);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(visual(container)).toBe("5 UZS"); expect(clock.frames.size).toBe(0);
    rerender(<AnimatedAmount currency="UZS" minorUnits={100n} />);
    expect(visual(container)).toBe("1 UZS"); expect(clock.frames.size).toBe(0);
  });
  it("does not animate columns outside the viewport", () => {
    const clock = animationClock();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 10000, right: 10100, top: 0, bottom: 100 } as DOMRect);
    const { container, rerender } = render(<AnimatedAmount currency="UZS" minorUnits={0n} />);
    rerender(<AnimatedAmount currency="UZS" minorUnits={500n} />);
    expect(visual(container)).toBe("5 UZS"); expect(clock.frames.size).toBe(0);
  });
  it("cancels frames on unmount and does not re-render React on animation frames", () => {
    const clock = animationClock(), onRender = vi.fn();
    const { rerender, unmount } = render(<Profiler id="amount" onRender={onRender}><AnimatedAmount currency="UZS" minorUnits={0n} /></Profiler>);
    rerender(<Profiler id="amount" onRender={onRender}><AnimatedAmount currency="UZS" minorUnits={500n} /></Profiler>);
    const renders = onRender.mock.calls.length;
    clock.advance(30); clock.advance(80); clock.advance(120);
    expect(onRender).toHaveBeenCalledTimes(renders);
    unmount(); expect(clock.frames.size).toBe(0);
  });
});
