import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { translateText } from "@yuksalish/i18n";

const css = readFileSync("src/renderer/sidebar-theme.css", "utf8");
function tokens(selector: string) {
  if (!css.includes(selector)) return {};
  const block = css.slice(css.indexOf(selector));
  return Object.fromEntries([...block.slice(0, block.indexOf("}")).matchAll(/--ws-rail-([a-z-]+):\s*([^;]+);/g)]
    .map(match => [match[1]!, match[2]!]));
}
const base = tokens(".sidebar-palette {");
const color = (hex: string) => hex.replace("#", "").match(/../g)!.map(channel => parseInt(channel, 16));
const luminance = (rgb: number[]) => rgb.map(channel => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
const contrast = (front: string, back: number[]) => {
  const a = luminance(color(front)), b = luminance(back);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

it.each(["blue-teal", "navy", "light"])("keeps small navigation text and icons AA-readable for %s", theme => {
  const palette = { ...base, ...tokens('.sidebar-palette[data-sidebar-theme="' + theme + '"] {') };
  // Check both gradient endpoints and the strongest hover/profile tint.
  const ends = palette.bg!.match(/#[0-9a-f]{6}/g)!;
  for (const endpoint of ends) {
    const rgb = color(endpoint);
    const hover = theme === "light" ? color("#eaf2f3")
      : rgb.map((channel, index) => channel * 0.88 + [225, 242, 249][index]! * 0.12);
    for (const background of [rgb, hover]) {
      expect(contrast(palette.text!, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.icon!, background)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(palette.muted!, rgb)).toBeGreaterThanOrEqual(4.5);
  }
  for (const endpoint of palette.selected!.match(/#[0-9a-f]{6}/g)!) {
    expect(contrast(palette["selected-ink"]!, color(endpoint))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette["selected-icon"]!, color(endpoint))).toBeGreaterThanOrEqual(3);
  }
  for (const endpoint of ends)
    expect(contrast(palette.focus!, color(endpoint))).toBeGreaterThanOrEqual(3);
  expect(contrast(palette["badge-ink"]!, color(palette.badge!))).toBeGreaterThanOrEqual(4.5);
  expect(contrast(palette["count-ink"]!, color(palette.count!))).toBeGreaterThanOrEqual(4.5);
});

it("provides system-colour selection and visible keyboard focus", () => {
  expect(css).toContain("@media (forced-colors: active)");
  expect(css).toContain("--ws-rail-selected: Highlight;");
  expect(css).toContain("--ws-rail-selected-ink: HighlightText;");
  expect(css).toContain("outline: 2px solid var(--ws-rail-focus)");
  expect(css).toContain("outline-color: var(--ws-rail-selected-icon)");
  expect(css).toContain(".workspace-logo .rail-toggle svg { color: inherit; }");
  expect(css).toContain(".sidebar-palette .rail-action:hover { color: var(--ws-rail-text); }");
  expect(readFileSync("src/renderer/workspace-2-focus.css", "utf8"))
    .toContain(":not(.sidebar-palette *, .sidebar-theme-choice):is(:focus, :focus-visible)");
});

it.each(["uz_cyrl", "uz_latn"] as const)("translates the appearance choices in %s", locale => {
  for (const label of ["Оформление", "Цвет бокового меню", "Сине-бирюзовый", "Тёмно-синий", "Светлый", "По умолчанию"])
    expect(translateText(label, locale)).not.toBe(label);
});
