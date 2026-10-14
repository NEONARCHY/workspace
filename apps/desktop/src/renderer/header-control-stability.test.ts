import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps selected and idle header segments at the same font weight", () => {
  const css = readFileSync("src/renderer/section-headers.css", "utf8");
  const active = css.match(/\.ws-section-header :is\(\.view-switch, \.process-view-tabs, \.approval-mode-switch, \.ws2-segmented\) > button:is\(\.active, \[aria-pressed="true"\], \[aria-selected="true"\]\) \{([^}]+)\}/)?.[1];
  expect(active).toContain("font-weight: 600;");
  expect(active).not.toContain("font-weight: 700;");
});

it("gives date navigation individual fixed-size buttons without a background shell", () => {
  const css = readFileSync("src/renderer/section-headers.css", "utf8");
  expect(css).toMatch(/html body \.app-provider \.ws-section-header \.calendar-month-navigation \{[^}]*background: transparent;/);
  expect(css).toMatch(/\.calendar-month-navigation \.fui-Button \{[^}]*height: 36px;[^}]*border-radius: 10px;/);
  expect(css).toContain(".fui-Button:not([aria-label]) { min-width: 76px; }");
  expect(readFileSync("src/renderer/workspace-2-tasks.css", "utf8")).toContain(".task-calendar-navigation-slot { flex: 0 0 auto;");
});
