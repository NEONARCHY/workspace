import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("conversation header density", () => {
  it("keeps search close to the identity without a fixed minimum header height", () => {
    const css = readFileSync("src/renderer/workspace-2-messenger.css", "utf8");
    expect(css).toMatch(/\.messenger-view \.conversation-header\s*\{\s*min-height: 0;\s*padding: 12px 20px 4px;/);
    expect(css).toMatch(/\.messenger-view \.conversation-search\s*\{\s*gap: 10px;\s*padding: 0 18px 8px;/);
  });
});
