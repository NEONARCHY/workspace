import { describe, expect, it } from "vitest";
import { assistantPanelLayout } from "./assistant-panel-layout";

describe("assistant window below its stationary toolbar", () => {
  it.each([
    { width: 1440, height: 960, top: 0, headerBottom: 64, browserCompact: false },
    { width: 1024, height: 768, top: 0, headerBottom: 64, browserCompact: false },
    { width: 720, height: 480, top: 0, headerBottom: 60, browserCompact: true },
    { width: 320, height: 800, top: 0, headerBottom: 60, browserCompact: true },
    { width: 390, height: 180, top: 0, headerBottom: 60, browserCompact: true },
    { width: 390, height: 260, top: 200, headerBottom: 60, browserCompact: true },
  ])("keeps normal and expanded windows inside $width × $height, top=$top", viewport => {
    for (const expanded of [false, true]) {
      const layout = assistantPanelLayout(viewport, expanded);
      const top = layout.compact || expanded ? layout.panelTop : viewport.height - layout.edge - layout.panelHeight;
      expect(top).toBeGreaterThanOrEqual(viewport.headerBottom + 8);
      expect(top).toBeGreaterThanOrEqual(viewport.top);
      expect(layout.panelHeight).toBeGreaterThan(0);
      expect(top + layout.panelHeight + layout.edge).toBeLessThanOrEqual(viewport.top + viewport.height);
      expect(layout.panelWidth + layout.edge * 2).toBeLessThanOrEqual(viewport.width);
    }
  });
});
