import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("team attention surfaces", () => {
  it("separates attention cards from their panel in both themes and forced colors", () => {
    const css = readFileSync("src/renderer/list-row-hover.css", "utf8");
    expect(css).toContain("--attention-row-surface: color-mix(in srgb, var(--ws-link) 11%, var(--ws-surface))");
    expect(css).toContain("--attention-row-surface: color-mix(in srgb, var(--ws-surface-raised) 92%, var(--ws-text))");
    expect(css).toContain("border: 1px solid var(--attention-row-line)");
    expect(css).toContain("background: Canvas; border-color: ButtonText");
  });
});
