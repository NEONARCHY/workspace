import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync("src/renderer/workspace-select-motion.css", "utf8");
it("retains dark rising fills without moving labels or field geometry", () => {
  expect(css).toContain("background-position: center bottom;");
  expect(css).toContain("background-size: 100% 0%;");
  expect(css).toContain("background-size: 100% calc(100% + 12px);");
  expect(css).toContain("background-size 320ms cubic-bezier(.2, 0, 0, 1)");
  expect(css).not.toMatch(/transform:|mask:|outline:/);
});
it("reveals only the light focus border upwards from the hover underline", () => {
  expect(css).toContain('html:not([data-color-theme="dark"])');
  expect(css).toContain("border-color: var(--ws-select-neutral-border);");
  expect(css).toContain("border: 1px solid var(--ws-field-focus-border);");
  expect(css).toContain("inset: -1px;");
  expect(css).toContain("pointer-events: none;");
  expect(css).toContain("calc(100% - 10px)");
  expect(css).toContain("50% 0, 50% 1px, 50% 1px, 50% 0");
  expect(css).toContain("clip-path: polygon(");
  expect(css).toContain("animation: ws-select-border-close 420ms");
  expect(css).toContain("48% { clip-path: polygon");
  expect(css).not.toContain("@property");
  expect(css).toContain(':not([aria-invalid="true"]):not(:has([aria-invalid="true"]))');
});
it("supports both themes, reduced motion and disabled fields while retaining priority colours", () => {
  expect(css).toContain("@media (forced-colors: none)");
  expect(css).toContain('html[data-color-theme="dark"]');
  expect(css).toContain("--ws-select-hover-fill: var(--ws-button-hover");
  expect(css).toContain("prefers-reduced-motion: reduce");
  expect(css).toContain("transition: none;");
  expect(css).toContain(':not([aria-disabled="true"]):not(:has(:disabled))');
  expect(css).toContain(":not(.workspace-priority-select)");
});
