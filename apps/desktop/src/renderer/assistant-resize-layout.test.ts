import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("anchors the header title to its header rather than running a separate layout animation", () => {
  const source = readFileSync("src/renderer/YuksalishAssistant.tsx", "utf8");
  expect(source).toContain('<span className="assistant-header-title">');
  expect(source).not.toContain('<motion.span layout="position" className="assistant-header-title"');
  expect(source).toContain("const animation = panel.animate([");
  expect(source).toContain("const orbResize = orb");
  const css = readFileSync("src/renderer/assistant-chat.css", "utf8");
  expect(css).toContain(".assistant-resize-snapshot { position: absolute; inset: 0 auto auto 0;");
});
it("gives chat scrolling the remaining sidebar height without horizontal overflow or intrinsic column growth", () => {
  const css = readFileSync("src/renderer/assistant-chat.css", "utf8");
  const list = css.match(/\.assistant-sidebar-list \{([^}]+)\}/)?.[1];
  expect(list).toContain("flex: 1;");
  expect(list).toContain("grid-template-columns: minmax(0, 1fr);");
  expect(list).toContain("min-width: 0;");
  expect(list).toContain("overflow-x: hidden;");
  expect(list).toContain("overflow-y: auto;");
  expect(list).toContain("padding: 3px;");
});
