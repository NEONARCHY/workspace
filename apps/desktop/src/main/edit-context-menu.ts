import type { ContextMenuParams, MenuItemConstructorOptions } from "electron";

// Chromium supplies editing capabilities, including disabled/read-only fields
// and password protections. No renderer clipboard-read permission is needed.
export function editContextMenu(params: Pick<ContextMenuParams, "isEditable" | "editFlags">): MenuItemConstructorOptions[] {
  if (!params.isEditable) return [];
  const flags = params.editFlags;
  return [
    { role: "cut", label: "Вырезать", enabled: flags.canCut },
    { role: "copy", label: "Копировать", enabled: flags.canCopy },
    { role: "paste", label: "Вставить", enabled: flags.canPaste },
    { type: "separator" },
    { role: "selectAll", label: "Выделить всё", enabled: flags.canSelectAll },
  ];
}
