import { useEffect, useRef, useState, type ReactNode } from "react";

import type { WorkspaceAttachment } from "@yuksalish/contracts";
import { Button, Spinner, useRestoreFocusTarget } from "@fluentui/react-components";
import { ArrowDownload24Regular, ArrowExpand24Regular, Attach24Regular, Delete20Regular, Document24Regular, Pause24Filled, Play24Filled } from "@fluentui/react-icons";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { MediaVolumeControl } from "./MediaVolumeControl";
import { WorkspaceFileDropzone } from "./WorkspaceFileDropzone";
import { fileViewerKind } from "./file-viewer-kind";
import "./attachment-thumbnails.css";

interface AttachmentChipsProps {
  readonly attachments: readonly WorkspaceAttachment[];
  readonly onDownload: (attachment: WorkspaceAttachment) => void | Promise<void>;
  readonly onLoad?: (attachment: WorkspaceAttachment, signal?: AbortSignal) => Promise<Blob>;
  readonly canDelete?: (attachment: WorkspaceAttachment) => boolean;
  readonly onDelete?: (attachment: WorkspaceAttachment) => void;
  readonly deleting?: boolean;
}

function ImageAttachment({attachment, onLoad, onOpen}: {
  readonly attachment: WorkspaceAttachment;
  readonly onLoad: (attachment: WorkspaceAttachment, signal?: AbortSignal) => Promise<Blob>;
  readonly onOpen: (attachment: WorkspaceAttachment) => void | Promise<void>;
}) {
  const ref = useRef<HTMLElement>(null);
  const [visibility, setVisibility] = useState({visible:false, epoch:0});
  const [resource, setResource] = useState({epoch:-1, url:"", failed:false});
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      const visible = entries[0]?.isIntersecting === true;
      setVisibility(current => current.visible === visible ? current : {visible, epoch:current.epoch + 1});
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visibility.visible) return;
    let active = true;
    let url = "";
    const controller = new AbortController();
    void onLoad(attachment, controller.signal).then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setResource({epoch:visibility.epoch, url, failed:false});
    }).catch(() => {if (active) setResource({epoch:visibility.epoch, url:"", failed:true});});
    return () => {active = false; controller.abort(); if (url) URL.revokeObjectURL(url);};
  }, [attachment, onLoad, visibility]);
  const shown = visibility.visible && resource.epoch === visibility.epoch;
  return <article ref={ref} className="attachment-media-preview attachment-image-card">
    <button className="attachment-image-thumb" type="button" aria-label={`Открыть изображение: ${attachment.fileName}`} onClick={() => void onOpen(attachment)}>
      {shown && resource.url ? <img src={resource.url} alt={attachment.fileName} onError={() => setResource(current => ({...current, url:"", failed:true}))} /> : <span>{shown && resource.failed ? "Предпросмотр недоступен · открыть файл" : "Изображение · открыть"}</span>}
    </button>
    <button type="button" title={`Открыть ${attachment.fileName}`} onClick={() => void onOpen(attachment)}><Document24Regular /><span>{attachment.fileName}</span><small>{fileSize(attachment.byteSize)}</small></button>
  </article>;
}

function fileSize(value: number): string {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} КБ`;
  return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

function formatMediaTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

const audioExtensions = /\.(?:mp3|m4a|aac|wav|flac|ogg|oga|opus|webm)$/i;

export function isAudioAttachment(attachment: Pick<WorkspaceAttachment, "contentType" | "fileName">): boolean {
  return attachment.contentType.toLowerCase().startsWith("audio/") || audioExtensions.test(attachment.fileName);
}

function synchsafe(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 21) | (bytes[offset + 1]! << 14) | (bytes[offset + 2]! << 7) | bytes[offset + 3]!;
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset]! << 24) >>> 0) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!);
}

function zeroTerminator(bytes: Uint8Array, start: number, wide: boolean): number {
  for (let index = start; index < bytes.length - (wide ? 1 : 0); index += wide ? 2 : 1) {
    if (bytes[index] === 0 && (!wide || bytes[index + 1] === 0)) return index + (wide ? 2 : 1);
  }
  return bytes.length;
}

function blobBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Не удалось прочитать аудиофайл"));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}

export async function embeddedMp3Artwork(blob: Blob): Promise<Blob | null> {
  const bytes = new Uint8Array(await blobBuffer(blob));
  if (bytes.length < 10 || String.fromCharCode(...bytes.slice(0, 3)) !== "ID3") return null;
  const version = bytes[3]!;
  const tagEnd = Math.min(bytes.length, 10 + synchsafe(bytes, 6));
  let offset = 10;
  while (offset + 10 <= tagEnd) {
    const id = String.fromCharCode(...bytes.slice(offset, offset + 4));
    if (!id.trim()) break;
    const size = version === 4 ? synchsafe(bytes, offset + 4) : uint32(bytes, offset + 4);
    const bodyStart = offset + 10;
    const bodyEnd = Math.min(tagEnd, bodyStart + size);
    if (id === "APIC" && bodyEnd > bodyStart + 4) {
      const body = bytes.slice(bodyStart, bodyEnd);
      const encoding = body[0]!;
      const mimeEnd = zeroTerminator(body, 1, false);
      const mime = new TextDecoder("latin1").decode(body.slice(1, Math.max(1, mimeEnd - 1))) || "image/jpeg";
      const descriptionStart = Math.min(body.length, mimeEnd + 1);
      const imageStart = zeroTerminator(body, descriptionStart, encoding === 1 || encoding === 2);
      return imageStart < body.length ? new Blob([body.slice(imageStart)], { type: mime }) : null;
    }
    if (size <= 0) break;
    offset = bodyEnd;
  }
  return null;
}

export function InlineVideoPlayer({ url, fileName }: { readonly url: string; readonly fileName: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  return (
    <div className="attachment-video-player">
      <video
        ref={videoRef}
        src={url}
        preload="metadata"
        aria-label={fileName}
        onClick={togglePlayback}
        onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); }}
      />
      <div className="attachment-video-controls">
        <Button className="media-player-play" appearance="subtle" icon={playing ? <Pause24Filled /> : <Play24Filled />} aria-label={playing ? "Пауза" : "Воспроизвести"} onClick={togglePlayback} />
        <input
          type="range"
          min="0"
          max={Math.max(0.1, duration)}
          step="0.1"
          value={Math.min(currentTime, Math.max(0.1, duration))}
          aria-label="Позиция видео"
          onChange={(event) => {
            const nextTime = Number(event.currentTarget.value);
            if (videoRef.current) videoRef.current.currentTime = nextTime;
            setCurrentTime(nextTime);
          }}
        />
        <span>{formatMediaTime(currentTime)} / {formatMediaTime(duration)}</span>
        <MediaVolumeControl mediaRef={videoRef} />
      </div>
    </div>
  );
}

export function InlineAudioPlayer({ url, blob, fileName, onError }: { readonly url: string; readonly blob: Blob; readonly fileName: string; readonly onError?: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [artworkUrl, setArtworkUrl] = useState("");
  useEffect(() => {
    const audio = audioRef.current;
    return () => { if (audio) {audio.pause(); audio.removeAttribute("src"); audio.load();} };
  }, [url]);
  useEffect(() => {
    let active = true;
    let nextUrl = "";
    void embeddedMp3Artwork(blob).then((artwork) => {
      if (!active || !artwork) return;
      nextUrl = URL.createObjectURL(artwork);
      setArtworkUrl(nextUrl);
    }).catch(() => undefined);
    return () => { active = false; if (nextUrl) URL.revokeObjectURL(nextUrl); };
  }, [blob]);
  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => onError?.());
    else audio.pause();
  };
  return <div className="attachment-audio-player">
    <audio ref={audioRef} src={url} preload="metadata" aria-label={fileName} onError={onError} onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setCurrentTime(0); }} />
    <div className={`attachment-audio-artwork ${artworkUrl ? "has-artwork" : ""}`} aria-hidden="true">{artworkUrl ? <img src={artworkUrl} alt="" /> : <span>♪</span>}</div>
    <div className="attachment-audio-content">
      <strong title={fileName}>{fileName.replace(/\.[^.]+$/, "")}</strong>
      <div className="attachment-audio-controls">
        <Button className="media-player-play" appearance="subtle" icon={playing ? <Pause24Filled /> : <Play24Filled />} aria-label={playing ? "Пауза" : "Воспроизвести"} onClick={togglePlayback} />
        <input type="range" min="0" max={Math.max(0.1, duration)} step="0.1" value={Math.min(currentTime, Math.max(0.1, duration))} aria-label="Позиция аудио" onChange={(event) => { const nextTime = Number(event.currentTarget.value); if (audioRef.current) audioRef.current.currentTime = nextTime; setCurrentTime(nextTime); }} />
        <span>{formatMediaTime(currentTime)} / {formatMediaTime(duration)}</span>
        <MediaVolumeControl mediaRef={audioRef} />
      </div>
    </div>
  </div>;
}

export function AttachmentChips({ attachments, onDownload, onLoad, canDelete, onDelete, deleting }: AttachmentChipsProps) {
  const deleteFocusTarget = useRestoreFocusTarget();
  if (attachments.length === 0) return null;
  return (
    <div className="attachment-chips" aria-label="Вложения">
      {attachments.map((attachment) => {
        const content = onLoad && fileViewerKind(attachment) === "image" ? <ImageAttachment key={attachment.id} attachment={attachment} onLoad={onLoad} onOpen={onDownload} /> : (
        <button
          key={attachment.id}
          type="button"
          title={`${fileViewerKind(attachment) === "unsupported" ? "Скачать" : "Открыть"}: ${attachment.fileName}, ${fileSize(attachment.byteSize)}`}
          onClick={() => void onDownload(attachment)}
        >
          <Document24Regular />
          <span>{attachment.fileName}</span>
          <small>{fileSize(attachment.byteSize)}</small>
          {fileViewerKind(attachment) === "unsupported" ? <ArrowDownload24Regular /> : <ArrowExpand24Regular />}
        </button>
        );
        if (!onDelete) return content;
        return <div className="attachment-file-row" key={attachment.id}>{content}{canDelete?.(attachment) ? <Button {...deleteFocusTarget} className="attachment-remove-button" appearance="subtle"
        icon={<Delete20Regular />} aria-label={`Удалить файл: ${attachment.fileName}`} title="Удалить файл" disabled={deleting}
        onClick={event => { event.currentTarget.focus(); onDelete(attachment); }} /> : null}</div>;
      })}
    </div>
  );
}

interface AttachmentPanelProps extends Omit<AttachmentChipsProps, "onDelete"> {
  readonly onDelete?: (attachment: WorkspaceAttachment) => Promise<void>;
  readonly title?: string;
  readonly canUpload: boolean;
  readonly onUpload: (files: readonly File[]) => void | Promise<void>;
  readonly dropzone?: boolean;
  readonly headingAccessory?: ReactNode;
}

export function AttachmentPanel({
  attachments,
  canUpload,
  onDownload,
  onUpload,
  title = "Вложения",
  dropzone = false,
  headingAccessory,
  canDelete,
  onDelete,
}: AttachmentPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<WorkspaceAttachment>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const remove = async () => {
    if (!pendingDelete || !onDelete || deleting) return;
    setDeleting(true); setDeleteError("");
    try { await onDelete(pendingDelete); setPendingDelete(undefined); }
    catch (cause) { setDeleteError(cause instanceof Error ? cause.message : "Не удалось удалить файл"); setPendingDelete(undefined); }
    finally { setDeleting(false); }
  };

  const upload = async (files: readonly File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      await onUpload(files);
    } finally {
      setBusy(false);
      if (inputRef.current !== null) inputRef.current.value = "";
    }
  };

  return (
    <section ref={panelRef} className={`attachment-panel${dropzone ? " attachment-panel-dropzone" : ""}`}>
      <div className="attachment-panel-heading">
        <h3 ref={headingRef} tabIndex={onDelete ? -1 : undefined}>{title}</h3>
        {headingAccessory}
        {canUpload && !dropzone ? (
          <>
            <input
              ref={inputRef}
              hidden
              type="file"
              multiple
              aria-label={`Добавить файлы: ${title}`}
              onChange={(event) => void upload(Array.from(event.target.files ?? []))}
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
      {canUpload && dropzone ? <WorkspaceFileDropzone
        label={busy ? "Загружаем файлы…" : "Перетащите файлы сюда"}
        hint="Выберите несколько файлов или добавляйте подборками. Количество не ограничено; до 25 МБ на обычный файл."
        actionLabel={busy ? "Загрузка…" : "Выбрать файлы"}
        ariaLabel={`Добавить файлы: ${title}`}
        multiple
        disabled={busy}
        onFiles={(files) => void upload(files)}
      /> : null}
      <AttachmentChips attachments={attachments} onDownload={onDownload} canDelete={canDelete} deleting={deleting || busy}
        onDelete={onDelete ? attachment => { setDeleteError(""); setPendingDelete(attachment); } : undefined} />
      {deleteError ? <p className="auth-error" role="alert">{deleteError}</p> : null}
      <ConfirmActionDialog open={!!pendingDelete} title="Удалить файл?"
        message={`Файл «${pendingDelete?.fileName ?? ""}» исчезнет из вложений задачи.`} busy={deleting}
        onCancel={() => setPendingDelete(undefined)} onConfirm={remove}
        onExited={() => {
          // A successfully removed file no longer provides a return-focus button.
          if (!panelRef.current?.contains(document.activeElement)) headingRef.current?.focus({ preventScroll: true });
        }} />
      {attachments.length === 0 && (!dropzone || !canUpload) ? <p className="attachment-empty">Файлов пока нет</p> : null}
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
