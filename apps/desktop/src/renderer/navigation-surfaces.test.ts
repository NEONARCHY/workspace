import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const headerCss = readFileSync("src/renderer/section-headers.css", "utf8");
const messengerCss = readFileSync("src/renderer/workspace-2-messenger.css", "utf8");
const approvalsCss = readFileSync("src/renderer/workspace-2-payments.css", "utf8").replaceAll("\r\n", "\n");
const tabs = ".ws-section-header :is(.view-switch, .process-view-tabs, .approval-mode-switch, .ws2-segmented)";
it("shares the payment toolbar treatment with trip view, filter and count buttons", () => {
  const trip = 'html:not([data-color-theme="dark"]) .trips-view .trip-commandbar .ws2-segmented';
  const payment = 'html:not([data-color-theme="dark"]) .approvals-view .approval-view-toolbar .ws2-segmented';
  for (const suffix of ["", " > button", " .approval-filter-count", ' > button:not([aria-pressed="true"]):hover']) {
    expect(approvalsCss).toContain(`${trip}${suffix},\n  ${payment}${suffix} {`);
  }
  expect(readFileSync("src/renderer/TripApprovalsView.tsx", "utf8")).toContain('<span className="approval-filter-count">{filterCounts[key]}</span>');
});
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
  const idleColor = idle.match(/color:[^;]*(#[a-f0-9]{6})/)![1]!;
  const selectedColor = selected.match(/color:[^;]*(#[a-f0-9]{6})/)![1]!;
  for (const [ink, surface] of [[idleColor, "#e7eeee"], [selectedColor, "#ffffff"]]) {
    const a = luminance(ink!), b = luminance(surface!);
    expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toBeGreaterThanOrEqual(4.5);
  }
  expect(idle).toContain("font-weight: 600;");
  expect(selected).toContain("font-weight: 600;");
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

it("separates light approval tools from the canvas without changing dark or high-contrast styles", () => {
  const scope = 'html:not([data-color-theme="dark"]) .approvals-view';
  const tokens = block(approvalsCss, scope);
  const color = (role: string) => tokens.match(new RegExp(`--approval-${role}: (#[a-f0-9]{6});`))![1]!;
  const summary = color("summary-surface"), control = color("control-surface"), selected = color("control-selected");
  const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  expect(summary).toBe("#ffffff");
  expect(selected).toBe("#ffffff");
  expect(contrast(control, selected)).toBeGreaterThan(1.25);
  expect(contrast(control, "#edf2f1")).toBeGreaterThan(1.1);
  for (const surface of [summary, control, selected, color("control-hover"), color("action-selected")]) {
    expect(contrast("#293a55", surface)).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrast("#006779", color("action-surface"))).toBeGreaterThanOrEqual(4.5);
  expect(approvalsCss).toMatch(/@media \(forced-colors: none\)\s*\{\s*html:not\(\[data-color-theme="dark"\]\)/);
  const tripScope = 'html:not([data-color-theme="dark"]) .trips-view';
  const sharedSummary = block(approvalsCss, `${scope} .approval-commandbar,\n  ${tripScope} .ws2-process-overview`);
  expect(sharedSummary).toContain("background: var(--approval-summary-surface);");
  expect(sharedSummary).toContain("border-color: transparent;");
  expect(sharedSummary).toContain("box-shadow: 0 4px 14px -8px rgb(41 58 85 / 24%);");
  expect(block(approvalsCss, `${scope} .approval-metric-actionable,\n  ${tripScope} .ws2-process-focus`)).toContain("background: var(--approval-action-surface);");
  expect(block(approvalsCss, `${scope} .approval-view-toolbar .ws2-segmented`)).toContain("--sliding-indicator-background: var(--approval-control-selected);");
  expect(block(approvalsCss, `${scope} .approval-view-toolbar .ws2-segmented > button:not([aria-pressed="true"]):hover`)).toContain("background: var(--approval-control-hover);");
  expect(approvalsCss).toContain("outline: 2px solid var(--ws-link);");
  expect(block(approvalsCss, `${scope} .approval-view-toolbar .ws2-segmented .approval-filter-count`)).toContain("color: var(--ws-link);");
  const focusCss = readFileSync("src/renderer/workspace-2-focus.css", "utf8");
  expect(focusCss).toContain(".approval-view-toolbar *, .approval-metric-actionable");
});
