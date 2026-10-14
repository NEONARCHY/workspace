import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("highlights profile actions without lift, translation or raised shadows", () => {
  const css = readFileSync("src/renderer/workspace-2-interactions.css", "utf8");
  const hover = css.match(/\.identity-popover-actions \.fui-Button:is\(:hover, :focus-visible\) \{([^}]+)\}/)?.[1];
  expect(hover).toContain("background: var(--ws-theme-surface-soft");
  expect(hover).toContain("transform: none;");
  expect(hover).toContain("box-shadow: none;");
  expect(css).toContain(".identity-popover-actions .fui-Button:active { box-shadow: none; transform: none; }");
});

it("does not translate shared menu items and dropdown options on hover", () => {
  const css = readFileSync("src/renderer/workspace-2-interactions.css", "utf8");
  const hover = css.match(/:is\(\.fui-MenuItem\.fui-MenuItem, \.fui-Option\.fui-Option\):hover \{([^}]+)\}/)?.[1];
  expect(hover).toContain("transform: none;");
  expect(hover).not.toContain("translate");
});
