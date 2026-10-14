import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync("src/renderer/notification-sound-settings.css", "utf8");

it("uses real theme surfaces for the gradient and thumb feedback, without layout animation", () => {
  expect(css).toContain("var(--ws-muted-surface)");
  expect(css).not.toContain("var(--ws-surface-muted)");
  expect(css).toContain("linear-gradient(90deg, #c96970, #c4a457 48%, #399b7c)");
  expect(css).toContain("transition: transform 160ms");
  expect(css).toContain("transform: scale(1.25)");
  expect(css).not.toMatch(/transition:\s*(all|width|height|box-shadow)/);
});

it("preserves keyboard focus, native system colours and reduced-motion feedback", () => {
  expect(css).toContain("input:focus-visible");
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  expect(css).toContain("@media (forced-colors: active)");
  expect(css).toContain("appearance: auto");
  expect(css).toContain("transition: none; transform: none");
});
