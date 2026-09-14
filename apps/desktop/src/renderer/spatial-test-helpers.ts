import { act, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

/** jsdom has no layout/pointer implementation. Supply geometry, not mocked DnD logic. */
export function installSpatialGeometry() {
  class Pointer extends MouseEvent {
    readonly pointerId = 1;
    readonly isPrimary = true;
  }
  vi.stubGlobal("PointerEvent", Pointer);
  const fallback = HTMLElement.prototype.getBoundingClientRect;
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const lanes = [...document.querySelectorAll<HTMLElement>("[data-spatial-lane]")];
    const lane = this.closest<HTMLElement>("[data-spatial-lane]");
    if (!lane) return fallback.call(this);
    const index = lanes.indexOf(lane);
    const card = this.closest<HTMLElement>("[data-spatial-card]");
    const x = index * 320 + (card ? 12 : 0), y = card ? 100 : 0;
    const width = card ? 280 : 310, height = card ? 110 : 600;
    return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() {} } as DOMRect;
  });
}

export async function startSpatialDrag(card: Element, target: Element) {
  const rect = card.getBoundingClientRect(), destination = target.getBoundingClientRect();
  fireEvent.pointerDown(card.querySelector(".spatial-grip") ?? card, { clientX: rect.left + 40, clientY: rect.top + 35, button: 0, pointerId: 1, isPrimary: true });
  await act(async () => { fireEvent.pointerMove(document, { clientX: rect.left + 55, clientY: rect.top + 35, pointerId: 1, isPrimary: true }); });
  await act(async () => { fireEvent.pointerMove(document, { clientX: destination.left + 120, clientY: destination.top + 150, pointerId: 1, isPrimary: true }); });
}
export async function dropSpatialCard(card: Element, target: Element) {
  await startSpatialDrag(card, target);
  await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, isPrimary: true }); });
}
