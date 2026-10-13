import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { translateText } from "@yuksalish/i18n";
import { workspaceDarkTheme, workspaceTheme } from "./workspace-theme";

const css = readFileSync("src/renderer/dark-theme.css", "utf8");
const palette = Object.fromEntries([...css.matchAll(/--ws-theme-([a-z-]+):\s*(#[\da-f]{6});/g)].map(match => [match[1]!, match[2]!]));
const luminance = (hex: string) => hex.slice(1).match(/../g)!.map(channel => {
  const value = parseInt(channel, 16) / 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);

it.each(["surface", "surface-soft", "wash-neutral", "wash-teal", "wash-blue", "wash-success", "wash-warning", "wash-danger", "wash-violet"])("keeps body and supporting text AA-readable on %s", surface => {
  expect(contrast(palette.ink!, palette[surface]!)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(palette.muted!, palette[surface]!)).toBeGreaterThanOrEqual(4.5);
});
it.each(["teal", "blue", "success", "warning", "danger", "violet"])("keeps semantic labels AA-readable for %s", tone => {
  expect(contrast(palette["ink-" + tone]!, palette["wash-" + tone]!)).toBeGreaterThanOrEqual(4.5);
});
it("keeps Fluent actions, focus and inputs readable in all interactive states", () => {
  for (const bg of [workspaceDarkTheme.colorBrandBackground, workspaceDarkTheme.colorBrandBackgroundHover, workspaceDarkTheme.colorBrandBackgroundPressed]) {
    expect(contrast(workspaceDarkTheme.colorNeutralForegroundOnBrand, bg)).toBeGreaterThanOrEqual(4.5);
  }
  for (const bg of [workspaceDarkTheme.colorNeutralBackground1, workspaceDarkTheme.colorNeutralBackground1Hover, workspaceDarkTheme.colorNeutralBackground1Selected]) {
    expect(contrast(workspaceDarkTheme.colorNeutralForeground3, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(workspaceDarkTheme.colorBrandStroke1, bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(workspaceDarkTheme.colorNeutralStroke1, bg)).toBeGreaterThanOrEqual(3);
  }
  for (const [fg, bg] of [[workspaceDarkTheme.colorStatusSuccessForeground1, workspaceDarkTheme.colorStatusSuccessBackground1], [workspaceDarkTheme.colorStatusWarningForeground1, workspaceDarkTheme.colorStatusWarningBackground1], [workspaceDarkTheme.colorStatusDangerForeground1, workspaceDarkTheme.colorStatusDangerBackground1]]) expect(contrast(fg!, bg!)).toBeGreaterThanOrEqual(4.5);
});
it("scopes the palette to the document theme without inversion or blanket important rules", () => {
  expect(css).toContain('html[data-color-theme="dark"]');
  expect(css).not.toMatch(/!important|invert\(|transition:\s*all|text-shadow/);
  expect(css).toContain("@media (forced-colors: active)");
  expect(css).toContain("--ws-canvas: Canvas");
  const main = readFileSync("src/renderer/main.tsx", "utf8");
  expect(main.indexOf('import "./dark-theme.css"')).toBeGreaterThan(main.indexOf('import "./browser-secondary.css"'));
});
it("uses ordered graphite surfaces with aligned Fluent and pre-paint colours", () => {
  const canvas = workspaceDarkTheme.colorNeutralBackground5;
  expect(luminance(canvas)).toBeLessThan(luminance(workspaceDarkTheme.colorNeutralBackground2));
  expect(luminance(workspaceDarkTheme.colorNeutralBackground2)).toBeLessThan(luminance(palette.surface!));
  expect(luminance(palette.surface!)).toBeLessThan(luminance(palette["surface-soft"]!));
  for (const surface of [canvas, palette.surface!, palette["surface-soft"]!]) {
    const channels = surface.slice(1).match(/../g)!.map(value => parseInt(value, 16));
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(12);
  }
  expect(palette.surface).toBe(workspaceDarkTheme.colorNeutralBackground1);
  expect(palette.muted).toBe(workspaceDarkTheme.colorNeutralForeground3);
  expect(readFileSync("public/color-theme-bootstrap.js", "utf8")).toContain(canvas);
  expect(readFileSync("src/renderer/color-theme.ts", "utf8")).toContain(canvas);
  expect(workspaceTheme.colorNeutralForeground1).toBe("#293A55");
  expect(workspaceTheme.colorBrandBackground).toBe("#293A55");
});
it("keeps hexadecimal and RGB semantic roles identical for gradients and borders", () => {
  for (const [role, hex] of Object.entries(palette)) {
    const rgb = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16)).join(" ");
    expect(css).toContain(`--ws-theme-${role}-rgb: ${rgb};`);
  }
});
it("keeps muted text and control boundaries readable on raised and selected surfaces", () => {
  for (const surface of ["#262730", "#30313d", "#353640"]) {
    expect(contrast(palette.muted!, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(workspaceDarkTheme.colorNeutralStroke1, surface)).toBeGreaterThanOrEqual(3);
  }
});
it("keeps flat controls labelled, distinguishable and focused without weakening field borders", () => {
  const flat = Object.fromEntries([...css.matchAll(/--ws-(button-[a-z-]+|segment-selected):\s*(#[\da-f]{6});/g)].map(match => [match[1]!, match[2]!]));
  for (const surface of Object.values(flat)) {
    expect(contrast(palette.ink!, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.muted!, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#c5bdf0", surface)).toBeGreaterThanOrEqual(3);
  }
  expect(luminance(flat["button-surface"]!)).toBeGreaterThan(luminance("#262730"));
  expect(luminance(flat["button-hover"]!)).toBeGreaterThan(luminance(flat["button-surface"]!));
  expect(luminance(flat["button-pressed"]!)).toBeLessThan(luminance(flat["button-surface"]!));
  expect(css).toContain("@media (forced-colors: none)");
  expect(css).toContain("--colorNeutralBackground1: var(--ws-button-surface)");
  expect(css).not.toContain("--colorNeutralStroke1: transparent");
  expect(css).toContain("outline: 2px solid var(--ws-focus-line)");
  expect(css).toContain(".workspace-select:has(> button:focus-visible)");
  expect(readFileSync("src/renderer/workspace-2-focus.css", "utf8")).toContain('html:not([data-color-theme="dark"]) .app-provider');
});
it.each(["uz_cyrl", "uz_latn"] as const)("localizes theme choices and switching controls in %s", locale => {
  for (const label of ["Тема рабочего пространства", "Светлая", "Тёмная", "Графитовые поверхности и мягкий свет", "Как в системе", "Включить светлую тему", "Включить тёмную тему"]) expect(translateText(label, locale)).not.toBe(label);
});
