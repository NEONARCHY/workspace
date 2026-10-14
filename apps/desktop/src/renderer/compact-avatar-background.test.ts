import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the compact profile trigger transparent without shrinking the avatar or its hit area", () => {
  const css = readFileSync("src/renderer/browser-responsive.css", "utf8");
  const trigger = css.match(/\.browser-compact \.global-bar \.workspace-identity-menu \{([^}]+)\}/)?.[1];
  expect(trigger).toContain("background: transparent;");
  expect(trigger).not.toContain("background: var(--ws-surface)");
  expect(css).toContain(".workspace-identity-menu .fui-Avatar { width: 48px; height: 48px; min-width: 48px; }");
  expect(css).toContain(".workspace-identity-menu) { width: 48px; height: 48px; min-width: 48px; min-height: 48px; }");
});
