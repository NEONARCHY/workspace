import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync("src/renderer/workspace-modal-backdrops.css", "utf8");
it("replaces modal backdrop blur with theme-aware dimming, not popup surface blur", () => {
  for (const selector of [".fui-DialogSurface__backdrop", ".record-composer-backdrop", ".account-scrim", ".absence-drawer-scrim", ".eff-help-overlay", ".approval-overlay", ".approval-detail-overlay", ".bp7-modal-backdrop", ".message-forward-overlay"]) {
    expect(css).toContain(selector);
  }
  expect(css).toContain("backdrop-filter: none;");
  expect(css).toContain("rgb(28 42 55 / 32%)");
  expect(css).toContain("rgb(0 0 0 / 48%)");
  expect(css).toContain("@media (forced-colors: none)");
  expect(css).not.toMatch(/MenuPopover|Listbox|animation-play-state|transition:|animation:|width:|height:/);
});
it("loads after the existing scrims and preserves dialog entry timing", () => {
  const main = readFileSync("src/renderer/main.tsx", "utf8");
  expect(main.indexOf('import "./workspace-modal-backdrops.css"')).toBeGreaterThan(main.indexOf('import "./workspace-2-interactions.css"'));
  const dialog = readFileSync("src/renderer/WorkspaceDialog.tsx", "utf8");
  expect(dialog).toContain("duration: 240, exitDuration: 160");
  expect(dialog).toContain('easing: "cubic-bezier(0.2, 0, 0, 1)"');
});
