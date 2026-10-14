import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync("src/renderer/task-composer-sections.css", "utf8");
it("groups every task creation section in one real rounded surface", () => {
  expect(css).toContain(".task-composer .record-section");
  expect(css).toContain("border: 1px solid var(--ws-line)");
  expect(css).toContain("--ws-satin-fill");
  expect(readFileSync("src/renderer/satin-surfaces.css", "utf8")).toContain(".task-composer .record-section");
  expect(css).toContain("border-color: CanvasText");
});
it("gives all three dependency controls identical geometry with a narrow-screen stack", () => {
  expect(css).toContain("repeat(3, minmax(0, 1fr))");
  expect(css).toContain("height: 52px");
  expect(css).toContain("width: 100%");
  expect(css).toContain("justify-self: stretch");
  expect(css).toContain("max-width: 720px");
});
it("rotates the persistent plus smoothly in both directions and respects reduced motion", () => {
  expect(css).toContain("transition: transform 240ms");
  expect(css).toContain("transform: rotate(0deg)");
  expect(css).toContain("transform: rotate(45deg)");
  expect(css).toContain("prefers-reduced-motion: reduce");
  expect(css).not.toMatch(/content:|animation:|!important/);
});
