import { useEffect, useState, type DragEvent, type ReactNode } from "react";

import { Attach20Regular } from "@fluentui/react-icons";

interface WorkspaceFileDropzoneProps {
  readonly label: string;
  readonly hint: string;
  readonly actionLabel: string;
  readonly files?: readonly File[];
  readonly showSelectedFiles?: boolean;
  readonly accept?: string;
  readonly multiple?: boolean;
  readonly disabled?: boolean;
  readonly icon?: ReactNode;
  readonly emphasized?: boolean;
  readonly ariaLabel?: string;
  readonly onFiles: (files: File[]) => void;
}

export function WorkspaceFileDropzone({
  label,
  hint,
  actionLabel,
  files = [],
  showSelectedFiles = true,
  accept,
  multiple = false,
  disabled = false,
  icon,
  emphasized = false,
  ariaLabel,
  onFiles,
}: WorkspaceFileDropzoneProps) {
  // Chromium treats a hidden file input as focus-visible even after a mouse
  // click. Track real keyboard traversal instead of showing a click halo.
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Tab") setKeyboardFocus(true); };
    const pointer = () => setKeyboardFocus(false);
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("pointerdown", pointer, true);
    return () => {
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("pointerdown", pointer, true);
    };
  }, []);
  const select = (selected: FileList | null) => {
    const next = Array.from(selected ?? []);
    if (!disabled && next.length) onFiles(multiple ? next : next.slice(0, 1));
  };
  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) select(event.dataTransfer.files);
  };
  return <label
    className={`ws-file-dropzone${emphasized ? " is-emphasized" : ""}${disabled ? " is-disabled" : ""}${dragging && !disabled ? " is-dragging" : ""}`}
    data-keyboard-focus={keyboardFocus || undefined}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; if (!disabled && Array.from(event.dataTransfer.types).includes("Files")) setDragging(true); }}
    onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
    onDrop={drop}
  >
    <input className="ws-file-dropzone-input" type="file" accept={accept} multiple={multiple} disabled={disabled} aria-label={ariaLabel ?? label} onChange={(event) => { select(event.target.files); event.currentTarget.value = ""; }} />
    <span className="ws-file-dropzone-icon">{icon ?? <Attach20Regular aria-hidden="true" />}</span>
    <span className="ws-file-dropzone-copy"><strong>{label}</strong><small>{hint}</small>{showSelectedFiles && files.length ? <span className="ws-file-dropzone-selected">{files.slice(0, 2).map((file, index) => <em key={`${file.name}-${index}`} title={file.name}>{file.name}</em>)}{files.length > 2 ? <em>+{files.length - 2}</em> : null}</span> : null}</span>
    <span className="ws-file-dropzone-action">{actionLabel}</span>
  </label>;
}
