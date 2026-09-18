import { useEffect, useRef, useState } from "react";

import type { WorkspaceAttachment } from "@yuksalish/contracts";
import { Button, Spinner } from "@fluentui/react-components";
import { ArrowDownload24Regular, Attach24Regular, Document24Regular } from "@fluentui/react-icons";

interface AttachmentChipsProps {
  readonly attachments: readonly WorkspaceAttachment[];
  readonly onDownload: (attachment: WorkspaceAttachment) => void | Promise<void>;
  readonly onLoad?: (attachment: WorkspaceAttachment) => Promise<Blob>;
}

function fileSize(value: number): string {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} КБ`;
  return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

function AttachmentPreview({ attachment, onLoad, onDownload }: {
  readonly attachment: WorkspaceAttachment;
  readonly onLoad: (attachment: WorkspaceAttachment) => Promise<Blob>;
  readonly onDownload: (attachment: WorkspaceAttachment) => void | Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void onLoad(attachment).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => active && setFailed(true));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment, onLoad]);
  const image = attachment.contentType.startsWith("image/");
  return <article className="attachment-media-preview">
    {url && image ? <img src={url} alt={attachment.fileName} /> : null}
    {url && !image ? <video src={url} controls preload="metadata" aria-label={attachment.fileName} /> : null}
    {!url ? <span>{failed ? "Превью недоступно" : "Загружаем превью…"}</span> : null}
    <button type="button" onClick={() => void onDownload(attachment)} title={`Скачать ${attachment.fileName}`}><ArrowDownload24Regular /><span>{attachment.fileName}</span><small>{fileSize(attachment.byteSize)}</small></button>
  </article>;
}

export function AttachmentChips({ attachments, onDownload, onLoad }: AttachmentChipsProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="attachment-chips" aria-label="Вложения">
      {attachments.map((attachment) => onLoad && (attachment.contentType.startsWith("image/") || attachment.contentType.startsWith("video/")) ? (
        <AttachmentPreview key={attachment.id} attachment={attachment} onLoad={onLoad} onDownload={onDownload} />
      ) : (
        <button
          key={attachment.id}
          type="button"
          title={`${attachment.fileName}, ${fileSize(attachment.byteSize)}`}
          onClick={() => void onDownload(attachment)}
        >
          <Document24Regular />
          <span>{attachment.fileName}</span>
          <small>{fileSize(attachment.byteSize)}</small>
          <ArrowDownload24Regular />
        </button>
      ))}
    </div>
  );
}

interface AttachmentPanelProps extends AttachmentChipsProps {
  readonly title?: string;
  readonly canUpload: boolean;
  readonly onUpload: (files: readonly File[]) => void | Promise<void>;
}

export function AttachmentPanel({
  attachments,
  canUpload,
  onDownload,
  onUpload,
  title = "Вложения",
}: AttachmentPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (files: FileList | null) => {
    if (files === null || files.length === 0) return;
    setBusy(true);
    try {
      await onUpload(Array.from(files));
    } finally {
      setBusy(false);
      if (inputRef.current !== null) inputRef.current.value = "";
    }
  };

  return (
    <section className="attachment-panel">
      <div className="attachment-panel-heading">
        <h3>{title}</h3>
        {canUpload ? (
          <>
            <input
              ref={inputRef}
              hidden
              type="file"
              multiple
              aria-label={`Добавить файлы: ${title}`}
              onChange={(event) => void upload(event.target.files)}
            />
            <Button
              appearance="subtle"
              icon={busy ? <Spinner size="tiny" /> : <Attach24Regular />}
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              Добавить файл
            </Button>
          </>
        ) : null}
      </div>
      <AttachmentChips attachments={attachments} onDownload={onDownload} />
      {attachments.length === 0 ? <p className="attachment-empty">Файлов пока нет</p> : null}
    </section>
  );
}

interface PendingFilePickerProps {
  readonly files: readonly File[];
  readonly onChange: (files: readonly File[]) => void;
  readonly label?: string;
}

export function PendingFilePicker({ files, onChange, label = "Выбрать файлы" }: PendingFilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="pending-file-picker">
      <input
        ref={inputRef}
        hidden
        type="file"
        multiple
        aria-label={label}
        onChange={(event) => onChange(Array.from(event.target.files ?? []))}
      />
      <Button appearance="subtle" icon={<Attach24Regular />} onClick={() => inputRef.current?.click()}>
        {label}
      </Button>
      {files.length > 0 ? (
        <span>{files.map((file) => file.name).join(", ")}</span>
      ) : (
        <span>До 25 МБ на файл</span>
      )}
    </div>
  );
}
