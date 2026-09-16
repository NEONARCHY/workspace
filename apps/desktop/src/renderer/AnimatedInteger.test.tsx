import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnimatedInteger } from "./AnimatedInteger";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("AnimatedInteger", () => {
  it("keeps the exact value available while the visual glyphs transition", () => {
    let callback: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => { callback = next; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("performance", { now: () => 0 });
    const { rerender } = render(<AnimatedInteger value={2} label="2 заявки" />);
    rerender(<AnimatedInteger value={7} label="7 заявок" />);
    expect(screen.getByLabelText("7 заявок")).toHaveTextContent("7");
    act(() => callback?.(220));
    expect(screen.getByLabelText("7 заявок").querySelector(".integer-visual")).toHaveTextContent("7");
  });

  it("settles immediately when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { rerender } = render(<AnimatedInteger value={1} />);
    rerender(<AnimatedInteger value={3} />);
    expect(document.querySelector(".integer-visual")).toHaveTextContent("3");
  });
});
