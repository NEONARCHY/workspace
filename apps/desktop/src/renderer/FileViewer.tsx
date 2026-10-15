import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner } from "@fluentui/react-components";
import { Input } from "./WorkspaceInput";
import { ArrowDownload20Regular, Dismiss20Regular, Add20Regular, Subtract20Regular, ArrowLeft20Regular, ArrowRight20Regular, ArrowClockwise20Regular } from "@fluentui/react-icons";
import type { OfficeFilePreview, WorkspaceAttachment } from "@yuksalish/contracts";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { fileViewerKind } from "./file-viewer-kind";
import { InlineAudioPlayer } from "./AttachmentPanel";
import "./file-viewer.css";
const PdfFilePreview = lazy(() => import("./PdfFilePreview"));

export type FileViewerSource = Pick<WorkspaceAttachment, "id" | "fileName" | "contentType" | "byteSize">;
interface Props<T extends FileViewerSource> {
  readonly attachment: T;
  readonly onClose: () => void;
  readonly onLoad: (attachment: T, signal?: AbortSignal) => Promise<Blob>;
  readonly onLoadOffice: (attachment: T, sheet: number, offset: number, signal?: AbortSignal) => Promise<OfficeFilePreview>;
  readonly onDownload: (attachment: T) => void | Promise<void>;
}

export default function WorkspaceFileViewer(props: Props<WorkspaceAttachment>) {
  return <FileViewer {...props} />;
}

/** External sources keep their own authorized routes and do not impersonate Workspace attachments. */
export function ExternalFileViewer(props: Props<FileViewerSource>) {
  return <FileViewer {...props} />;
}

export function LocalFileViewer({ file, onClose, onLoadOffice }: {
  readonly file: File;
  readonly onClose: () => void;
  readonly onLoadOffice: (file: File, sheet: number, offset: number, signal?: AbortSignal) => Promise<OfficeFilePreview>;
}) {
  const source = useMemo<FileViewerSource>(() => ({
    id: `local:${file.name}:${file.size}:${file.lastModified}`,
    fileName: file.name, contentType: file.type, byteSize: file.size,
  }), [file]);
  const load = useCallback(async (_source: FileViewerSource, signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return file;
  }, [file]);
  const loadOffice = useCallback((_source: FileViewerSource, sheet: number, offset: number, signal?: AbortSignal) =>
    onLoadOffice(file, sheet, offset, signal), [file, onLoadOffice]);
  const download = useCallback(() => {
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [file]);
  return <FileViewer attachment={source} onClose={onClose} onLoad={load} onLoadOffice={loadOffice} onDownload={download} />;
}

function FileViewer<T extends FileViewerSource>({ attachment, onClose, onLoad, onLoadOffice, onDownload }: Props<T>) {
  const kind = fileViewerKind(attachment);
  const [url, setUrl] = useState("");
  const [mediaBlob, setMediaBlob] = useState<Blob>();
  const [office, setOffice] = useState<OfficeFilePreview>();
  const [error, setError] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [sheet, setSheet] = useState(0);
  const [offset, setOffset] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotated, setRotated] = useState(0);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const matches = (text: string) => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const visibleBlocks = office?.blocks.filter(block => matches(block.text) || block.rows.some(row => row.some(matches))) ?? [];
  const visibleRows = office?.rows.map((row, index) => ({row, index})).filter(({row}) => row.some(matches)) ?? [];
  const contentRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [imageNatural, setImageNatural] = useState<{width: number; height: number}>();
  const [imageFit, setImageFit] = useState<{width: number; height: number}>();
  const requestKey = `${attachment.id}:${sheet}:${offset}:${attempt}`;
  const busy = loadedKey !== requestKey;
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const controller = new AbortController();
    const load = async () => {
      if (kind === "unsupported") return;
      if (kind === "word" || kind === "excel") {
        const result = await onLoadOffice(attachment, sheet, offset, controller.signal);
        if (active) { setOffice(result); setError(""); }
      } else {
        const blob = await onLoad(attachment, controller.signal);
        if (!active) return;
        objectUrl = kind === "pdf" ? "" : URL.createObjectURL(blob);
        setMediaBlob(blob);
        setUrl(objectUrl);
        setError("");
      }
    };
    void load().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Не удалось открыть файл"); })
      .finally(() => { if (active) setLoadedKey(requestKey); });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment, kind, onLoad, onLoadOffice, sheet, offset, attempt, requestKey]);
  useEffect(() => {
    const container = contentRef.current;
    if (!container || !imageNatural) return;
    const update = () => {
      const ratio = Math.min(1, Math.max(100, container.clientWidth - 104) / imageNatural.width,
        Math.max(100, container.clientHeight - 104) / imageNatural.height);
      setImageFit({width: imageNatural.width * ratio, height: imageNatural.height * ratio});
    };
    const frame = window.requestAnimationFrame(update);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(container);
    return () => { window.cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [imageNatural]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    return () => { video.pause(); video.removeAttribute("src"); video.load(); };
  }, [url]);

  const download = async () => {
    setSaving(true);
    try { await onDownload(attachment); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось скачать файл"); }
    finally { setSaving(false); }
  };
  const size = attachment.byteSize > 0
    ? attachment.byteSize < 1024 * 1024 ? `${Math.ceil(attachment.byteSize / 1024)} КБ` : `${(attachment.byteSize / 1024 / 1024).toFixed(1)} МБ`
    : "";
  const columnName = (index: number): string => {
    let name = "";
    for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) name = String.fromCharCode(65 + (number - 1) % 26) + name;
    return name;
  };
  return <WorkspaceDialog open onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DialogSurface className="file-viewer-surface"><DialogBody>
      <header className="file-viewer-header"><DialogTitle>
        <span className="file-viewer-title" title={attachment.fileName}>{attachment.fileName}</span>
      </DialogTitle><Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть просмотрщик" onClick={onClose} /></header>
      <div className="file-viewer-toolbar">
        <span>{kind === "unsupported" ? "Файл" : {word:"Word",excel:"Excel",pdf:"PDF",image:"Изображение",video:"Видео",audio:"Аудио"}[kind]}{size ? ` · ${size}` : ""}</span>
        <div className="file-viewer-tools">
          {(kind === "image" || kind === "word") && <>
            <Button appearance="subtle" icon={<Subtract20Regular />} aria-label="Уменьшить" disabled={zoom <= .5} onClick={() => setZoom(value => Math.max(.5, value - .25))} />
            <Button appearance="subtle" aria-label="Сбросить масштаб" onClick={() => { setZoom(1); setRotated(0); }}>{Math.round(zoom * 100)}%</Button>
            <Button appearance="subtle" icon={<Add20Regular />} aria-label="Увеличить" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + .25))} />
            {kind === "image" && <Button appearance="subtle" icon={<ArrowClockwise20Regular />} aria-label="Повернуть изображение" onClick={() => setRotated(value => (value + 90) % 360)} />}
          </>}
          <Button appearance="subtle" icon={<ArrowDownload20Regular />} disabled={saving} onClick={() => void download()}>Скачать</Button>
        </div>
      </div>
      {(kind === "word" || kind === "excel") && <Input className="file-viewer-search" value={query}
        aria-label={kind === "word" ? "Поиск в документе" : "Поиск на текущей странице листа"}
        placeholder={kind === "word" ? "Найти в содержимом документа…" : "Найти в загруженных строках…"}
        onChange={(_, data) => setQuery(data.value)} />}
      {office?.kind === "excel" && <nav className="file-viewer-sheets" aria-label="Листы Excel">{office.sheets.map((name, index) => <Button key={index} appearance={index === sheet ? "primary" : "subtle"} aria-pressed={index === sheet} onClick={() => { setSheet(index); setOffset(0); }}>{name}</Button>)}</nav>}
      <DialogContent ref={contentRef} className={`file-viewer-content file-viewer-${kind}`} aria-busy={busy}>
        {busy ? <div className="file-viewer-state" role="status"><Spinner size="small" /><strong>Открываем файл…</strong><span>Загружается только выбранное вложение</span></div> : error ? <div className="file-viewer-state" role="alert"><strong>Не удалось открыть файл</strong><p>{error}</p><Button onClick={() => setAttempt(value => value + 1)}>Повторить</Button></div> : <>
          {url && kind === "image" && <div className="file-viewer-image-stage"><div className="file-viewer-image-size" style={imageFit ? {width: (rotated % 180 ? imageFit.height : imageFit.width) * zoom, height: (rotated % 180 ? imageFit.width : imageFit.height) * zoom} : undefined}><img src={url} alt={attachment.fileName}
            className={imageFit ? "fitted" : undefined} style={imageFit ? {width: imageFit.width, height: imageFit.height, transform: `translate(-50%, -50%) rotate(${rotated}deg) scale(${zoom})`} : undefined}
            onLoad={event => setImageNatural({width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight})}
            onError={() => setError("Браузер не поддерживает это изображение. Можно скачать оригинал.")} /></div></div>}
          {mediaBlob && kind === "pdf" && <Suspense fallback={<Spinner label="Открываем PDF…" />}><PdfFilePreview blob={mediaBlob} onError={setError} /></Suspense>}
          {url && kind === "video" && <video ref={videoRef} src={url} controls playsInline preload="metadata" aria-label={attachment.fileName} onError={() => setError("Видеоформат не поддерживается браузером. Скачайте оригинал.")} />}
          {url && mediaBlob && kind === "audio" && <div className="file-viewer-audio-stage"><div className="file-viewer-audio-art" aria-hidden="true">♪</div><InlineAudioPlayer url={url} blob={mediaBlob} fileName={attachment.fileName} onError={() => setError("Аудиоформат не поддерживается браузером. Скачайте оригинал.")} /></div>}
          {office?.kind === "word" && <article className="file-viewer-document" style={{ fontSize: `${zoom}em` }} aria-label="Содержимое Word">{visibleBlocks.map((block, index) => block.kind === "paragraph" ? <p key={index}>{block.text || "\u00a0"}</p> : <table key={index}><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>)}{!visibleBlocks.length && <p role="status">{query.trim() ? "Совпадений не найдено" : "В документе нет текстового содержимого"}</p>}</article>}
          {office?.kind === "excel" && <><table className="file-viewer-grid" aria-label={`Лист ${office.sheets[sheet]}`}><thead><tr><th scope="col">№</th>{Array.from({length: Math.max(0, ...office.rows.map(row => row.length))}, (_, index) => <th scope="col" key={index}>{columnName(index)}</th>)}</tr></thead><tbody>{visibleRows.map(({row, index}) => <tr key={offset + index}><th scope="row">{offset + index + 1}</th>{row.map((cell, col) => <td key={col}>{cell}</td>)}</tr>)}</tbody></table>{!visibleRows.length && <p role="status">{query.trim() ? "В загруженных строках совпадений нет" : "Лист пуст"}</p>}</>}
          {kind === "unsupported" && <div className="file-viewer-state"><strong>Просмотр этого формата недоступен</strong><p>Для Word и Excel используйте DOCX и XLSX. Можно скачать исходный файл.</p></div>}
        </>}
      </DialogContent>
      <footer className="file-viewer-footer"><span>{office?.truncated ? "Показана часть содержимого. Полная версия — в оригинале." : kind === "word" || kind === "excel" ? "Режим чтения · оформление может отличаться от оригинала" : "Режим просмотра · оригинал не изменяется"}</span>
        {office?.kind === "excel" && <div><Button appearance="subtle" icon={<ArrowLeft20Regular />} aria-label="Предыдущие строки" disabled={offset === 0 || busy} onClick={() => setOffset(value => Math.max(0, value - 200))} /><span>{office.rows.length ? `${offset + 1}–${offset + office.rows.length}` : "0"} из {office.totalRows}</span><Button appearance="subtle" icon={<ArrowRight20Regular />} aria-label="Следующие строки" disabled={offset + 200 >= office.totalRows || busy} onClick={() => setOffset(value => value + 200)} /></div>}
      </footer>
    </DialogBody></DialogSurface>
  </WorkspaceDialog>;
}
