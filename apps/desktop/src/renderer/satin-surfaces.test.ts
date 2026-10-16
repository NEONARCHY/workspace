import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const css = readFileSync("src/renderer/satin-surfaces.css", "utf8");
it("ports the dark Maqro sweep stops and subtle stroke without changing light surfaces", () => {
  expect(css).toContain('html[data-color-theme="dark"]');
  for (const stop of ["13%", "27%", "40%", "50%", "60%", "73%", "87%"]) expect(css).toContain(stop);
  expect(css).toContain("12.09%");
  expect(css).toContain("background-clip: padding-box, border-box, border-box");
  expect(css).not.toMatch(/::before|::after|mask:|mask-composite:|z-index:|pointer-events:/);
  expect(css).not.toMatch(/(?:^|\n)\s*position:/);
  expect(css).toContain("@media (forced-colors: none)");
  expect(css).not.toMatch(/!important|transition:\s*all|filter:|animation:/);
});
it("uses real satin for topbar triggers and incoming counters, with a stronger selected sweep instead of an inset ring", () => {
  expect(css).toContain(".context-trigger, .ai-incoming-register .ai-referent-summary > button");
  expect(css).toContain('.context-trigger[aria-expanded="true"]');
  expect(css).toContain('.ai-incoming-register .ai-referent-summary > button[aria-pressed="true"]');
  expect(css).toContain("rgb(var(--ws-theme-ink-teal-rgb) / 85%) 0%");
  expect(css).toContain("rgb(var(--ws-theme-ink-teal-rgb) / 12%) 50%");
  expect(css).toContain("--ws-satin-fill: linear-gradient(116deg, var(--ws-theme-wash-teal), var(--ws-theme-surface))");
  expect(css).toMatch(/\.ai-incoming-register \.ai-referent-summary > button\[aria-pressed="true"\] \{\s*box-shadow: 0 10px/);
  expect(css).not.toMatch(/border-width:|border-style:|border-radius:|padding:|margin:/);
});
it("keeps semantic/focus signals and floating positions intact while covering fields", () => {
  expect(css).not.toMatch(/--ws-control-line:|--ws-focus|outline:/);
  expect(css).toContain(".fui-MenuPopover:not(.reaction-picker-popover)");
  expect(css).not.toMatch(/(?:^|\n)\s*position:/);
  const main = readFileSync("src/renderer/main.tsx", "utf8");
  expect(main.indexOf('import "./satin-surfaces.css"')).toBeGreaterThan(main.indexOf('import "./dark-theme.css"'));
});
it("covers the remaining screenshot surfaces and both native and Fluent search fields", () => {
  for (const selector of [".edo-incoming-list", ".edo-incoming-detail", ".telegram-access-row", ".telegram-access-bot",
    ".calendar-filters", ".employees-header-tools", ".chat-row.selected", ".account-section", ".session-list > div",
    ".color-theme-choice", ".sidebar-theme-choice", ".notification-metrics > button", ".survey-panel", ".task-team-picker",
    ".fui-Input", ".fui-Combobox", ".fui-Dropdown", "textarea:not(.fui-Textarea__textarea)"])
    expect(css).toContain(selector);
  expect(css).toContain("background-clip: padding-box, border-box, border-box");
  expect(css).toContain(':not([aria-invalid="true"])');
  expect(css).toContain(':not(.composer-input .fui-Input)');
  expect(css).toContain('--ws-satin-fill: linear-gradient(var(--ws-selected), var(--ws-selected))');
  expect(css).toContain('.fui-Dropdown > .fui-Dropdown__button');
  expect(css).toContain('.account-panel');
  expect(css).toContain('.sidebar-theme-swatch');
  expect(css).toContain('--ws-date-time-popover-edge: transparent');
  expect(readFileSync("src/renderer/workspace-inputs.css", "utf8")).toContain('var(--ws-date-time-popover-edge, transparent)');
  expect(readFileSync("src/renderer/workspace-inputs.css", "utf8")).toContain('var(--ws-popup-radius, 17px)');
  expect(css).toMatch(/\.sidebar-theme-choice\)\[aria-pressed="true"\]\s*\{\s*box-shadow: none/);
  expect(css).toContain("background-attachment: scroll");
});
