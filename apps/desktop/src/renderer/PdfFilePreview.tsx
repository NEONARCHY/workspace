import { useEffect, useRef, useState } from "react";
import { Button, Input, Spinner } from "@fluentui/react-components";
import { Add20Regular, Subtract20Regular, ArrowLeft20Regular, ArrowRight20Regular } from "@fluentui/react-icons";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFDocumentLoadingTask, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfFilePreview({ blob, onError }: {readonly blob: Blob; readonly onError: (message: string) => void}) {
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [renderedKey, setRenderedKey] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const rendering = useRef<RenderTask | undefined>(undefined);
  const [pageText, setPageText] = useState("");
  const [showText, setShowText] = useState(false);
  const renderKey = `${page}:${zoom}`;
  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    void blob.arrayBuffer().then(async data => {
      if (!active) return;
      task = getDocument({data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: true});
      const pdf = await task.promise;
      if (active) setDocument(pdf);
    }).catch(reason => { if (active) onError(reason instanceof Error && reason.name === "PasswordException"
      ? "Документ защищён паролем. Скачайте оригинал для открытия."
      : "Не удалось прочитать PDF. Скачайте оригинал или повторите загрузку."); });
    return () => { active = false; void task?.destroy().catch(() => undefined); };
  }, [blob, onError]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let active = true;
    let render: RenderTask | undefined;
    void document.getPage(page).then(async pdfPage => {
      await rendering.current?.promise.catch(() => undefined);
      if (!active || !canvas.current) return;
      const base = pdfPage.getViewport({scale: 1});
      if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width <= 0 || base.height <= 0
        || Math.max(base.width, base.height) > 20_000 || Math.max(base.width / base.height, base.height / base.width) > 100) {
        throw new Error("PDF page dimensions exceed preview limits");
      }
      const available = Math.max(240, (frame.current?.clientWidth ?? 800) - 40);
      const scale = Math.min(1.6, available / base.width) * zoom;
      const viewport = pdfPage.getViewport({scale});
      const ratio = Math.min(2, window.devicePixelRatio || 1,
        Math.sqrt(8_000_000 / (viewport.width * viewport.height)), 8192 / Math.max(viewport.width, viewport.height));
      const element = canvas.current;
      element.width = Math.max(1, Math.floor(viewport.width * ratio));
      element.height = Math.max(1, Math.floor(viewport.height * ratio));
      element.style.width = `${viewport.width}px`;
      element.style.height = `${viewport.height}px`;
      const context = element.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      render = pdfPage.render({canvas: element, canvasContext: context, viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]});
      rendering.current = render;
      await render.promise;
      const text = await pdfPage.getTextContent();
      if (active) {
        setPageText(text.items.map(item => "str" in item ? item.str : "").join(" "));
        setRenderedKey(renderKey);
      }
      pdfPage.cleanup();
    }).catch(reason => { if (active && !(reason instanceof Error && reason.name === "RenderingCancelledException")) onError("Не удалось отобразить страницу PDF"); });
    return () => { active = false; render?.cancel(); };
  }, [document, page, zoom, renderKey, onError]);
  const total = document?.numPages ?? 0;
  const busy = !document || renderedKey !== renderKey;
  return <div className="file-viewer-pdf-reader">
    <div className="file-viewer-pdf-tools">
      <Button appearance="subtle" icon={<ArrowLeft20Regular />} aria-label="Предыдущая страница PDF" disabled={page <= 1 || !document} onClick={() => setPage(value => value - 1)} />
      <Input type="number" min={1} max={total || 1} value={String(page)} aria-label="Страница PDF" onChange={(_, data) => {const next = Number(data.value); if (Number.isInteger(next) && next >= 1 && next <= total) setPage(next);}} />
      <span>из {total || "…"}</span>
      <Button appearance="subtle" icon={<ArrowRight20Regular />} aria-label="Следующая страница PDF" disabled={!document || page >= total} onClick={() => setPage(value => value + 1)} />
      <Button appearance="subtle" icon={<Subtract20Regular />} aria-label="Уменьшить PDF" disabled={zoom <= .5} onClick={() => setZoom(value => Math.max(.5, value - .25))} />
      <Button appearance="subtle" aria-label="Сбросить масштаб PDF" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</Button>
      <Button appearance="subtle" icon={<Add20Regular />} aria-label="Увеличить PDF" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + .25))} />
      <Button appearance="subtle" aria-pressed={showText} onClick={() => setShowText(value => !value)}>Текст страницы</Button>
    </div>
    <div ref={frame} className="file-viewer-pdf-page" aria-busy={busy}>
      {busy && <div className="file-viewer-pdf-loading" role="status"><Spinner size="small" label="Открываем страницу…" /></div>}
      <canvas ref={canvas} role="img" aria-label={`Страница ${page} PDF. Текст доступен кнопкой «Текст страницы».`} />
      {showText && !busy && <section className="file-viewer-pdf-text" aria-label={`Текст страницы ${page}`}><p>{pageText || "Текстового слоя нет — страница может быть сканом."}</p></section>}
    </div>
  </div>;
}
