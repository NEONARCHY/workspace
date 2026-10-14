import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const read = (name: string) => readFileSync(`src/renderer/${name}`, "utf8");
const css = read("workspace-popups.css");

it("shares the message-menu surface with Fluent and custom contextual windows", () => {
  for (const selector of [".fui-PopoverSurface", ".fui-MenuPopover", ".fui-Listbox", ".identity-popover", ".assistant-context-menu", ".assistant-chat-options", ".rail-ai-popover", ".task-participant-popover", ".media-volume-popover"]) expect(css).toContain(selector);
  expect(css).toContain("--ws-popup-radius: 17px");
  expect(css).toContain("0 18px 44px");
  expect(css).not.toContain(".fui-DialogSurface");
  const main = read("main.tsx");
  expect(main.indexOf('import "./workspace-popups.css"')).toBeGreaterThan(main.indexOf('import "./satin-surfaces.css"'));
});
it("uses flat full-width rows with soft decorative separators without changing emoji grids", () => {
  expect(css).toContain("padding: 0; gap: 0; overflow-x: hidden");
  expect(css).toContain("padding: 6px 16px");
  expect(css).toContain("border-radius: 0");
  expect(css).toContain("transform: none");
  expect(css).toContain(".fui-Option::after");
  expect(css).toContain(':not(.reaction-picker-grid):not(.message-reaction-grid):not(.feed-reaction-grid)');
  expect(css).toContain(':not(:disabled):not([aria-disabled="true"])');
  expect(css).toContain(".fui-Option + .fui-Option");
  expect(css).toContain("height: 1px;");
  expect(css).toContain("pointer-events: none;");
  expect(css).toContain("var(--ws-popup-separator) 15%");
  const divider = css.slice(css.indexOf("/* Decorative inset hairlines:"), css.indexOf("html body .identity-popover {"));
  expect(divider).toContain("box-sizing: border-box;");
  expect(divider).toContain("border: 0;");
  expect(divider).toContain("outline: 0;");
  expect(divider).toContain("bottom: auto;");
});
it("separates keyboard highlight from mouse hover without a background fade trail", () => {
  expect(css).toContain('html[data-popup-input="pointer"] body :is(');
  expect(css).toContain('html:not([data-popup-input="pointer"]) body :is(');
  expect(css).toContain("transition: color 150ms var(--ws-ease);");
  expect(css).not.toContain("transition: background-color 150ms");
});
it("retains keyboard focus, system contrast, touch targets and dark satin in a real border", () => {
  expect(css).toContain("--ws-popup-row-focus: inset 3px 0 var(--ws-link)");
  expect(css).toContain("[data-activedescendant-focusvisible]");
  expect(css).toContain("outline: 2px solid Highlight");
  expect(css).toContain("--ws-popup-row-height: 44px");
  expect(css).toContain("min-height: var(--ws-popup-row-height)");
  expect(css).toContain("prefers-reduced-motion: reduce");
  expect(css).toContain("background-clip: padding-box, border-box, border-box");
  expect(css).not.toMatch(/mask:|mask-composite:|transition: all|!important/);
});
