import { afterEach, describe, expect, it } from "vitest";
import { launcherCoordinates, miniMessengerBounds, normalizedPosition, readMessengerPosition } from "./floating-messenger-layout";
afterEach(() => localStorage.clear());
describe("floating messenger geometry", () => {
  it.each([[1440, 900], [1024, 768], [360, 640], [320, 300]])("keeps both objects inside %s × %s at every corner", (width, height) => {
    const viewport = { width, height, top: 40, left: 0, zoom: 1 };
    for (const x of [0, .5, 1]) for (const y of [0, .5, 1]) {
      const point = launcherCoordinates({ x, y }, viewport);
      expect(point.x).toBeGreaterThanOrEqual(16);
      expect(point.y).toBeGreaterThanOrEqual(56);
      expect(point.x + 48).toBeLessThanOrEqual(width - 16);
      expect(point.y + 48).toBeLessThanOrEqual(height + 40 - 16);
      const box = miniMessengerBounds({ x, y }, viewport);
      expect(box.left).toBeGreaterThanOrEqual(16);
      expect(box.top).toBeGreaterThanOrEqual(56);
      expect(box.left + box.width).toBeLessThanOrEqual(width - 16);
      expect(box.top + box.height).toBeLessThanOrEqual(height + 40 - 16);
    }
  });
  it("clamps offscreen drags and preserves relative position after resize", () => {
    const viewport = { width: 1440, height: 900, top: 0, left: 0, zoom: 1 };
    expect(normalizedPosition(-999, 9999, viewport)).toEqual({ x: 0, y: 1 });
    const point = launcherCoordinates({ x: .3, y: .7 }, viewport);
    expect(normalizedPosition(point.x, point.y, viewport).x).toBeCloseTo(.3);
    expect(normalizedPosition(point.x, point.y, viewport).y).toBeCloseTo(.7);
  });
  it("replaces the launcher footprint instead of leaving a gap above it", () => {
    const viewport = { width: 1440, height: 900, top: 0, left: 0, zoom: 1 };
    const point = launcherCoordinates({ x: 1, y: 1 }, viewport);
    const box = miniMessengerBounds({ x: 1, y: 1 }, viewport);
    expect(box.left + box.width).toBe(point.x + 48);
    expect(box.top + box.height).toBe(point.y + 48);
  });
  it("rejects malformed preferences and isolates users", () => {
    localStorage.setItem("first", '{"x":0.1,"y":0.2}');
    localStorage.setItem("second", '{"x":"oops","y":0}');
    expect(readMessengerPosition("first")).toEqual({ x: .1, y: .2 });
    expect(readMessengerPosition("second")).toEqual({ x: 1, y: 1 });
    localStorage.setItem("second", "broken");
    expect(readMessengerPosition("second")).toEqual({ x: 1, y: 1 });
  });
});
