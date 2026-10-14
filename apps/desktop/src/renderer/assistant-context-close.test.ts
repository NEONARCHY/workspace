import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("makes the draft context close icon white on hover without changing its background or position", () => {
  const css = readFileSync("src/renderer/assistant-chat.css", "utf8");
  expect(css).toMatch(/@media \(forced-colors: none\) \{\s*\.assistant-panel \.assistant-draft-context button:not\(:disabled\):hover \{ color: #fff; transform: none; \}/);
});
