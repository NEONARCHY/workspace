import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("retains common header geometry while matching the light header's teal accents in dark mode", () => {
  const css = readFileSync("src/renderer/team-dashboard.css", "utf8");
  expect(css).toContain("background: var(--team-flow-header-accent,");
  expect(css).toContain("rgb(114 206 211 / 78%)");
  expect(css).toContain("rgb(143 209 161 / 66%)");
  expect(css).toContain("background: #20363b");
  expect(css).toContain("border-color: #456970");
  expect(css).toContain("@media (forced-colors: none)");
});
