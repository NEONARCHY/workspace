import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync("src/renderer/workspace-field-borders.css", "utf8");
it("gives every Fluent field one real shell border without decorative focus layers", () => {
  for (const selector of [".fui-Input", ".fui-Textarea", ".fui-Select", ".fui-Combobox", ".fui-Dropdown"]) expect(css).toContain(selector);
  expect(css).toContain("border-width: 1px");
  expect(css).toContain("box-shadow: none");
  expect(css).toMatch(/::after\s*\{\s*display: none/);
  expect(css).not.toMatch(/!important|mask:|z-index:|position:\s*absolute/);
  const main = readFileSync("src/renderer/main.tsx", "utf8");
  expect(main.indexOf('import "./workspace-field-borders.css"')).toBeGreaterThan(main.indexOf('import "./workspace-search.css"'));
});
it("stretches the native Select child into its sized border-owning shell", () => {
  expect(css).toContain("align-items: stretch");
  expect(css).toContain("height: auto");
  expect(css).toContain("min-height: 0");
  expect(css).toContain("border-radius: inherit");
  expect(css).toContain(".fui-Select__icon");
  expect(css).toContain("transform: translateY(-50%)");
  expect(css).toContain("border: 0");
});
it("preserves keyboard, invalid, disabled, system-colour and composer distinctions", () => {
  expect(css).toContain("border-color: var(--ws-field-focus-border)");
  expect(css).toContain("--ws-satin-border-color: var(--ws-field-focus-border)");
  expect(readFileSync("src/renderer/satin-surfaces.css", "utf8")).toContain("border-color: var(--ws-satin-border-color, transparent)");
  expect(css).toContain(':has([aria-invalid="true"])');
  expect(css).toContain("var(--ws-danger, #ab2842)");
  expect(css).toContain(":not(:has(:disabled))");
  expect(css).toContain("outline: 2px solid Highlight");
  expect(css).toContain("border-color: GrayText");
  expect(css).toContain("prefers-reduced-motion: reduce");
  expect(css).toContain(".composer-input .fui-Input { border: 0; }");
});
