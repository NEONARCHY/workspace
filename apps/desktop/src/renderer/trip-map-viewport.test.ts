import { describe, expect, it } from "vitest";
import { fitTripMapPoints, interpolateTripMapViewport, tripMapViewBox,
  worldViewport, zoomTripMapAt } from "./trip-map-viewport";

describe("trip map viewport", () => {
  it("keeps the point under the cursor fixed while zooming", () => {
    const before = tripMapViewBox(worldViewport);
    const pointX = before.left + before.width * 0.72;
    const pointY = before.top + before.height * 0.3;
    const after = tripMapViewBox(zoomTripMapAt(worldViewport, 2, 0.72, 0.3));
    expect(after.left + after.width * 0.72).toBeCloseTo(pointX);
    expect(after.top + after.height * 0.3).toBeCloseTo(pointY);
    expect(after.width).toBe(500);
  });

  it("clamps wheel zoom and pans to the world edges", () => {
    expect(zoomTripMapAt(worldViewport, 100, 0.5, 0.5).zoom).toBe(8);
    const edge = zoomTripMapAt(worldViewport, 4, 0, 0);
    expect(tripMapViewBox(edge).left).toBe(0);
    expect(tripMapViewBox(edge).top).toBe(0);
  });

  it("frames nearby trips while keeping distant trips visible", () => {
    const nearby = fitTripMapPoints([{ x: 690, y: 135 }, { x: 700, y: 148 }]);
    expect(nearby.zoom).toBeGreaterThan(3);
    const box = tripMapViewBox(nearby);
    expect(box.left).toBeLessThan(690);
    expect(box.left + box.width).toBeGreaterThan(700);
    expect(fitTripMapPoints([{ x: 100, y: 100 }, { x: 900, y: 400 }]).zoom).toBeCloseTo(1.08, 1);
    expect(fitTripMapPoints([])).toEqual(worldViewport);
  });

  it("animates between positions without overshooting and can finish immediately", () => {
    const target = fitTripMapPoints([{ x: 700, y: 140 }]);
    const middle = interpolateTripMapViewport(worldViewport, target, 0.5);
    expect(middle.zoom).toBeGreaterThan(1);
    expect(middle.zoom).toBeLessThan(target.zoom);
    expect(interpolateTripMapViewport(worldViewport, target, 1)).toEqual(target);
  });
});
