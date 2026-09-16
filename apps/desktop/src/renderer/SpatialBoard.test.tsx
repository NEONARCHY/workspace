import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { SpatialBoard, SpatialCard, SpatialLane } from "./SpatialBoard";
import { dropSpatialCard, installSpatialGeometry, startSpatialDrag } from "./spatial-test-helpers";

beforeEach(() => { installSpatialGeometry(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(allowed = true, onMove = vi.fn(async () => undefined)) {
  render(<SpatialBoard interactionMode="payment" canDrop={(_, lane) => allowed && lane === "next"} onMove={onMove}>
    <SpatialLane id="start"><SpatialCard id="one" lane="start" label="План" disabled={!allowed}><button>План</button></SpatialCard></SpatialLane>
    <SpatialLane id="next">Согласование</SpatialLane><SpatialLane id="closed">Архив</SpatialLane>
  </SpatialBoard>);
  return { onMove, card: document.querySelector('[data-spatial-card="one"]')!, next: document.querySelector('[data-spatial-lane="next"]')! };
}
describe("Spatial object transfer", () => {
  it("lifts a real overlay, preserves the source and highlights only allowed destinations", async () => {
    const { card, next, onMove } = setup();
    await startSpatialDrag(card, next);
    expect(document.querySelector(".spatial-drag-preview")).not.toBeNull();
    expect(card).toHaveClass("is-lifted");
    expect(next).toHaveClass("is-target");
    expect(document.querySelector('[data-spatial-lane="closed"]')).not.toHaveClass("is-receptive");
    expect(document.querySelector('[draggable="true"]')).toBeNull();
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(onMove).not.toHaveBeenCalled();
  });
  it("shows restrained feedback over an unavailable destination and never executes it", async () => {
    const { card, next, onMove } = setup();
    const closed = document.querySelector('[data-spatial-lane="closed"]')!;
    await startSpatialDrag(card, next);
    const destination = closed.getBoundingClientRect();
    await act(async () => {
      fireEvent.pointerMove(document, { clientX: destination.left + 120, clientY: destination.top + 150, pointerId: 1, isPrimary: true });
    });
    expect(closed).toHaveClass("is-unavailable");
    expect(closed).toHaveAttribute("data-drop-state", "unavailable");
    expect(closed).toHaveTextContent("Недоступно для переноса");
    await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, isPrimary: true }); });
    expect(onMove).not.toHaveBeenCalled();
  });
  it("calls the existing mutation once and leaves the canonical source unchanged without confirmation", async () => {
    const { card, next, onMove } = setup();
    await dropSpatialCard(card, next);
    await waitFor(() => expect(onMove).toHaveBeenCalledExactlyOnceWith("one", "next"));
    expect(card.closest("[data-spatial-lane]")).toHaveAttribute("data-spatial-lane", "start");
  });
  it("does not offer or execute a drag without permission", async () => {
    const { card, next, onMove } = setup(false);
    expect(screen.queryByRole("button", { name: "Перенести: План" })).toBeNull();
    await dropSpatialCard(card, next);
    expect(onMove).not.toHaveBeenCalled();
  });
  it("keeps the object at its source until confirmation, then settles in the canonical destination", async () => {
    let confirm!: () => void;
    const accepted = new Promise<void>(resolve => { confirm = resolve; });
    function ConfirmedBoard() {
      const [lane, setLane] = useState("start");
      return <SpatialBoard canDrop={(_, target) => target === "next"} onMove={async () => { await accepted; setLane("next"); }}>
        {["start", "next"].map(id => <SpatialLane id={id} key={id}>{lane === id ? <SpatialCard id="one" lane={lane} label="План"><button>План</button></SpatialCard> : null}</SpatialLane>)}
      </SpatialBoard>;
    }
    render(<ConfirmedBoard />);
    await dropSpatialCard(document.querySelector('[data-spatial-card="one"]')!, document.querySelector('[data-spatial-lane="next"]')!);
    expect(document.querySelector('[data-spatial-lane="start"] [data-spatial-card="one"]')).not.toBeNull();
    expect(screen.getByText("Сохраняем переход…")).toHaveAttribute("role", "status");
    await act(async () => { confirm(); await accepted; });
    await waitFor(() => expect(document.querySelector('[data-spatial-lane="next"] [data-spatial-card="one"]')).not.toBeNull());
    await waitFor(() => expect(document.querySelector('[data-spatial-card="one"]')).not.toHaveClass("is-lifted"));
  });
  it("restores the source and permits retry after a server rejection", async () => {
    const onMove = vi.fn(async () => { throw new Error("Permission changed"); });
    const { card, next } = setup(true, onMove);
    await dropSpatialCard(card, next);
    await waitFor(() => expect(screen.getByText(/Переход не подтверждён/)).toHaveAttribute("role", "status"));
    await waitFor(() => expect(card).not.toHaveClass("is-lifted"));
    expect(card.closest("[data-spatial-lane]")).toHaveAttribute("data-spatial-lane", "start");
    await dropSpatialCard(card, next);
    expect(onMove).toHaveBeenCalledTimes(2);
  });
  it("cancels a keyboard lift without changing data", async () => {
    const { onMove } = setup();
    const handle = screen.getByRole("button", { name: "Перенести: План" });
    handle.focus();
    fireEvent.keyDown(handle, { key: " ", code: "Space" });
    await waitFor(() => expect(document.querySelector(".spatial-drag-preview")).not.toBeNull());
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(document.querySelector(".spatial-card")).not.toHaveClass("is-lifted"));
    expect(onMove).not.toHaveBeenCalled();
  });
});
