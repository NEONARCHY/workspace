import type { DragEvent, ReactNode } from "react";

import { Attach20Regular } from "@fluentui/react-icons";

interface WorkspaceFileDropzoneProps {
  readonly label: string;
  readonly hint: string;
  readonly actionLabel: string;
  readonly files?: readonly File[];
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
  accept,
  multiple = false,
  disabled = false,
  icon,
  emphasized = false,
  ariaLabel,
  onFiles,
}: WorkspaceFileDropzoneProps) {
  const select = (selected: FileList | null) => {
    const next = Array.from(selected ?? []);
    if (next.length) onFiles(multiple ? next : next.slice(0, 1));
  };
  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (!disabled) select(event.dataTransfer.files);
  };
  return <label
    className={`ws-file-dropzone${emphasized ? " is-emphasized" : ""}${disabled ? " is-disabled" : ""}`}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
    onDrop={drop}
  >
    <input className="ws-file-dropzone-input" type="file" accept={accept} multiple={multiple} disabled={disabled} aria-label={ariaLabel ?? label} onChange={(event) => { select(event.target.files); event.currentTarget.value = ""; }} />
    <span className="ws-file-dropzone-icon">{icon ?? <Attach20Regular aria-hidden="true" />}</span>
    <span className="ws-file-dropzone-copy"><strong>{label}</strong><small>{hint}</small>{files.length ? <span className="ws-file-dropzone-selected">{files.slice(0, 2).map((file, index) => <em key={`${file.name}-${index}`} title={file.name}>{file.name}</em>)}{files.length > 2 ? <em>+{files.length - 2}</em> : null}</span> : null}</span>
    <span className="ws-file-dropzone-action">{actionLabel}</span>
  </label>;
}
