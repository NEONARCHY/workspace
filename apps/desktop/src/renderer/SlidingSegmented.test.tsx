import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlidingSegmented } from "./SlidingSegmented";

afterEach(cleanup);

describe("SlidingSegmented", () => {
  it("moves the shared indicator to the newly selected button", () => {
    const rect = (left: number, width: number) => ({
      left, top: 0, right: left + width, bottom: 36, width, height: 36,
      x: left, y: 0, toJSON: () => ({}),
    });
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.textContent === "Центральный аппарат") return rect(5, 160);
        if (this.textContent === "Регионы") return rect(165, 160);
        return rect(0, 330);
      });
    function Example() {
      const [value, setValue] = useState("central");
      return <SlidingSegmented as="nav" aria-label="География">
        <button aria-pressed={value === "central"} onClick={() => setValue("central")}>Центральный аппарат</button>
        <button aria-pressed={value === "regional"} onClick={() => setValue("regional")}>Регионы</button>
      </SlidingSegmented>;
    }
    try {
      const view = render(<Example />);
      const indicator = view.container.querySelector<HTMLElement>(".sliding-segmented-indicator");
      expect(screen.getByRole("navigation", { name: "География" })).toBeInTheDocument();
      expect(indicator).toHaveStyle({ transform: "translate(5px, 0px)", width: "160px" });
      fireEvent.click(screen.getByRole("button", { name: "Регионы" }));
      expect(indicator).toHaveStyle({ transform: "translate(165px, 0px)" });
    } finally {
      bounds.mockRestore();
    }
  });
});
