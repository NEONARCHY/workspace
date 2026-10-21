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
  it("preserves the AI Referent panel's symmetrical inner inset, separately from the page rail", () => {
    expect(read("page-scroll-layout.css")).toContain("padding-inline-end: var(--ws-page-content-inset, 0px)");
    const css = read("ai-referent-workspace.css");
    expect(css).toContain("--ws-page-content-inset: var(--ws-view-panel-title-inline, 20px)");
    expect(css).toContain("--ws-page-content-inset: 12px; padding: 12px");
    expect(css).toContain("contain: strict");
  });
  it("keeps the bounded feed grid centered within the page scroll owner", () => {
    const css = read("page-scroll-layout.css");
    const feed = css.match(/\.app-shell \.app-content > \.feed-view \{([^}]+)\}/)?.[1];
    expect(feed).toContain("justify-content: center");
    expect(feed).not.toMatch(/justify-content:\s*(?:end|flex-end)/);
    expect(read("styles.css")).toContain("grid-template-columns: minmax(0, 760px) 270px");
  });
  it("does not re-style nested lists, mini messenger, dialogs, colours or motion", () => {
    const css = read("page-scroll-layout.css");
    expect(css).not.toMatch(/!important|background\s*:|border-radius\s*:|animation\s*:|transition\s*:/);
    expect(css).not.toMatch(/\.fui-Dialog|\.message-scroll|\.notification-stream|\.kanban-stack|\.record-table-scroll/);
    expect(css).toContain(".floating-messenger-panel.is-full-page > .messenger-view");
    expect(css).not.toContain(".app-content *");
  });
  it("puts only payment/trip board rails below the shared sidebar baseline", () => {
    const css = read("page-scroll-layout.css");
    expect(css).toContain("--ws-process-board-scrollbar-size: 4px");
    expect(css).toContain("--ws-process-board-scrollbar-size: 8px");
    expect(css).toContain(":has(> :is(.approvals-view, .trips-view) .approval-kanban)");
    expect(css).toContain("margin-block-end: calc(-1 * var(--ws-process-board-scrollbar-size))");
  });
});
