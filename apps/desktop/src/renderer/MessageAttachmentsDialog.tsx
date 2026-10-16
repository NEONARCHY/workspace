import { useEffect, useRef, useState } from "react";
import { Button, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Textarea } from "@fluentui/react-components";
import { Add20Regular, Dismiss20Regular, Send20Regular } from "@fluentui/react-icons";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { PendingMessageFiles } from "./PendingMessageFiles";
import { fileViewerKind } from "./file-viewer-kind";
import { albumTileStyle, imageAlbumLayout, type ImageGeometry } from "./image-album-layout";
import "./message-attachments-dialog.css";

interface Preview { readonly file: File; readonly url: string; size: ImageGeometry }
function SelectedPhotos({ files, onRemove }: { readonly files: readonly File[]; readonly onRemove: (index: number) => void }) {
  const resources = useRef(new Map<File, Preview>());
  const [previews, setPreviews] = useState<readonly Preview[]>([]);
  useEffect(() => {
    const refresh = () => setPreviews(files.map(file => resources.current.get(file)!).filter(Boolean));
    for (const [file, entry] of resources.current) if (!files.includes(file)) { URL.revokeObjectURL(entry.url); resources.current.delete(file); }
    for (const file of files) {
      if (resources.current.has(file)) continue;
      const entry: Preview = { file, url: URL.createObjectURL(file), size: { width: 4, height: 3 } };
      resources.current.set(file, entry);
      const image = new Image();
      image.onload = () => {
        if (resources.current.get(file) !== entry) return;
        if (image.naturalWidth && image.naturalHeight) entry.size = { width: image.naturalWidth, height: image.naturalHeight };
        refresh();
      };
      image.src = entry.url;
    }
    refresh();
  }, [files]);
  useEffect(() => () => { for (const entry of resources.current.values()) URL.revokeObjectURL(entry.url); resources.current.clear(); }, []);
  const groups = Array.from({ length: Math.ceil(previews.length / 10) }, (_, index) => previews.slice(index * 10, index * 10 + 10));
  return <div className="selected-photo-albums">{groups.map((group, groupIndex) => {
    const layout = imageAlbumLayout(group.map(entry => entry.size));
    return <div className="selected-photo-album" key={groupIndex} style={{ aspectRatio: `${layout.width} / ${layout.height}` }}>
      {group.map((entry, index) => <div className="selected-photo-tile" key={`${groupIndex}:${index}`} style={albumTileStyle(layout.tiles[index]!, layout)}>
        <img src={entry.url} alt={entry.file.name} />
        <Button appearance="subtle" size="small" icon={<Dismiss20Regular />} aria-label={`Убрать файл ${entry.file.name}`} onClick={() => onRemove(files.indexOf(entry.file))} />
      </div>)}
    </div>;
  })}</div>;
}

export function MessageAttachmentsDialog({ files, caption, blockedReason, errorMessage, onFiles, onCaption, onRemove, onAdd, onSend, onClose }: {
  readonly files: readonly File[]; readonly caption: string; readonly blockedReason?: string;
  readonly errorMessage?: string; readonly onFiles: (files: readonly File[]) => void;
  readonly onCaption: (value: string) => void; readonly onRemove: (index: number) => void;
  readonly onAdd: () => void; readonly onSend: () => void; readonly onClose: () => void;
}) {
  const photos = files.every(file => fileViewerKind({ fileName: file.name, contentType: file.type }) === "image");
  const [dropError, setDropError] = useState("");
  const captionRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const focusFrame = requestAnimationFrame(() => captionRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(focusFrame);
  }, []);
  return <WorkspaceDialog open onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DialogSurface className="message-attachments-dialog" aria-label="Отправка вложений" onPaste={event => {
      const files = Array.from(event.clipboardData.files);
      if (files.length) { event.preventDefault(); onFiles(files); }
    }} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault(); }} onDrop={event => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault(); event.stopPropagation();
      if (Array.from(event.dataTransfer.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) { setDropError("Добавьте отдельные файлы: папки не поддерживаются."); return; }
      setDropError(""); onFiles(Array.from(event.dataTransfer.files));
    }} onKeyDown={event => {
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.target !== captionRef.current && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat && !blockedReason && files.length) onSend();
    }}><DialogBody>
      <DialogTitle action={<Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть отправку вложений" onClick={onClose} />}>
        {photos ? `Выбрано фото: ${files.length}` : `Выбрано файлов: ${files.length}`}
      </DialogTitle>
      <DialogContent>
        <div className="attachment-selection-scroll">
          {photos ? <SelectedPhotos files={files} onRemove={onRemove} /> : <PendingMessageFiles files={files} disabled={Boolean(blockedReason)} onRemove={onRemove} />}
        </div>
        <p className="attachment-original-note">Оригиналы без сжатия</p>
        <label className="attachment-caption-label" htmlFor="attachment-message-caption">Подпись</label>
        <Textarea ref={captionRef} id="attachment-message-caption" aria-label="Подпись к вложениям" value={caption} maxLength={20000} resize="vertical" onChange={(_, data) => onCaption(data.value)} />
        {blockedReason && <WorkspaceNotice tone="warning" role="alert">{blockedReason}</WorkspaceNotice>}
        {errorMessage && !blockedReason && <WorkspaceNotice tone="error" role="alert">{errorMessage}</WorkspaceNotice>}
        {dropError && <WorkspaceNotice tone="error" role="alert">{dropError}</WorkspaceNotice>}
      </DialogContent>
      <DialogActions>
        <Button appearance="subtle" icon={<Add20Regular />} disabled={Boolean(blockedReason)} onClick={onAdd}>Добавить</Button>
        <Button appearance="secondary" onClick={onClose}>Вернуться в чат</Button>
        <Button appearance="primary" icon={<Send20Regular />} disabled={Boolean(blockedReason) || !files.length} aria-label="Отправить вложения" onClick={onSend}>Отправить</Button>
      </DialogActions>
    </DialogBody></DialogSurface>
  </WorkspaceDialog>;
}
