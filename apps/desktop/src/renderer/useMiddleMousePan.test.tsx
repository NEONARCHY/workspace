import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useMiddleMousePan } from "./useMiddleMousePan";

function PanSurface() {
  const pan = useMiddleMousePan<HTMLDivElement>();
  return <div className="middle-pan-surface" data-testid="surface" {...pan} />;
}

function pointerEvent(type: string, init: MouseEventInit & { pointerId: number }) {
  const event = new MouseEvent(type, { bubbles: true, ...init });
  Object.defineProperty(event, "pointerId", { value: init.pointerId });
  return event;
}

afterEach(cleanup);

describe("useMiddleMousePan", () => {
  it("moves a horizontal surface while the middle mouse button is held", () => {
    const { getByTestId } = render(<PanSurface />);
    const surface = getByTestId("surface");
    surface.scrollLeft = 120;

    fireEvent(surface, pointerEvent("pointerdown", { button: 1, pointerId: 7, clientX: 180 }));
    expect(surface).toHaveClass("is-middle-panning");
    fireEvent(surface, pointerEvent("pointermove", { button: 1, pointerId: 7, clientX: 120 }));
    expect(surface.scrollLeft).toBe(180);
    fireEvent(surface, pointerEvent("pointerup", { button: 1, pointerId: 7, clientX: 120 }));
    expect(surface).not.toHaveClass("is-middle-panning");
  });

  it("does not take over the primary mouse button", () => {
    const { getByTestId } = render(<PanSurface />);
    const surface = getByTestId("surface");
    surface.scrollLeft = 80;

    fireEvent(surface, pointerEvent("pointerdown", { button: 0, pointerId: 3, clientX: 140 }));
    fireEvent(surface, pointerEvent("pointermove", { button: 0, pointerId: 3, clientX: 80 }));

    expect(surface.scrollLeft).toBe(80);
    expect(surface).not.toHaveClass("is-middle-panning");
  });
});
