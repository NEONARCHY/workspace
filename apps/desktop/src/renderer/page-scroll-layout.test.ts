import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(resolve(process.cwd(), "src/renderer", name), "utf8");
describe("Shared page scroll rail", () => {
  it("loads after compact/theme rules and has a single native page owner", () => {
    const entry = read("main.tsx");
    expect(entry.indexOf('import "./page-scroll-layout.css"')).toBeGreaterThan(entry.indexOf('import "./mobile-density.css"'));
    const css = read("page-scroll-layout.css");
    const page = css.match(/\.app-shell \.app-stage > \.app-content \{([^}]+)\}/)?.[1];
    expect(page).toContain("overflow-y: auto");
    expect(page).toContain("scrollbar-gutter: stable");
    expect(page).toContain("var(--ws-page-trailing-gutter) - var(--ws-page-scrollbar-width)");
    expect(page).toContain("var(--ws-page-scrollbar-width) - var(--ws-page-scrollbar-inset)");
    expect(css).toContain("padding-inline-end: 0");
    expect(css).toContain("margin-inline-end: 0");
    expect(css).toContain("overflow: visible");
    expect(css).toContain(".app-content > div > .survey-analytics");
  });
  it("accounts for touch scrollbar width and existing compact shell clearance", () => {
    const css = read("page-scroll-layout.css");
    expect(css).toContain("--ws-page-scrollbar-fallback: 6px");
    expect(css).toContain("--ws-page-scrollbar-fallback: 8px");
    expect(css).toContain("--ws-page-scroll-outer-inset: max(12px, env(safe-area-inset-right))");
    expect(css).toContain("--ws-page-scroll-edge: 0px");
    expect(css).toContain("@container workspace (max-width: 720px)");
    expect(css).toContain(".members-view .member-inspector { margin-inline-end: 0; }");
  });
  it("does not re-style nested lists, mini messenger, dialogs, colours or motion", () => {
    const css = read("page-scroll-layout.css");
    expect(css).not.toMatch(/!important|background\s*:|border-radius\s*:|animation\s*:|transition\s*:/);
    expect(css).not.toMatch(/\.fui-Dialog|\.message-scroll|\.notification-stream|\.kanban-stack|\.record-table-scroll/);
    expect(css).toContain(".floating-messenger-panel.is-full-page > .messenger-view");
    expect(css).not.toContain(".app-content *");
  });
});
