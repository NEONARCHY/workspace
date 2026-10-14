import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("uses compact flat menu rows inside the existing rounded shell", () => {
  const css = readFileSync("src/renderer/workspace-2-messenger.css", "utf8");
  expect(css).toContain("border-radius: 17px");
  expect(css).toContain("gap: 0; width: 210px; padding: 0; border: 0; overflow: hidden");
  expect(css).toMatch(/\.message-context-menu \.fui-Button \{[^}]*border-radius: 0;[^}]*font-weight: 400;[^}]*background: transparent/);
});
it("provides a visible dark hover surface for message menus and dropdown options", () => {
  const css = readFileSync("src/renderer/dark-theme.css", "utf8");
  expect(css).toContain('.fui-Listbox .fui-Option:hover');
  expect(css).toContain('.message-context-menu .fui-Button:hover');
  expect(css).toContain('background: #3b3d4b;');
});
it("fades the delete hover/focus from pastel red on the left to transparent on the right", () => {
  const css = readFileSync("src/renderer/workspace-2-messenger.css", "utf8");
  expect(css).toContain('.fui-Button.message-context-delete:not(:disabled):hover');
  expect(css).toContain('.fui-Button.message-context-delete:not(:disabled):focus-visible');
  expect(css).toContain('linear-gradient(90deg, rgb(243 164 172 / var(--message-delete-hover-opacity, .42))');
  expect(css).toContain('transparent 100%)');
});
