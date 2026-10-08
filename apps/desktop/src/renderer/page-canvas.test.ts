import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(resolve(process.cwd(), "src/renderer", name), "utf8");
describe("Plain page canvas contract", () => {
  it("loads after page surfaces and sidebar styles", () => {
    const entry = read("main.tsx");
    for (const file of ["spatial-workspace.css", "workspace-2-messenger.css", "workspace-2-notifications.css", "sidebar-theme.css"]) {
      expect(entry.indexOf('import "./page-canvas.css"')).toBeGreaterThan(entry.indexOf(`import "./${file}"`));
    }
  });
  it("reserves one 20px trailing gutter and flattens only authenticated page roots", () => {
    const css = read("page-canvas.css");
    expect(css).toContain("--ws-page-canvas: #fff");
    expect(css).toContain("--ws-page-trailing-gutter: 20px");
    expect(css).toContain(".app-shell .app-content > :is(.workspace-view, .team-dashboard, .telegram-access-view)");
    expect(css).toContain("padding-inline-end: var(--ws-page-trailing-gutter)");
    expect(css).toContain("backdrop-filter: none");
    expect(css).toContain("width: auto");
    expect(css).toContain("body:has(.app-content > :is(.employees-view, .ai-referent-view, .ai-hisobot-view)) .app-shell");
    expect(css).not.toMatch(/!important|\.notification-row|\.conversation|\.fui-Dialog|\.auth-screen/);
  });
  it("keeps high contrast and a thicker native payment scrollbar", () => {
    expect(read("page-canvas.css")).toContain("--ws-page-canvas: Canvas");
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
  it("uses the new hook only for payments, leaving other boards' pan behavior unchanged", () => {
    const payments = read("ApprovalsView.tsx");
    expect(payments).toContain("useHorizontalBoardScroll");
    expect(payments).not.toContain("useMiddleMousePan");
    expect(payments).toContain('role="region"');
    for (const file of ["ProjectsView.tsx", "TripApprovalsView.tsx"]) expect(read(file)).toContain("useMiddleMousePan");
  });
});
