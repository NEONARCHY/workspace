import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync("src/renderer/browser-secondary.css", "utf8");
it("provides compact pages a native fallback and does not clip the tall task workbench", () => {
  expect(css).toContain(".web-platform .app-shell.browser-compact .app-content { overflow-y: auto; }");
  expect(css).toContain("flex: none; height: auto; overflow: visible;");
  expect(css).toContain(".tasks-view.bp5-tasks:not(.dashboard-mode, .efficiency-mode) .tasks-main");
});
it("extends the chat scroll hit area through the pane gutters", () => {
  expect(css).toContain(".web-platform .messenger-view .list-pane .chat-list");
  expect(css).toContain("margin-inline: -14px; padding-inline: 16px;");
  expect(css).toContain("min-height: min(220px, 40dvh);");
});
it("allows nested list vertical chaining without disabling horizontal board containment", () => {
  expect(css).toContain("overscroll-behavior-y: auto;");
  const responsive = readFileSync("src/renderer/browser-responsive.css", "utf8");
  expect(responsive).toContain("overscroll-behavior-inline: contain");
});
