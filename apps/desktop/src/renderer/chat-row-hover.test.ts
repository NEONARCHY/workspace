import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("keeps the hover border inside the rounded swipe mask without breaking reveal clipping", () => {
  const css = readFileSync("src/renderer/workspace-2-messenger.css", "utf8");
  const hover = css.match(/\.messenger-view \.chat-list-item \.chat-row:hover \{([^}]+)\}/)?.[1];
  expect(hover).toContain("transform: none");
  expect(hover).toContain("border-color:");
  expect(hover).toContain("background:");
  const swipe = readFileSync("src/renderer/swipe-row.css", "utf8");
  expect(swipe).toContain(".chat-list-item .swipe-row { --swipe-row-radius: 17px;");
  expect(swipe).toContain("overflow: clip");
});
