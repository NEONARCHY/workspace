import { useCallback, useState } from "react";
import { Button, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { Dismiss20Regular, Document20Regular } from "@fluentui/react-icons";
import { InlineVideoPlayer } from "./AttachmentPanel";
import { fileViewerKind } from "./file-viewer-kind";
import { WorkspaceDialog } from "./WorkspaceDialog";
import "./pending-message-files.css";

function PendingFile({ file, disabled, onRemove }: {
  readonly file: File;
  readonly disabled: boolean;
  readonly onRemove: () => void;
}) {
  const kind = fileViewerKind({ fileName: file.name, contentType: file.type });
  const media = kind === "image" || kind === "video";
  const [resource, setResource] = useState<{ file: File; url: string; failed: boolean }>();
  const [open, setOpen] = useState(false);
  // A committed card owns its URL. React 19 ref cleanup also covers StrictMode,
  // removal, successful send and switching chats, without reading file bytes.
  const previewRef = useCallback((node: HTMLElement | null) => {
    if (!node || !media) return;
    let url = "";
    try {
      url = URL.createObjectURL(file);
      setResource({ file, url, failed: false });
    } catch { setResource({ file, url: "", failed: true }); }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [file, media]);
  const current = resource?.file === file ? resource : undefined;
  const fail = () => setResource(value => value ? { ...value, failed: true } : value);
  const preview = current?.url && !current.failed;
  return <article ref={previewRef} className={`pending-message-file${media ? " is-media" : ""}`}>
    {media && <div className="pending-message-file-media">
      {preview ? kind === "video"
        ? <InlineVideoPlayer url={current.url} fileName={file.name} onError={fail} />
        : <button type="button" aria-label={`Предпросмотр ${file.name}`} onClick={() => setOpen(true)}>
            <img src={current.url} alt={file.name} loading="lazy" onError={fail} />
          </button>
        : <span>{current?.failed ? "Предпросмотр недоступен" : "Готовим предпросмотр…"}</span>}
    </div>}
    <div className="pending-message-file-caption">
      {!media && <Document20Regular aria-hidden="true" />}
      <span title={file.name}>{file.name}<small>{(file.size / (1024 * 1024)).toFixed(1)} МБ</small></span>
      {media && preview && <Button appearance="subtle" size="small" aria-label={`Открыть крупно ${file.name}`}
        onClick={() => setOpen(true)}>Открыть</Button>}
      <Button appearance="subtle" size="small" icon={<Dismiss20Regular />} disabled={disabled}
        aria-label={`Убрать файл ${file.name}`} onClick={onRemove} />
    </div>
    {open && <WorkspaceDialog open onOpenChange={(_, data) => setOpen(data.open)}>
      <DialogSurface className="pending-media-dialog" aria-label={`Предпросмотр ${file.name}`}>
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" icon={<Dismiss20Regular />}
            aria-label="Закрыть предпросмотр" onClick={() => setOpen(false)} />}>{file.name}</DialogTitle>
          <DialogContent>
            {preview ? kind === "video" ? <InlineVideoPlayer url={current.url} fileName={file.name} onError={fail} />
              : <img src={current.url} alt={file.name} onError={fail} />
              : <p role="alert">Этот формат не удалось показать. Файл остаётся прикреплённым.</p>}
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </WorkspaceDialog>}
  </article>;
}

export function PendingMessageFiles({ files, disabled, onRemove }: {
  readonly files: readonly File[];
  readonly disabled: boolean;
  readonly onRemove: (index: number) => void;
}) {
  if (!files.length) return null;
  return <div className="pending-message-files" role="group" aria-label="Прикреплённые файлы · ещё не отправлены">
    {files.map((file, index) => <PendingFile key={`${file.name}:${file.lastModified}:${file.size}:${index}`}
      file={file} disabled={disabled} onRemove={() => onRemove(index)} />)}
  </div>;
}
