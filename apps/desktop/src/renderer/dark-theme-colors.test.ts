import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { translateText } from "@yuksalish/i18n";
import { workspaceDarkTheme } from "./workspace-theme";

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
it.each(["uz_cyrl", "uz_latn"] as const)("localizes theme choices and switching controls in %s", locale => {
  for (const label of ["Тема рабочего пространства", "Светлая", "Тёмная", "Как в системе", "Включить светлую тему", "Включить тёмную тему"]) expect(translateText(label, locale)).not.toBe(label);
});
