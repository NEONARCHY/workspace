import { useRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCardTilt } from "./useCardTilt";

function Card({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useCardTilt(ref, enabled);
  return <article ref={ref} data-testid="card" />;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(reduced = false) {
  let next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduced && query.includes("reduced-motion"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const result = render(<Card />);
  const card = screen.getByTestId("card");
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 100 } as DOMRect);
  const flush = () => act(() => { for (let i = 0; i < 100 && frames.size; i++) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(i * 16)); } });
  const move = (pointerType = "mouse") => {
    const event = new Event("pointermove");
    Object.defineProperties(event, { pointerType: { value: pointerType }, clientX: { value: 200 }, clientY: { value: 100 }, buttons: { value: 0 } });
    card.dispatchEvent(event);
  };
  return { ...result, card, frames, flush, move };
}

describe("Achievement-like board card tilt", () => {
  it("follows the mouse, settles without an endless RAF and returns exactly flat", () => {
    const { card, frames, flush, move } = setup();
    move(); flush();
    expect(card.style.getPropertyValue("--ws-card-tilt-x")).toBe("-6deg");
    expect(card.style.getPropertyValue("--ws-card-tilt-y")).toBe("8deg");
    expect(frames.size).toBe(0);
    card.dispatchEvent(new Event("pointerleave")); flush();
    expect(card.style.getPropertyValue("--ws-card-tilt-x")).toBe("0deg");
    expect(card.style.getPropertyValue("--ws-card-tilt-y")).toBe("0deg");
  });
  it("clears on pointer down and on drag disable without cancelling input", () => {
    const { card, frames, move, flush, rerender } = setup();
    move(); flush();
    const down = new Event("pointerdown", { cancelable: true });
    card.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    expect(card.style.getPropertyValue("--ws-card-tilt-x")).toBe("");
    move();
    rerender(<Card enabled={false} />);
    expect(frames.size).toBe(0);
    expect(card).not.toHaveClass("has-pointer-tilt");
  });
  it("does not tilt for reduced motion or touch input", () => {
    const first = setup(true);
    first.move(); expect(first.frames.size).toBe(0);
    expect(first.card).not.toHaveClass("has-pointer-tilt");
    first.unmount();
    const second = setup();
    second.move("touch"); expect(second.frames.size).toBe(0);
  });
});
