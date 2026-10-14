import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("treats expand/collapse as geometry, not a separate orb flight", () => {
  const source = readFileSync("src/renderer/YuksalishAssistant.tsx", "utf8");
  expect(source).toContain('geometryKey: `${viewport.width}:${viewport.height}:${viewport.zoom}:${expanded}`');
  expect(source).toContain("sizeOrbFromRef.current = travellingOrbRef.current?.getBoundingClientRect()");
  expect(source).toContain("orbTransform(orbPose(orbFrom, viewport.zoom))");
  expect(source).toContain("orbTransform(orbPose(orbTo, viewport.zoom))");
  expect(source.match(/duration: 220, easing: "cubic-bezier\(\.2, 0, 0, 1\)"/g)).toHaveLength(2);
  expect(source).toContain("orbResize?.cancel()");
});
