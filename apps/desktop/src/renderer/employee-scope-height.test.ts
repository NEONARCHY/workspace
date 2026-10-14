import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("matches employee toolbar height without changing scope switches elsewhere", () => {
  const css = readFileSync("src/renderer/employee-scope.css", "utf8");
  expect(css).toContain(".employees-view .record-list-controls > .employee-scope-switch { box-sizing: border-box; flex: none; height: 34px; }");
  expect(css).toContain(".employee-scope-switch > button { flex: 0 0 auto; min-height: 26px;");
});
