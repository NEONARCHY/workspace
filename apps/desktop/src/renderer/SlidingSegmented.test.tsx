import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlidingSegmented } from "./SlidingSegmented";

let left = 5;
let width = 160;
let visible = true;
beforeEach(() => {
  left = 5; width = 160; visible = true;
  // Layout coordinates deliberately differ from transformed screen bounds.
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
    return this.textContent === "Регионы" ? left + width : left;
  });
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockReturnValue(4);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(() => visible ? width : 0);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => visible ? 36 : 0);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Example({ initial = "central" }: { readonly initial?: string }) {
  const [value, setValue] = useState(initial);
  return <SlidingSegmented as="nav" aria-label="География">
    <button aria-pressed={value === "central"} onClick={() => setValue("central")}>Центральный аппарат</button>
    <button aria-pressed={value === "regional"} onClick={() => setValue("regional")}>Регионы</button>
  </SlidingSegmented>;
}

describe("SlidingSegmented", () => {
  it("moves the shared indicator to the newly selected button", () => {
    const view = render(<Example />);
    const indicator = view.container.querySelector<HTMLElement>(".sliding-segmented-indicator");
    expect(screen.getByRole("navigation", { name: "География" })).toBeInTheDocument();
    expect(indicator).toHaveStyle({ transform: "translate(5px, 4px)", width: "160px", transition: "none" });
    fireEvent.click(screen.getByRole("button", { name: "Регионы" }));
    expect(indicator).toHaveStyle({ transform: "translate(165px, 4px)" });
    expect(indicator?.style.transition).toBe("");
  });
  it("places an already-selected second segment statically after remount", () => {
    const first = render(<Example />);
    fireEvent.click(screen.getByRole("button", { name: "Регионы" }));
    first.unmount();
    const next = render(<Example initial="regional" />);
    expect(next.container.querySelector(".sliding-segmented-indicator")).toHaveStyle({ transform: "translate(165px, 4px)", transition: "none" });
  });
  it("snaps resize and hidden-to-visible placement without cancelling a selection transition on identical remeasure", () => {
    let measure: (() => void) | undefined;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { measure = callback; }
      observe() {}
      disconnect() {}
    });
    const view = render(<Example />);
    const indicator = view.container.querySelector<HTMLElement>(".sliding-segmented-indicator");
    fireEvent.click(screen.getByRole("button", { name: "Регионы" }));
    act(() => measure?.());
    expect(indicator?.style.transition).toBe("");
    left = 7; width = 180;
    act(() => measure?.());
    expect(indicator).toHaveStyle({ transform: "translate(187px, 4px)", transition: "none" });
    visible = false;
    act(() => measure?.());
    visible = true;
    act(() => measure?.());
    expect(indicator).toHaveStyle({ transform: "translate(187px, 4px)", transition: "none" });
  });
});
