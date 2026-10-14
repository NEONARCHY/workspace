import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps animated words in normal inline flow, including the assistant", () => {
  for (const file of ["workspace-2-messenger.css", "assistant-chat.css"]) {
    const css = readFileSync(`src/renderer/${file}`, "utf8");
    expect(css).toMatch(/\.message-text-word\s*\{ display: inline; position: relative;/);
    expect(css).not.toMatch(/\.message-text-word\s*\{[^}]*inline-block/);
  }
});
it("uses intrinsic image height and content-sized attachment bubbles", () => {
  const css = readFileSync("src/renderer/attachment-thumbnails.css", "utf8");
  expect(css).toContain('.has-image-size .attachment-image-thumb { aspect-ratio: auto; }');
  expect(css).toContain('.has-image-size .attachment-image-thumb img { height: auto; }');
  expect(css).toContain('.message-body.has-attachments { width: max-content; max-width: 100%; }');
  expect(css).toContain('flex-direction: column; align-items: flex-start;');
});
