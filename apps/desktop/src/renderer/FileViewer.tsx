import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner } from "@fluentui/react-components";
import { Input } from "./WorkspaceInput";
import { ArrowDownload20Regular, Dismiss20Regular, Add20Regular, Subtract20Regular, ArrowLeft20Regular, ArrowRight20Regular } from "@fluentui/react-icons";
import type { OfficeFilePreview, WorkspaceAttachment } from "@yuksalish/contracts";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { fileViewerKind } from "./file-viewer-kind";
import type { OfficePreviewResult } from "./file-viewer-kind";
import { InlineAudioPlayer } from "./AttachmentPanel";
import { LoadingSkeleton } from "./LoadingSkeleton";
import "./file-viewer.css";
import ImageLightbox from "./ImageLightbox";
import type { GalleryImage } from "./image-gallery";
const PdfFilePreview = lazy(() => import("./PdfFilePreview"));

export type FileViewerSource = Pick<WorkspaceAttachment, "id" | "fileName" | "contentType" | "byteSize">;
interface Props<T extends FileViewerSource> {
  readonly attachment: T;
  readonly onClose: () => void;
  readonly onLoad: (attachment: T, signal?: AbortSignal) => Promise<Blob>;
  readonly onLoadOffice: (attachment: T, sheet: number, offset: number, signal?: AbortSignal) => Promise<OfficePreviewResult>;
  readonly onDownload: (attachment: T) => void | Promise<void>;
  readonly images?: readonly GalleryImage<T>[];
  readonly onGoToMessage?: (image: GalleryImage<T>) => void;
  readonly onForward?: (image: GalleryImage<T>) => void;
}

export default function WorkspaceFileViewer(props: Props<WorkspaceAttachment>) {
  return fileViewerKind(props.attachment) === "image" ? <ImageLightbox {...props} /> : <FileViewer {...props} />;
}

/** External sources keep their own authorized routes and do not impersonate Workspace attachments. */
export function ExternalFileViewer(props: Props<FileViewerSource>) {
  return fileViewerKind(props.attachment) === "image" ? <ImageLightbox {...props} /> : <FileViewer {...props} />;
}

export function LocalFileViewer({ file, files, onClose, onLoadOffice }: {
  readonly file: File;
  readonly files?: readonly File[];
  readonly onClose: () => void;
  readonly onLoadOffice: (file: File, sheet: number, offset: number, signal?: AbortSignal) => Promise<OfficePreviewResult>;
}) {
  const source = useMemo<FileViewerSource & { readonly file: File }>(() => ({
    id: `local:${file.name}:${file.size}:${file.lastModified}`,
    fileName: file.name, contentType: file.type, byteSize: file.size, file,
  }), [file]);
  const images = useMemo(() => (files ?? [file]).map((entry) => ({ attachment: {
    id: `local:${entry.name}:${entry.size}:${entry.lastModified}`, fileName: entry.name, contentType: entry.type, byteSize: entry.size, file: entry,
  } })).filter((item) => fileViewerKind(item.attachment) === "image"), [files, file]);
  const load = useCallback(async (entry: FileViewerSource & { readonly file: File }, signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return entry.file;
  }, []);
  const loadOffice = useCallback((_source: FileViewerSource, sheet: number, offset: number, signal?: AbortSignal) =>
    onLoadOffice(file, sheet, offset, signal), [file, onLoadOffice]);
  const download = useCallback((entry: FileViewerSource & { readonly file: File }) => {
    const url = URL.createObjectURL(entry.file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = entry.fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, []);
  return fileViewerKind(source) === "image" ? <ImageLightbox attachment={source} images={images} onClose={onClose} onLoad={load} onDownload={download} />
    : <FileViewer attachment={source} onClose={onClose} onLoad={load} onLoadOffice={loadOffice} onDownload={download} />;
}

function FileViewer<T extends FileViewerSource>({ attachment, onClose, onLoad, onLoadOffice, onDownload }: Props<T>) {
  const kind = fileViewerKind(attachment);
  const [url, setUrl] = useState("");
  const [mediaBlob, setMediaBlob] = useState<Blob>();
  const wordPdf = kind === "word" && mediaBlob?.type === "application/pdf";
  const [office, setOffice] = useState<OfficeFilePreview>();
  const [error, setError] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [sheet, setSheet] = useState(0);
  const [offset, setOffset] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const matches = (text: string) => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const visibleBlocks = office?.blocks.filter(block => matches(block.text) || block.rows.some(row => row.some(matches))) ?? [];
  const visibleRows = office?.rows.map((row, index) => ({row, index})).filter(({row}) => row.some(matches)) ?? [];
  const videoRef = useRef<HTMLVideoElement>(null);
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
        if (active) {
          if (result instanceof Blob) { setMediaBlob(result); setOffice(undefined); }
          else { setOffice(result); setMediaBlob(undefined); }
          setError("");
        }
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
      <header className="file-viewer-header"><div className="file-viewer-heading"><DialogTitle>
        <span className="file-viewer-title" title={attachment.fileName}>{attachment.fileName}</span>
      </DialogTitle><span className="file-viewer-file-meta">{kind === "unsupported" ? "Файл" : {word:"Word",excel:"Excel",pdf:"PDF",image:"Изображение",video:"Видео",audio:"Аудио"}[kind]}{size ? ` · ${size}` : ""}</span></div>
        <div className="file-viewer-tools"><Button appearance="subtle" icon={<ArrowDownload20Regular />} disabled={saving} onClick={() => void download()}>Скачать</Button><Button className="file-viewer-close" appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть просмотрщик" onClick={onClose} /></div></header>
      {office?.kind === "word" && !busy && <div className="file-viewer-toolbar" aria-label="Масштаб текстового просмотра Word">
        <span>Текстовый просмотр</span><div className="file-viewer-tools">
            <Button appearance="subtle" icon={<Subtract20Regular />} aria-label="Уменьшить" disabled={zoom <= .5} onClick={() => setZoom(value => Math.max(.5, value - .25))} />
            <Button appearance="subtle" aria-label="Сбросить масштаб" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</Button>
            <Button appearance="subtle" icon={<Add20Regular />} aria-label="Увеличить" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + .25))} />
        </div>
      </div>}
      {((office?.kind === "word" && !busy) || kind === "excel") && <Input className="file-viewer-search" value={query}
        aria-label={kind === "word" ? "Поиск в документе" : "Поиск на текущей странице листа"}
        placeholder={kind === "word" ? "Найти в содержимом документа…" : "Найти в загруженных строках…"}
        onChange={(_, data) => setQuery(data.value)} />}
      {office?.kind === "excel" && <nav className="file-viewer-sheets" aria-label="Листы Excel">{office.sheets.map((name, index) => <Button key={index} appearance={index === sheet ? "primary" : "subtle"} aria-pressed={index === sheet} onClick={() => { setSheet(index); setOffset(0); }}>{name}</Button>)}</nav>}
      <DialogContent className={`file-viewer-content file-viewer-${wordPdf ? "pdf" : kind}`} aria-busy={busy}>
        {busy ? <div className="file-viewer-state" role="status"><Spinner size="small" /><strong>Открываем файл…</strong><span>Загружается только выбранное вложение</span></div> : error ? <div className="file-viewer-state" role="alert"><strong>Не удалось открыть файл</strong><p>{error}</p><Button onClick={() => setAttempt(value => value + 1)}>Повторить</Button></div> : <>
          {mediaBlob && (kind === "pdf" || wordPdf) && <Suspense fallback={<LoadingSkeleton layout="form" rows={5} label="Открываем документ…" />}><PdfFilePreview blob={mediaBlob} onError={setError} /></Suspense>}
          {url && kind === "video" && <video ref={videoRef} src={url} controls playsInline preload="metadata" aria-label={attachment.fileName} onError={() => setError("Видеоформат не поддерживается браузером. Скачайте оригинал.")} />}
          {url && mediaBlob && kind === "audio" && <div className="file-viewer-audio-stage"><div className="file-viewer-audio-art" aria-hidden="true">♪</div><InlineAudioPlayer url={url} blob={mediaBlob} fileName={attachment.fileName} onError={() => setError("Аудиоформат не поддерживается браузером. Скачайте оригинал.")} /></div>}
          {office?.kind === "word" && <article className="file-viewer-document" style={{ fontSize: `${zoom}em` }} aria-label="Содержимое Word">{visibleBlocks.map((block, index) => block.kind === "paragraph" ? <p key={index}>{block.text || "\u00a0"}</p> : <table key={index}><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>)}{!visibleBlocks.length && <p role="status">{query.trim() ? "Совпадений не найдено" : "В документе нет текстового содержимого"}</p>}</article>}
          {office?.kind === "excel" && <><table className="file-viewer-grid" aria-label={`Лист ${office.sheets[sheet]}`}><thead><tr><th scope="col">№</th>{Array.from({length: Math.max(0, ...office.rows.map(row => row.length))}, (_, index) => <th scope="col" key={index}>{columnName(index)}</th>)}</tr></thead><tbody>{visibleRows.map(({row, index}) => <tr key={offset + index}><th scope="row">{offset + index + 1}</th>{row.map((cell, col) => <td key={col}>{cell}</td>)}</tr>)}</tbody></table>{!visibleRows.length && <p role="status">{query.trim() ? "В загруженных строках совпадений нет" : "Лист пуст"}</p>}</>}
          {kind === "unsupported" && <div className="file-viewer-state"><strong>Просмотр этого формата недоступен</strong><p>Для Word и Excel используйте DOCX и XLSX. Можно скачать исходный файл.</p></div>}
        </>}
      </DialogContent>
      <footer className="file-viewer-footer"><span>{wordPdf ? "Страничный просмотр Word · оригинал не изменяется · возможна замена отсутствующих шрифтов" : office?.truncated ? "Показана часть содержимого. Полная версия — в оригинале." : kind === "word" || kind === "excel" ? "Упрощённый режим чтения · оформление может отличаться от оригинала" : "Режим просмотра · оригинал не изменяется"}</span>
        {office?.kind === "excel" && <div><Button appearance="subtle" icon={<ArrowLeft20Regular />} aria-label="Предыдущие строки" disabled={offset === 0 || busy} onClick={() => setOffset(value => Math.max(0, value - 200))} /><span>{office.rows.length ? `${offset + 1}–${offset + office.rows.length}` : "0"} из {office.totalRows}</span><Button appearance="subtle" icon={<ArrowRight20Regular />} aria-label="Следующие строки" disabled={offset + 200 >= office.totalRows || busy} onClick={() => setOffset(value => value + 200)} /></div>}
      </footer>
    </DialogBody></DialogSurface>
  </WorkspaceDialog>;
}
