import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("team attention surfaces", () => {
  it("separates attention cards from their panel in both themes and forced colors", () => {
    const css = readFileSync("src/renderer/list-row-hover.css", "utf8");
    expect(css).toContain("--attention-row-surface: color-mix(in srgb, var(--ws-link) 4%, var(--ws-muted-surface))");
    expect(css).toContain("--attention-row-surface: var(--ws-surface-raised)");
    expect(css).toContain("--attention-row-edge: var(--ws-satin-edge)");
    expect(css).toContain("--attention-row-sheen: var(--ws-satin-sheen)");
    expect(css).not.toContain("var(--ws-surface-raised) 84%");
    // More specific than the shared row-hover reset: cards keep their own fill.
    expect(css).toContain(".team-dash-attention .team-dash-attention-list > .team-dash-task:is(:hover, :focus-visible)");
    expect(css).toContain("var(--attention-row-edge) border-box");
    expect(css).toContain("border: 1px solid transparent");
    expect(css).toContain("background: Canvas; border-color: ButtonText");
  });
});
