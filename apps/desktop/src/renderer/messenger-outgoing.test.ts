import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const css = readFileSync("src/renderer/messenger-outgoing.css", "utf8");
it("joins sender names directly to both individual photos and albums", () => {
  expect(css).toMatch(/\.is-media-message > \.employee-profile-link > strong\s*\{\s*margin-bottom: 0;/);
  expect(css).toContain(":is(.attachment-media-preview, .attachment-image-album):first-child { border-top-left-radius: 0; border-top-right-radius: 0; }");
});
it("centers chat avatars vertically instead of stretching them across the text grid", () => {
  const base = readFileSync("src/renderer/styles.css", "utf8");
  expect(base.match(/\.chat-row\s*\{([^}]+)\}/)?.[1]).toMatch(/align-items:\s*center;/);
});
it("uses separate Telegram-inspired dark and softened light outgoing palettes", () => {
  expect(css).toContain("--chat-outgoing-fill: #2b5278");
  expect(css).toContain("--chat-outgoing-fill: #e5eff9");
  expect(css).toContain("--chat-outgoing-ink: #ffffff");
  expect(css).toContain("--chat-outgoing-ink: #263c54");
  expect(css).toContain(".message.own .message-meta");
  expect(css).toContain(".message-delivery.is-read");
  expect(css).toContain("@media (forced-colors: none)");
});
it("joins mirrored curved tails to the final rounded corner without dark satin edges", () => {
  expect(css).toContain("height: 20px");
  expect(css).toContain("left: -8px");
  expect(css).toContain("right: -8px");
  expect(css).toContain('path("M 12 0 C 12 10 9 16 0 19 C 4 20 9 20 12 18 Z")');
  expect(css).toContain('path("M 0 0 C 0 10 3 16 12 19 C 8 20 3 20 0 18 Z")');
  expect(css).toMatch(/html\[data-color-theme="dark"\] body \.messenger-view \.message \.message-body\s*\{\s*border-color: transparent;\s*box-shadow: none;/);
});
it("shares the file-size line with wrapping time and adds caption clearance", () => {
  expect(css).not.toContain("has-document-footer");
  expect(css).toContain(".message-text + .attachment-chips");
  expect(css).toContain("margin-top: 8px");
  expect(css).toContain(".attachment-document-copy > .attachment-document-details { display: flex; flex-wrap: wrap");
  expect(css).toContain(".message-mentions-footer { display: flex; flex-wrap: wrap");
});
it("keeps ordinary bubble sizing/focus intact and explicitly sizes standalone media", () => {
  expect(css).toContain(":not(.is-group-first):not(.is-group-middle)");
  expect(css).toContain("pointer-events: none");
  expect(css).toContain("border-color: transparent");
  expect(css).not.toContain(".message-body::after");
  const [ordinary, media] = css.split("/* Media and conference cards are the message surface");
  expect(ordinary).not.toMatch(/font-size:|line-height:|padding:|min-width:|max-width:|outline:|animation:/);
  expect(css).not.toMatch(/font-size:|line-height:|outline:|animation:/);
  expect(media).toContain("padding: 0;");
  expect(media).toContain("width: 320px; max-width: calc(100% - 44px)");
  expect(media).toContain(".message-body.is-document-message { padding-block: 8px; }");
});
