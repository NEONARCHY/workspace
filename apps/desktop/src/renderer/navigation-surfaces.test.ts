import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const headerCss = readFileSync("src/renderer/section-headers.css", "utf8");
const messengerCss = readFileSync("src/renderer/workspace-2-messenger.css", "utf8");
const tabs = ".ws-section-header :is(.view-switch, .process-view-tabs, .approval-mode-switch, .ws2-segmented)";
function block(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing style: ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}
function luminance(hex: string) {
  return hex.slice(1).match(/../g)!.map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
}

it("keeps header tabs readable with a strong selected state and shared typography", () => {
  const idle = block(headerCss, `${tabs} > button`);
  const selected = block(headerCss, `${tabs} > button:is(.active, [aria-pressed="true"], [aria-selected="true"])`);
  const idleColor = idle.match(/color:\s*(#[a-f0-9]{6});/)![1]!;
  const selectedColor = selected.match(/color:[^;]*(#[a-f0-9]{6})/)![1]!;
  for (const [ink, surface] of [[idleColor, "#e7eeee"], [selectedColor, "#ffffff"]]) {
    const a = luminance(ink!), b = luminance(surface!);
    expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toBeGreaterThanOrEqual(4.5);
  }
  expect(idle).toContain("font-weight: 600;");
  expect(selected).toContain("font-weight: 700;");
  expect(headerCss).toContain(`${tabs} button:focus-visible`);
  expect(headerCss).toContain("background: Highlight; border-color: Highlight;");
});

it("renders tidy borderless background swatches while preserving selection and focus on the option", () => {
  const preview = block(messengerCss, ".chat-background-preview");
  expect(preview).toContain("box-sizing: border-box;");
  expect(preview).toContain("border: 0;");
  expect(preview).toContain("box-shadow: none;");
  expect(preview).toContain("overflow: hidden;");
  expect(messengerCss).toContain('.chat-background-options > button[aria-pressed="true"]');
  expect(messengerCss).toContain(".chat-background-options > button:focus-visible");
});
