import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync("src/renderer/messenger-voice.css", "utf8");
it("keeps voice controls compact on one bubble surface with a wrapping metadata line", () => {
  expect(css).toContain("grid-template-columns: 44px minmax(0, 1fr) 32px 32px");
  expect(css).toContain("--media-play-size: 44px");
  expect(css).toContain("background: transparent; box-shadow: none");
  expect(css).toContain(".voice-message-size { color: inherit; font: inherit; }");
  expect(css).not.toMatch(/animation:|transition:|outline:\s*(?:0|none)/);
});
it("preserves touch hit areas and forced-colour player affordances", () => {
  expect(css).toContain("@media (pointer: coarse)");
  expect(css).toContain("grid-template-columns: 48px minmax(0, 1fr) 48px 48px");
  expect(css).toContain("@media (forced-colors: active)");
  expect(css).toContain("--voice-play-fill: ButtonFace");
  expect(css).toContain("border: 1px solid ButtonText");
});
