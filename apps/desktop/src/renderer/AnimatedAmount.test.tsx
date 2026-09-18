import { Profiler } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnimatedAmount, amountAnimationMs, interpolateMinorUnits } from "./AnimatedAmount";
import { formatMinorUnits } from "./approval-board";

afterEach(cleanup);

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
      expect(value <= previous && value >= end).toBe(true);
      previous = value;
    }
  });

  it("shows the exact value on mount without rolling digits", () => {
    const formatted = formatMinorUnits(2500000019n, "UZS");
    const { container } = render(<AnimatedAmount currency="UZS" minorUnits={2500000019n} />);
    expect(container.querySelector(".animated-amount")).toHaveAttribute("data-total-value", formatted);
    expect(container.querySelector(".amount-accessible")?.textContent).toBe(formatted);
    expect(container.querySelectorAll(".is-rolling")).toHaveLength(0);
  });

  it("rolls only changed digits and keeps the exact target available to assistive technology", () => {
    const { container, rerender } = render(<AnimatedAmount currency="UZS" minorUnits={1240000000n} />);
    rerender(<AnimatedAmount currency="UZS" minorUnits={1250000000n} />);
    const formatted = formatMinorUnits(1250000000n, "UZS");
    expect(container.querySelector(".animated-amount")).toHaveAttribute("data-animating", "true");
    expect(container.querySelector(".amount-accessible")?.textContent).toBe(formatted);
    expect(container.querySelector(".amount-visual")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll(".amount-digit-old").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".amount-digit-old")).toHaveLength(container.querySelectorAll(".amount-digit-new").length);
    expect(amountAnimationMs).toBe(320);
  });

  it("does not roll across currencies, invalid values, or unchanged props", () => {
    const { container, rerender } = render(<AnimatedAmount currency="USD" minorUnits={900n} />);
    rerender(<AnimatedAmount currency="UZS" minorUnits={800n} />);
    expect(container.querySelectorAll(".is-rolling")).toHaveLength(0);
    rerender(<AnimatedAmount currency="UZS" minorUnits={null} />);
    expect(container.querySelector(".amount-accessible")).toHaveTextContent("Проверьте сумму (UZS)");
    expect(container.querySelectorAll(".is-rolling")).toHaveLength(0);
    rerender(<AnimatedAmount currency="UZS" minorUnits={500n} />);
    expect(container.querySelectorAll(".is-rolling")).toHaveLength(0);
    rerender(<AnimatedAmount currency="UZS" minorUnits={500n} />);
    expect(container.querySelectorAll(".is-rolling")).toHaveLength(0);
  });

  it("uses CSS animation and does not schedule frames or re-render React continuously", () => {
    const request = vi.spyOn(window, "requestAnimationFrame");
    const onRender = vi.fn();
    const { rerender } = render(<Profiler id="amount" onRender={onRender}><AnimatedAmount currency="UZS" minorUnits={0n} /></Profiler>);
    rerender(<Profiler id="amount" onRender={onRender}><AnimatedAmount currency="UZS" minorUnits={500n} /></Profiler>);
    expect(onRender).toHaveBeenCalledTimes(2);
    expect(request).not.toHaveBeenCalled();
  });
});
