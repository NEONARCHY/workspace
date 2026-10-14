import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("centres shared record-list empty copy in the remaining body, without stretching the header", () => {
  const css = readFileSync("src/renderer/record-lists.css", "utf8");
  expect(css).toContain(".record-table-scroll:has(> .record-table-empty) { display: flex; flex-direction: column; }");
  expect(css).toContain(".record-table-scroll:has(> .record-table-empty) > .record-table { flex: none; }");
  expect(css).toMatch(/\.record-table-empty \{[^}]*flex: 1;[^}]*align-content: center;[^}]*justify-items: center;/);
});

it("fills the attention card body only when empty, preserving populated row layout", () => {
  const css = readFileSync("src/renderer/team-dashboard.css", "utf8");
  expect(css).toMatch(/\.team-dash-attention \{\s*display: flex;\s*flex-direction: column;/);
  expect(css).toMatch(/\.team-dash-attention-list:has\(> \.team-dash-empty\) \{\s*flex: 1;\s*grid-template-rows: minmax\(210px, 1fr\);/);
  expect(css).toMatch(/\.team-dash-empty \{[^}]*align-items: center;[^}]*justify-content: center;[^}]*text-align: center;/);
});
