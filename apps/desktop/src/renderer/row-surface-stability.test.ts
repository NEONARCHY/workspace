import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("working row surfaces", () => {
  it("reduces notification vertical padding by 8px without shrinking typography or action targets", () => {
    const css = readFileSync("src/renderer/workspace-2-notifications.css", "utf8");
    const row = css.match(/\.notifications-view \.notification-row \{([^}]+)\}/)?.[1];
    expect(row).toContain("min-height: 97px");
    expect(row).toContain("padding: 13px 13px 13px 17px");
    expect(css).toContain(".notifications-view .notification-open > b { color: var(--notification-ink); font-size: 15px; }");
    expect(css).toContain("min-height: 28px");
  });

  it("keeps team attention row geometry rounded at rest and does not change it on hover", () => {
    const css = readFileSync("src/renderer/spatial-workspace.css", "utf8");
    const row = css.match(/\.team-dash-task \{([^}]+)\}/)?.[1];
    const hover = css.match(/\.team-dash-task:hover \{([^}]+)\}/)?.[1];
    expect(row).toContain("border-radius: 14px");
    expect(hover).not.toMatch(/border-radius|padding|height|width/);
    expect(hover).toContain("background:");
  });
});
