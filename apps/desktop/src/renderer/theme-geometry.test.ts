import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { workspaceDarkTheme, workspaceTheme } from "./workspace-theme";

const read = (name: string) => readFileSync(`src/renderer/${name}`, "utf8");
const geometry = /^(?:display|position|inset(?:-.+)?|top|right|bottom|left|width|height|min-.+|max-.+|margin(?:-.+)?|padding(?:-.+)?|gap|row-gap|column-gap|grid(?:-.+)?|flex(?:-.+)?|align-.+|justify-.+|order|font(?:-.+)?|line-height|letter-spacing|white-space|overflow(?:-.+)?|box-sizing|border(?:-(?:width|style|radius|top|bottom|left|right)(?:-.+)?)?|transform|translate|scale|content)$/;

function themeGeometry(css: string): string[] {
  const problems: string[] = [];
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!.trim();
    if (!/data-color-theme\s*=\s*["'](?:dark|light)["']/.test(selector)) continue;
    // A pointer-transparent, absolutely positioned paint layer cannot resize
    // its field. Keep the light focus-border reveal and dark surface effects.
    if (/::(?:before|after)/.test(selector) && /position:\s*absolute/.test(match[2]!) && /pointer-events:\s*none/.test(match[2]!)) continue;
    for (const declaration of match[2]!.split(";")) {
      const property = declaration.split(":")[0]!.trim();
      if (geometry.test(property) || /^--.*(?:width|height|padding|margin|gap|radius|font|spacing|inset|scale|translate)/.test(property)) problems.push(`${selector}: ${declaration.trim()}`);
    }
  }
  return problems;
}

it("keeps geometry out of all palette-specific renderer CSS rules", () => {
  const problems = readdirSync("src/renderer").filter(name => name.endsWith(".css"))
    .flatMap(name => themeGeometry(read(name)).map(problem => `${name}: ${problem}`));
  expect(problems).toEqual([]);
});

it("detects theme-only layout changes, including nested responsive rules", () => {
  expect(themeGeometry('@media (max-width: 600px) { html[data-color-theme="dark"] .panel { padding: 10px; min-height: 80px; --panel-gap: 4px; color: white; } }')).toHaveLength(3);
  expect(themeGeometry('html:not([data-color-theme="dark"]) .panel { font-size: 20px; border: 0; }')).toHaveLength(2);
});

it("shares Fluent typography, dimensions and motion tokens between palettes", () => {
  for (const key of Object.keys(workspaceTheme) as (keyof typeof workspaceTheme)[]) {
    if (/^(?:font|lineHeight|spacing|borderRadius|strokeWidth|duration|curve)/.test(key)) expect(workspaceDarkTheme[key], key).toBe(workspaceTheme[key]);
  }
});

it("uses the former dark banner geometry in shared responsive header rules", () => {
  const css = read("section-headers.css");
  const header = css.match(/html:root body \.app-provider :is\([^}]+?\.ws-section-header \{([^}]+)\}/)?.[1];
  expect(header).toContain("min-height: 116px;");
  expect(header).toContain("padding-block: 22px;");
  expect(header).toContain("border-radius: 20px;");
  expect(header).not.toMatch(/(?:^|;)\s*(?:margin|gap|display|position|color|background)\s*:/);
  expect(css).toContain("padding: 22px clamp(20px, 3vw, 36px);");
  expect(css).toContain("padding: 22px 24px;");
  expect(css).toContain("padding: 22px 16px;");
  expect(css).not.toMatch(/min-height: (?:148|138)px/);
});

it("reserves the same popup border and home/project radii before either palette paints", () => {
  const popup = read("workspace-popups.css");
  const surface = popup.slice(popup.indexOf("html body :is("), popup.indexOf("/* Keep dark satin"));
  expect(surface).toContain("border: 1px solid transparent;");
  expect(read("personal-home.css")).toMatch(/\.home-overview article \{[^}]*border-radius: 16px;/);
  expect(read("personal-home.css")).toMatch(/\.home-panel \{[^}]*border-radius: 18px;/);
  expect(read("project-hub.css")).toMatch(/\.project-hub-view > \.project-hub-header \{[^}]*border-radius: 20px;/);
});
