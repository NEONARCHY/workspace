import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/renderer/trip-map.css", "utf8");
const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split("}")[0];

describe("trip map layout", () => {
  it("keeps the full rounded map reachable instead of clipping its bottom", () => {
    expect(rule(".trips-view.trip-map-mode")).toContain("overflow-y: auto");
    expect(rule(".trip-map-stage")).toContain("border-radius: 20px");
    expect(rule(".trip-map-stage")).toContain("overflow: hidden");
    expect(rule(".trip-map-svg")).toContain("border-radius: inherit");
    // Preserve the projection's aspect ratio and pointer/zoom coordinate mapping.
    expect(rule(".trip-map-stage")).toContain("aspect-ratio: 2 / 1");
  });

  it("prevents the icon-only clear button from stretching with the heading", () => {
    const button = rule(".trip-map-selected-heading > .trip-map-clear-selection");
    expect(button).toContain("align-self: flex-start");
    expect(button).toContain("width: 36px");
    expect(button).toContain("height: 36px");
    expect(button).toContain("flex: 0 0 36px");
    expect(css).toMatch(/@media \(any-pointer: coarse\)[^}]+width: 48px[^}]+height: 48px/);
  });
});
