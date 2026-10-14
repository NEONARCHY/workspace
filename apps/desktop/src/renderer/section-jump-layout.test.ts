import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the labelled wide section field and limits icon-only geometry to compact layouts", () => {
  const css = readFileSync("src/renderer/browser-responsive.css", "utf8");
  const component = readFileSync("src/renderer/SectionJump.tsx", "utf8");
  expect(component).toContain("<span>Поиск и быстрый переход</span><kbd>Ctrl K</kbd>");
  expect(css).toContain(".browser-compact .global-bar .section-jump-trigger { flex: none; width: 48px");
  expect(css).toContain("@media (max-width: 1023px)");
  expect(readFileSync("src/renderer/spatial-workspace.css", "utf8")).toContain(".section-jump-dialog .section-jump-results { margin-block-start: 12px;");
  expect(readFileSync("src/renderer/spatial-workspace.css", "utf8")).not.toContain(".section-jump-trigger > span { display: inline !important; }");
});
