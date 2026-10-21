import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/renderer/mobile-density.css", "utf8").replace(/\r\n/g, "\n");
describe("compact browser density", () => {
  it("scopes layout changes to compact viewports, without scaling the interface", () => {
    const firstMedia = css.indexOf("@media");
    expect(css.slice(0, firstMedia).replace(/\/\*[\s\S]*?\*\//g, "").trim()).toBe(".workday-control-mobile-label { display: none; }\n.approval-mode-mobile-label { display: none; }");
    expect(css).toContain("(max-width: 1366px) and (any-pointer: coarse)");
    expect(css).not.toMatch(/!important|transition:\s*all|transform:\s*scale|touch-action:\s*none/);
  });
  it("keeps the phone header in one horizontally scrollable row", () => {
    expect(css).toContain("flex-wrap: nowrap");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain(".color-theme-toggle-wrap { order: 4;");
    expect(css).toContain(".notification-bell-wrap { order: 3;");
    expect(css).toContain(".workspace-workday-person, .workspace-identity) { display: contents; }");
    expect(css).toContain(".connection-indicator { position: static; order: 7;");
    expect(css).toContain("width: 38px; height: 38px; min-width: 38px; min-height: 38px;");
  });
  it("preserves 44px touch actions while compressing cards and summaries", () => {
    expect(css).toContain(".approval-metric { grid-template-columns: auto minmax(0, 1fr)");
    expect(css).toContain(".notification-row-tail .notification-read-action { min-width: 44px; width: 44px; min-height: 44px;");
    expect(css).toContain(".team-dash-person { grid-template-columns: 44px minmax(0, 1fr)");
    expect(css).toContain(".team-dashboard { flex: none; overflow: visible;");
    expect(css).toContain(".home-efficiency { display: grid; grid-template-columns: 96px minmax(0, 1fr)");
  });
  it("loads after theme and header styles in production", () => {
    const entry = readFileSync("src/renderer/main.tsx", "utf8");
    expect(entry.indexOf('"./mobile-density.css"')).toBeGreaterThan(entry.indexOf('"./topbar-insights.css"'));
    expect(entry.indexOf('"./mobile-density.css"')).toBeGreaterThan(entry.indexOf('"./satin-surfaces.css"'));
  });
  it("overrides the desktop banner height lock without shrinking touch targets", () => {
    expect(css).toContain("html.web-platform:root body .app-provider :is(.workspace-view, .team-dashboard, .telegram-access-view) .ws-section-header");
    expect(css).toContain("min-height: 0; height: auto; margin-bottom: 8px; padding: 10px 12px");
    expect(css).toContain(".ws-section-header :is(button, .telegram-access-secondary) { min-width: 44px; min-height: 44px");
    expect(css).toContain(".ws-section-header-art, .ws-illustrated-header-art) { display: none; }");
    expect(css).toContain(":is(.edo-incoming-header, .survey-heading) h1");
    expect(css).toContain(".hisobot-help-button { position: static; flex: none; align-self: center;");
  });
  it("hides only the global command trigger on phone widths, retaining tablet access", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 600px)"));
    expect(phone).toContain(".web-platform .global-bar .section-jump-trigger { display: none; }");
    expect(css.slice(0, css.indexOf("@media (max-width: 600px)"))).not.toContain(".section-jump-trigger { display: none");
  });
  it("gives the production team wrapper a vertical scroll and keeps register tabs horizontal", () => {
    expect(css).toContain(".app-content > .tasks-view.dashboard-mode { display: block; min-height: 0; max-height: 100%; overflow-y: auto;");
    expect(css).toMatch(/ai-referent-register-tabs[^{}]*\{[^}]*flex-wrap: nowrap[^}]*overflow-x: auto/);
  });
  it("prioritizes the mail list over decorative chrome and fixed list heights", () => {
    expect(css).toContain(".ai-referent-header h1 { margin: 0; font-size: 20px;");
    expect(css).toMatch(/ai-referent-summary \{ display: flex; flex-wrap: nowrap/);
    expect(css).toContain(":is(.ai-incoming-table-wrap, .ai-referent-list, .ai-referent-empty) { flex: 1 1 auto; height: auto; min-height: 200px;");
    expect(css).toContain(".ai-incoming-toolbar { flex-wrap: nowrap; min-height: 44px;");
  });
});
