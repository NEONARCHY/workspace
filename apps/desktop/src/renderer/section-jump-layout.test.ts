import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps a labelled search field on desktop and tablet and hides it only on phones", () => {
  const css = readFileSync("src/renderer/workspace-topbar.css", "utf8");
  const component = readFileSync("src/renderer/SectionJump.tsx", "utf8");
  expect(component).toContain('placeholder="Поиск и быстрый переход"');
  expect(component).toContain("contentAfter={<kbd>Ctrl K</kbd>}");
  expect(css).toContain("width: min(430px, 100%); min-width: 180px; max-width: 430px;");
  expect(css).toContain("@media (max-width: 700px)");
  expect(css).toContain(".section-jump-trigger { display: none; }");
  expect(readFileSync("src/renderer/spatial-workspace.css", "utf8")).toContain(".section-jump-dialog .section-jump-results { margin-block-start: 12px;");
  expect(readFileSync("src/renderer/spatial-workspace.css", "utf8")).not.toContain(".section-jump-trigger > span { display: inline !important; }");
});
