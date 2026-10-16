import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("document viewer and drawer geometry", () => {
  it("gives the PDF its own scroll area and a compact fixed toolbar", () => {
    const css = readFileSync("src/renderer/file-viewer.css", "utf8");
    expect(css).toMatch(/\.file-viewer-pdf-page \{[^}]*min-height: 0[^}]*overflow: auto/);
    expect(css).toMatch(/\.file-viewer-pdf-tools \{[^}]*align-items: center[^}]*flex: none/);
    expect(css).toMatch(/\.file-viewer-pdf-sheet \{[^}]*margin: 0 auto 16px/);
    expect(css).toMatch(/\.file-viewer-pdf-paper canvas \{[^}]*width: 100%[^}]*height: 100%/);
  });
  it("centres the request drawer tabs with equal vertical padding", () => {
    const css = readFileSync("src/renderer/workspace-2-payments.css", "utf8");
    const tabs = css.slice(css.indexOf(".approvals-view .approval-detail-tabs {")).split("}")[0];
    expect(tabs).toContain("align-items: center");
    expect(tabs).toContain("padding: 8px 20px");
    expect(tabs).toContain("flex: none");
  });
});
