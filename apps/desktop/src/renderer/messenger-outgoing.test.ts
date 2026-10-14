import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const css = readFileSync("src/renderer/messenger-outgoing.css", "utf8");
it("uses separate Telegram-inspired dark and softened light outgoing palettes", () => {
  expect(css).toContain("--chat-outgoing-fill: #2b5278");
  expect(css).toContain("--chat-outgoing-fill: #e5eff9");
  expect(css).toContain("--chat-outgoing-ink: #ffffff");
  expect(css).toContain("--chat-outgoing-ink: #263c54");
  expect(css).toContain(".message.own .message-meta");
  expect(css).toContain(".message-delivery.is-read");
  expect(css).toContain("@media (forced-colors: none)");
});
it("keeps sizing and focus intact, with a tail only on final grouped bubbles", () => {
  expect(css).toContain(":not(.is-group-first):not(.is-group-middle)");
  expect(css).toContain("pointer-events: none");
  expect(css).toContain("border-color: transparent");
  expect(css).not.toContain(".message-body::after");
  expect(css).not.toMatch(/font-size:|line-height:|padding:|min-width:|max-width:|outline:|animation:/);
});
