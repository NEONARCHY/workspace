import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync("src/renderer/ai-referent-workspace.css", "utf8");
it("animates only a non-interactive halo, keeping both action labels and geometry still", () => {
  expect(css).toContain(".ai-referent-register-action:not(:disabled)::after");
  expect(css).toContain("pointer-events: none;");
  expect(css).toContain("animation: ai-register-action-breathe 4.2s ease-in-out infinite;");
  const frames = css.match(/@keyframes ai-register-action-breathe \{([\s\S]*?)\n\}/)?.[1];
  expect(frames).toContain("opacity: .22;");
  expect(frames).toContain("opacity: .90;");
  expect(frames).not.toMatch(/transform|filter|box-shadow|width|height/);
  expect(css).toContain(".secondary::after { animation-delay: -2.1s; }");
});
it("tunes both themes and disables decorative motion for reduced motion and forced colors", () => {
  expect(css).toContain("--ai-action-glow-strength: .24;");
  expect(css).toContain("--ai-action-glow-strength: .34;");
  expect(css).toContain('html[data-color-theme="dark"] .ai-referent-register-actions');
  expect(css).toContain("@media (forced-colors: none)");
  expect(css).toContain(".ai-referent-register-action:not(:disabled)::after { animation: none; opacity: .35; }");
});
it("uses visible downward breathing shadows only in light theme, preserving the dark halo", () => {
  const light = css.match(/html:not\(\[data-color-theme="dark"\]\) \.ai-referent-register-actions \.ai-referent-register-action:not\(:disabled\)::after \{([\s\S]*?)\n {2}\}/)?.[1];
  expect(light).toContain("0 5px 8px -3px rgb(35 65 88 / .28)");
  expect(light).toContain("0 11px 18px -4px rgb(35 65 88 / .38)");
  expect(light).not.toMatch(/animation|transform|filter/);
  expect(css).toContain("0 0 16px 3px rgb(var(--ai-action-glow-rgb) / var(--ai-action-glow-strength))");
});
