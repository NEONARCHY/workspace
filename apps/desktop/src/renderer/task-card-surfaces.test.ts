import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/renderer/workspace-2-tasks.css", "utf8");
const darkSection = css.match(/html\[data-color-theme="dark"\] \.task-record-dialog \.task-detail > :is\([^}]+\{([^}]+)\}/)?.[1] ?? "";

describe("task card surfaces", () => {
  it("shows the author before the assignee, compact co-assignees and photo-capable avatars", () => {
    const source = readFileSync("src/renderer/TasksView.tsx", "utf8");
    const participant = source.slice(source.indexOf("function ParticipantChip("));
    const header = source.slice(source.indexOf('<div className="detail-meta">'), source.indexOf('<div ref={lifecycleRef}'));
    expect(header.indexOf('label="Постановщик"')).toBeLessThan(header.indexOf('label="Ответственный"'));
    expect(header).toContain('className="task-detail-co-assignee-list"');
    expect(header).toContain('role === "co_assignee"');
    expect(source).toMatch(/className="task-person-avatar"><TaskPersonAvatar[^>]+size=\{48\}/);
    expect(participant).toMatch(/className="task-person-avatar"><TaskPersonAvatar[^>]+size=\{32\}/);
    expect(readFileSync("src/renderer/TaskPersonAvatar.tsx", "utf8")).toContain("<ProfileAvatar person={person} token={token}");
  });
  it("paints recessed sections only in dark mode and reserves the shared border box", () => {
    expect(darkSection).toContain("border-color: transparent");
    expect(darkSection).toContain("background: var(--ws-surface-recessed, #14151a)");
    expect(darkSection).toContain("box-shadow: none");
    expect(darkSection).not.toMatch(/border(?:-width)?:|padding:|margin:/);
    expect(css).toContain("@media (forced-colors: none)");
  });
  it("uses a soft shared employee edge and a dark-only satin paint", () => {
    const satin = css.match(/html\[data-color-theme="dark"\] \.task-record-dialog :is\(\.task-person-avatar, \.participant-chip\) \{([^}]+)\}/)?.[1] ?? "";
    expect(satin).toContain("var(--ws-satin-sheen)");
    expect(satin).toContain("var(--ws-satin-edge)");
    expect(satin).toContain("background-clip: padding-box, border-box, border-box");
    expect(css).toContain("border: 1px solid color-mix");
    expect(css).toContain(".task-record-dialog :is(.task-person-avatar, .participant-chip) { border-color: CanvasText; box-shadow: none; }");
  });
});
