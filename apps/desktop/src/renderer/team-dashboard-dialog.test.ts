import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps decision and workload dialogs opaque when light-theme surface tokens are absent", () => {
  const css = readFileSync("src/renderer/team-dashboard.css", "utf8");
  const dialog = css.match(/\.fui-DialogSurface\.team-dash-dialog\s*\{([^}]+)\}/)?.[1];
  const header = css.match(/\.team-dash-decisions > header\s*\{([^}]+)\}/)?.[1];

  expect(dialog).toContain("background: var(--ws-theme-surface, #fff)");
  expect(header).toContain("background: var(--ws-theme-surface, #fff)");
  expect(css).toContain("background: var(--ws-theme-surface-soft, #f1f6f8)");
});
