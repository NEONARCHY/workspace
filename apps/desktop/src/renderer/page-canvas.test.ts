import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(resolve(process.cwd(), "src/renderer", name), "utf8");
describe("Scoped work-panel surfaces", () => {
  it("loads after page surfaces and sidebar styles", () => {
    const entry = read("main.tsx");
    for (const file of ["spatial-workspace.css", "workspace-2-messenger.css", "workspace-2-notifications.css", "sidebar-theme.css"]) {
      expect(entry.indexOf('import "./page-canvas.css"')).toBeGreaterThan(entry.indexOf(`import "./${file}"`));
    }
  });
  it("reserves the trailing gutter without painting or flattening page roots", () => {
    const css = read("page-canvas.css");
    expect(css).toContain("--ws-page-panel: #fff");
    expect(css).toContain("--ws-page-trailing-gutter: 20px");
    expect(css).toContain("padding-inline-end: var(--ws-page-trailing-gutter)");
    const roots = css.match(/^\.app-content > :is\(\.workspace-view, \.team-dashboard, \.telegram-access-view\) \{([^}]+)\}/m)?.[1];
    expect(roots).toBeDefined();
    expect(roots).toContain("width: auto");
    expect(roots).not.toMatch(/background|border|shadow|filter|margin|padding/);
    expect(css).toContain("body:has(.app-content > :is(.employees-view, .ai-referent-view, .ai-hisobot-view)) .app-shell");
    expect(css).not.toMatch(/!important|\.notification-row|\.conversation\s*\{|\.fui-Dialog|\.auth-screen/);
  });
  it("extends the existing notification list into the old frame with its rounded shape", () => {
    const css = read("page-canvas.css");
    const root = css.match(/^\.notifications-view \{([^}]+)\}/m)?.[1];
    const panel = css.match(/^\.notifications-view > \.notification-layout > \.notification-stream-shell \{([^}]+)\}/m)?.[1];
    expect(root).toContain("background: transparent");
    expect(root).not.toContain("border-radius");
    expect(root).toContain("padding: 0");
    expect(panel).not.toMatch(/margin|padding/);
    expect(panel).toContain("border-radius: var(--ws-radius, 22px)");
    expect(panel).toContain("background: var(--ws-page-panel)");
    expect(css).not.toMatch(/notification-(?:header|metrics)\s*\{/);
    expect(css).toContain("grid-template-rows: minmax(0, 1fr)");
  });
  it("leaves the calendar composition and already-white AI panels intact", () => {
    const css = read("page-canvas.css");
    expect(css).not.toContain("border-radius: 0");
    expect(css).not.toMatch(/^\.calendar-(?:main|side|board|day-summary|detail)/m);
    expect(read("workspace-calendar.css")).toContain("background: #fff");
    expect(read("ai-referent-workspace.css")).toContain("border-radius: var(--ws-radius, 22px)");
    expect(read("ai-hisobot.css")).toContain("border-radius: var(--ws-radius, 22px)");
  });
  it("makes delivery settings white without changing their geometry or controls", () => {
    const panel = read("page-canvas.css").match(/^\.notifications-view > \.notification-layout > \.notification-settings \{([^}]+)\}/m)?.[1];
    expect(panel?.trim()).toBe("background: var(--ws-page-panel);");
  });
  it("limits the projects' replacement surface to the work area below the hero", () => {
    const css = read("page-canvas.css");
    const root = css.match(/^\.project-hub-view \{([^}]+)\}/m)?.[1];
    expect(root).toContain("background: transparent");
    expect(root).not.toContain("border-radius");
    expect(css).toContain(".project-hub-view > :is(.project-hub-layout, .project-hub-funding-layout)");
    const hero = css.match(/\.project-hub-header,([^]*?)\{([^}]+)\}/)?.[2];
    expect(hero?.trim()).toBe("box-shadow: none;");
  });
  it("keeps high contrast and a thicker native payment scrollbar", () => {
    expect(read("page-canvas.css")).toContain("--ws-page-panel: Canvas");
    expect(read("scrollbars.css")).toContain(".approvals-view .approval-kanban::-webkit-scrollbar { height: 10px; }");
    expect(read("scrollbars.css")).toContain(".approvals-view .approval-kanban { scrollbar-width: auto; }");
  });
  it("preserves the original shell background behind white pages and their gutter", () => {
    const css = read("page-canvas.css");
    const shell = css.match(/^\.app-shell \{([^}]+)\}/m)?.[1];
    const content = css.match(/^\.app-shell \.app-content \{([^}]+)\}/m)?.[1];
    expect(shell).toBeDefined();
    expect(content).toBeDefined();
    expect(shell).not.toMatch(/background(?:-color|-image)?\s*:/);
    expect(content).not.toMatch(/background(?:-color|-image)?\s*:/);
    expect(read("spatial-workspace.css")).toContain("background: radial-gradient(ellipse at 84% 0%, #dfedea 0, transparent 48%), var(--ws-canvas)");
  });
  it("lets the shell show through page-local washes without repainting work panels", () => {
    const css = read("page-canvas.css");
    const wash = css.match(/\/\* Gutters[^]*?\{([^}]+)\}/)?.[1];
    expect(wash).toContain("background: transparent");
    expect(wash).not.toMatch(/padding|margin|border|shadow|filter/);
    expect(css).toContain(".app-content > :is(.approvals-view, .messenger-view)");
    expect(css).toContain(".tasks-view.bp5-tasks:not(.dashboard-mode, .efficiency-mode) .tasks-main");
  });
  it("removes the exterior panel shadows that tint the otherwise transparent gutters", () => {
    const css = read("page-canvas.css");
    const shadows = css.match(/\/\* Exterior panel shadows[^]*?\{([^}]+)\}/)?.[1];
    expect(shadows).toContain("box-shadow: none");
    expect(shadows).not.toMatch(/background|border-radius|padding|margin|outline|filter/);
    expect(css).toContain("body .app-content :is(");
    for (const panel of [".ws-section-header", ".notification-progress-card", ".team-dash-panel", ".record-table-shell", ".calendar-board"]) expect(css).toContain(panel);
    expect(css).not.toMatch(/--ws-shadow-(?:card|float|lift):|\.app-content \*/);
  });
  it("uses the new hook only for payments, leaving other boards' pan behavior unchanged", () => {
    const payments = read("ApprovalsView.tsx");
    expect(payments).toContain("useHorizontalBoardScroll");
    expect(payments).not.toContain("useMiddleMousePan");
    expect(payments).toContain('role="region"');
    for (const file of ["ProjectsView.tsx", "TripApprovalsView.tsx"]) expect(read(file)).toContain("useMiddleMousePan");
  });
});
