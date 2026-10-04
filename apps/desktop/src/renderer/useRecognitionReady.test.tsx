import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRecognitionReady } from "./useRecognitionReady";

function Card() {
  const ref = useRef<HTMLButtonElement>(null);
  const ready = useRecognitionReady(ref);
  return <div className="fui-DialogContent"><button ref={ref}>{ready ? "Prepared" : "Copy without expensive layers"}</button></div>;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("recognition preparation", () => {
  it("prepares only near the profile viewport, retains readiness and disconnects on cleanup", () => {
    vi.useFakeTimers();
    let callback!: IntersectionObserverCallback;
    const disconnect = vi.fn(), observe = vi.fn(), unobserve = vi.fn();
    let options: IntersectionObserverInit | undefined;
    const observer = { observe, unobserve, disconnect } as unknown as IntersectionObserver;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(cb: IntersectionObserverCallback, opts: IntersectionObserverInit) { callback = cb; options = opts; }
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    });
    render(<Card />);
    expect(options?.root).toBe(document.querySelector(".fui-DialogContent"));
    expect(options?.rootMargin).toBe("240px 0px");
    const target = screen.getByRole("button");
    act(() => callback([{ isIntersecting: false, target } as IntersectionObserverEntry], observer));
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole("button")).toHaveTextContent("Copy without expensive layers");
    act(() => callback([{ isIntersecting: true, target } as IntersectionObserverEntry], observer));
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole("button")).toHaveTextContent("Prepared");
    cleanup(); expect(disconnect).toHaveBeenCalled();
  });
  it("prepares immediately for keyboard focus and cancels queued work on unmount", () => {
    vi.useFakeTimers();
    const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect = disconnect; });
    render(<Card />);
    fireEvent.focusIn(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("Prepared");
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });
});
