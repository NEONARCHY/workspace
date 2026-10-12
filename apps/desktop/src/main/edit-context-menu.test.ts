import { describe, expect, it } from "vitest";
import { editContextMenu } from "./edit-context-menu";

const editFlags = { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: false };

describe("native editing context menu", () => {
  it("offers native clipboard roles only for editable fields", () => {
    expect(editContextMenu({ isEditable: false, editFlags })).toEqual([]);
    expect(editContextMenu({ isEditable: true, editFlags })).toEqual([
      { role: "cut", label: "Вырезать", enabled: true },
      { role: "copy", label: "Копировать", enabled: true },
      { role: "paste", label: "Вставить", enabled: true },
      { type: "separator" },
      { role: "selectAll", label: "Выделить всё", enabled: true },
    ]);
  });
  it("keeps Chromium password and editing restrictions", () => {
    const menu = editContextMenu({ isEditable: true, editFlags: { ...editFlags, canCopy: false, canCut: false, canPaste: false } });
    expect(menu.find((item) => item.role === "copy")?.enabled).toBe(false);
    expect(menu.find((item) => item.role === "cut")?.enabled).toBe(false);
    expect(menu.find((item) => item.role === "paste")?.enabled).toBe(false);
  });
});
