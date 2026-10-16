import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("reveals fixed context panels with a shadow-inclusive mask, never animated layout or text", () => {
  const css = readFileSync("src/renderer/topbar-insights.css", "utf8");
  expect(css).toContain("border-radius: 20px");
  expect(css).toContain("box-shadow: var(--ws-shadow-float)");
  const keyframes = css.split("@keyframes topbar-context-curtain")[1]!.split(".context-panel-head h2")[0]!;
  expect(keyframes).toContain("inset(-128px -128px 100%)");
  expect(keyframes).toContain("inset(-128px)");
  expect(keyframes).not.toMatch(/height|width|transform|opacity|round/);
  expect(css).toContain("(prefers-reduced-motion: no-preference) and (forced-colors: none)");
  const component = readFileSync("src/renderer/TopbarInsights.tsx", "utf8");
  expect(component.match(/<Popover surfaceMotion=\{null\}/g)).toHaveLength(2);
  expect(component.match(/data-surface-resize-motion="off"/g)).toHaveLength(2);
  expect(component).not.toContain("ContextPanelCurtain");
  expect(css.match(/:has\(\.topbar-insights\):has\(\.assistant-launcher-space\[data-vacated\]\)/g)).toHaveLength(2);
  const compact = readFileSync("src/renderer/mobile-density.css", "utf8");
  expect(compact).toContain(".assistant-launcher-space[data-vacated]");
  expect(compact).toContain("flex: 0 0 0; width: 0; min-width: 0; max-width: 0; margin-inline-start: -6px");
});

it("gives every composer tool the same theme surface without disabling the microphone", () => {
  const css = readFileSync("src/renderer/workspace-2-messenger.css", "utf8");
  expect(css).toContain("--composer-tool-fill: var(--colorNeutralBackground3)");
  expect(css).toContain("--composer-tool-fill: var(--ws-button-surface)");
  expect(css).toContain(".composer .composer-tool-button:disabled { color: var(--colorNeutralForegroundDisabled); }");
  expect(css).toContain('.composer-microphone[aria-disabled="true"]:is(:hover, :focus-visible)');
});

it("keeps the rewrite button level with sibling tools when the draft grows", () => {
  const css = readFileSync("src/renderer/workspace-2-messenger.css", "utf8");
  const anchor = css.match(/\.messenger-view \.composer-rewrite-anchor \{([^}]+)\}/)?.[1] ?? "";
  expect(anchor).toContain("display: flex");
  expect(anchor).toContain("align-self: start");
  expect(anchor).not.toMatch(/align-self:\s*center|transform|margin|top:/);
});

it("lets the ready recording track fill space immediately after its status label", () => {
  const css = readFileSync("src/renderer/workspace-2-messenger.css", "utf8");
  expect(css).toMatch(/\.messenger-view \.voice-recorder-ready\s*\{\s*grid-template-columns: max-content minmax\(0, 1fr\) auto;/);
  expect(css).not.toContain("minmax(150px, 220px)");
});

it("keeps live and ready recorder tracks at the same fixed height without clipping controls", () => {
  const css = readFileSync("src/renderer/workspace-2-messenger.css", "utf8");
  expect(css).toContain("--voice-recorder-track-height: 40px");
  expect(css).toContain(".messenger-view .voice-recorder-live-waveform { height: var(--voice-recorder-track-height); }");
  const preview = css.match(/\.messenger-view \.voice-preview \.voice-player \{\s*box-sizing:[^}]*\}/)?.[0] ?? "";
  expect(preview).toContain("height: var(--voice-recorder-track-height)");
  expect(preview).toContain("min-height: var(--voice-recorder-track-height)");
  expect(preview).toContain("grid-template-rows: minmax(0, 1fr)");
  expect(preview).toContain("grid-template-columns: 32px minmax(0, 1fr) 32px");
  expect(css).toContain(".messenger-view .voice-preview .voice-player-play { --media-play-size: 32px; }");
  expect(preview).toContain("padding-block: 0");
  expect(preview).not.toMatch(/overflow:\s*(hidden|clip)/);
  expect(css).toContain("@media (pointer: coarse), (max-width: 760px)");
  expect(css).toContain("--voice-recorder-track-height: 48px");
  const narrow = css.split("@container messenger-conversation (max-width: 520px)")[1]!;
  expect(narrow).toContain(".messenger-view .voice-recorder .voice-preview");
  expect(narrow).toContain(".messenger-view .voice-recorder .voice-recorder-live-waveform { grid-row: 2; }");
  expect(narrow).toContain(".messenger-view .voice-recorder .voice-recorder-actions {");
  expect(narrow).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
});
