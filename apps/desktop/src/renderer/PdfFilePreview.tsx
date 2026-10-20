import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Button, Input } from "@fluentui/react-components";
import { Add20Regular, Subtract20Regular } from "@fluentui/react-icons";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFDocumentLoadingTask, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { SkeletonBlock } from "./LoadingSkeleton";
import { pdfPageScale, pdfPixelRatio, validPdfPageSize, type PdfPageSize, type PdfZoomMode } from "./pdf-preview-layout";

GlobalWorkerOptions.workerSrc = workerUrl;

function PdfPage({ pdf, number, initialSize, frameSize, zoom, active, showText, register, onSize }: {
  readonly pdf: PDFDocumentProxy; readonly number: number; readonly initialSize: PdfPageSize;
  readonly frameSize: PdfPageSize; readonly zoom: PdfZoomMode; readonly active: boolean;
  readonly showText: boolean; readonly register: (node: HTMLElement | null) => void;
  readonly onSize: (number: number, size: PdfPageSize) => void;
}) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const rendering = useRef<RenderTask | undefined>(undefined);
  const [size, setSize] = useState(initialSize);
  const [rendered, setRendered] = useState<{ element: HTMLCanvasElement; key: string }>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState<string>();
  const scale = pdfPageScale(size, frameSize, zoom);
  const renderKey = `${scale}:${attempt}`;
  const ready = rendered?.element === canvas && rendered?.key === renderKey;
  useEffect(() => {
    if (!active || !canvas) return;
    let live = true;
    let task: RenderTask | undefined;
    const element = canvas;
    void pdf.getPage(number).then(async page => {
      await rendering.current?.promise.catch(() => undefined);
      if (!live || !element) return;
      const base = page.getViewport({ scale: 1 });
      if (!validPdfPageSize(base)) throw new Error("PDF page dimensions exceed preview limits");
      onSize(number, { width: base.width, height: base.height });
      if (base.width !== size.width || base.height !== size.height) {
        setSize({ width: base.width, height: base.height });
        page.cleanup();
        return; // Fit mixed portrait/landscape pages before rendering.
      }
      const viewport = page.getViewport({ scale });
      const ratio = pdfPixelRatio(viewport, window.devicePixelRatio);
      // Render offscreen so a zoom/resize never clears the visible page first.
      const nextCanvas = window.document.createElement("canvas");
      nextCanvas.width = Math.max(1, Math.floor(viewport.width * ratio));
      nextCanvas.height = Math.max(1, Math.floor(viewport.height * ratio));
      const context = nextCanvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      task = page.render({ canvas: nextCanvas, canvasContext: context, viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      rendering.current = task;
      try {
        await task.promise;
        if (live) {
          element.width = nextCanvas.width;
          element.height = nextCanvas.height;
          element.getContext("2d")?.drawImage(nextCanvas, 0, 0);
          setRendered({ element, key: renderKey }); setError("");
        }
      } finally { nextCanvas.width = 0; nextCanvas.height = 0; page.cleanup(); }
    }).catch(reason => {
      if (live && !(reason instanceof Error && reason.name === "RenderingCancelledException")) {
        setError("Не удалось отобразить страницу");
      }
    });
    return () => {
      live = false;
      task?.cancel();
      void (task?.promise ?? Promise.resolve()).catch(() => undefined).then(() => {
        // A detached canvas can remain referenced by the render state/task.
        // Release its bitmap after cancellation, not just its DOM node.
        if (!element.isConnected) { element.width = 0; element.height = 0; }
      });
    };
  }, [pdf, number, active, canvas, size.width, size.height, scale, renderKey, onSize]);
  useEffect(() => {
    if (!showText) return;
    let live = true;
    void pdf.getPage(number).then(page => page.getTextContent()).then(content => {
      if (live) setText(content.items.map(item => "str" in item ? item.str : "").join(" "));
    }).catch(() => { if (live) setText("Не удалось прочитать текстовый слой. Попробуйте открыть оригинал."); });
    return () => { live = false; };
  }, [pdf, number, showText]);
  const busy = active && rendered?.element !== canvas && !error;
  return <div ref={register} className="file-viewer-pdf-sheet" data-page={number}
    style={{ width: size.width * scale }} role="group" aria-label={`Страница ${number}`}>
    <div className="file-viewer-pdf-paper" style={{ height: size.height * scale }} aria-busy={active && !ready && !error}>
      {active && <canvas ref={setCanvas} role="img"
        aria-label={`Страница ${number} PDF. Текст доступен кнопкой «Текст страницы».`}
        style={{ visibility: rendered?.element === canvas && !error ? "visible" : "hidden" }} />}
      {busy && <div className="file-viewer-pdf-page-placeholder" aria-label={`Загружается страница ${number}`}><SkeletonBlock width="100%" height="100%" /></div>}
      {error && active && <div className="file-viewer-pdf-page-error" role="alert">{error}<Button onClick={() => { setError(""); setAttempt(value => value + 1); }}>Повторить страницу {number}</Button></div>}
    </div>
    <span className="file-viewer-pdf-page-number" aria-hidden="true">{number}</span>
    {showText && <section className="file-viewer-pdf-text" aria-label={`Текст страницы ${number}`}><p>{text === undefined ? "Читаем текст страницы…" : text || "Текстового слоя нет — страница может быть сканом."}</p></section>}
  </div>;
}

function useFrameSize(frame: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<PdfPageSize>({ width: 800, height: 600 });
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => {
      if (!node.clientWidth || !node.clientHeight) return;
      setSize(previous => previous.width === node.clientWidth && previous.height === node.clientHeight ? previous
        : { width: node.clientWidth, height: node.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [frame]);
  return size;
}

export default function PdfFilePreview({ blob, onError }: { readonly blob: Blob; readonly onError: (message: string) => void }) {
  const [loaded, setLoaded] = useState<{ blob: Blob; pdf: PDFDocumentProxy; first: PdfPageSize }>();
  const document = loaded?.blob === blob ? loaded.pdf : undefined;
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState<PdfZoomMode>("comfortable");
  const [showText, setShowText] = useState(false);
  const [pageSizes, setPageSizes] = useState<ReadonlyMap<number, PdfPageSize>>(new Map());
  const rememberSize = useCallback((number: number, size: PdfPageSize) => {
    setPageSizes(previous => previous.get(number)?.width === size.width && previous.get(number)?.height === size.height
      ? previous : new Map(previous).set(number, size));
  }, []);
  const frame = useRef<HTMLDivElement>(null);
  const sheets = useRef(new Map<number, HTMLElement>());
  const scrollFrame = useRef<number | undefined>(undefined);
  const zoomFrame = useRef<number | undefined>(undefined);
  const frameSize = useFrameSize(frame);
  useEffect(() => {
    let live = true;
    let task: PDFDocumentLoadingTask | undefined;
    void blob.arrayBuffer().then(async data => {
      if (!live) return;
      task = getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: true });
      const pdf = await task.promise;
      const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
      if (!validPdfPageSize(first)) throw new Error("Invalid page dimensions");
      if (live) {
        setLoaded({ blob, pdf, first: { width: first.width, height: first.height } });
        setPageSizes(new Map([[1, { width: first.width, height: first.height }]]));
        setPage(1); setPageInput("1"); setZoom("comfortable"); setShowText(false);
        if (frame.current) frame.current.scrollTop = 0;
      }
    }).catch(reason => { if (live) onError(reason instanceof Error && reason.name === "PasswordException"
      ? "Документ защищён паролем. Скачайте оригинал для открытия."
      : "Не удалось прочитать PDF. Скачайте оригинал или повторите загрузку."); });
    return () => { live = false; void task?.destroy().catch(() => undefined); };
  }, [blob, onError]);
  useEffect(() => () => {
    if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
    if (zoomFrame.current !== undefined) cancelAnimationFrame(zoomFrame.current);
  }, []);
  const updateCurrentPage = () => {
    if (scrollFrame.current !== undefined) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = undefined;
      const node = frame.current;
      if (!node || !document) return;
      const threshold = node.getBoundingClientRect().top + node.clientHeight * .25;
      let low = 1, high = document.numPages, current = 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const sheet = sheets.current.get(middle);
        if (sheet && sheet.getBoundingClientRect().top <= threshold) { current = middle; low = middle + 1; }
        else high = middle - 1;
      }
      setPage(current); setPageInput(String(current));
    });
  };
  const jump = () => {
    const next = Number(pageInput);
    const sheet = sheets.current.get(next), node = frame.current;
    if (!document || !Number.isInteger(next) || !sheet || !node) { setPageInput(String(page)); return; }
    if (zoomFrame.current !== undefined) { cancelAnimationFrame(zoomFrame.current); zoomFrame.current = undefined; }
    node.scrollTop += sheet.getBoundingClientRect().top - node.getBoundingClientRect().top - 12;
    setPage(next); setPageInput(String(next));
  };
  const changeZoom = useCallback((next: PdfZoomMode) => {
    setZoom(next);
    if (zoomFrame.current !== undefined) cancelAnimationFrame(zoomFrame.current);
    // Retain the current sheet, not the old absolute scroll offset.
    zoomFrame.current = requestAnimationFrame(() => {
      zoomFrame.current = undefined;
      const node = frame.current, sheet = sheets.current.get(page);
      if (node && sheet) node.scrollTop += sheet.getBoundingClientRect().top - node.getBoundingClientRect().top - 12;
    });
  }, [page]);
  const scale = loaded ? pdfPageScale(pageSizes.get(page) ?? loaded.first, frameSize, zoom) : 1;
  const wheelScale = useRef(scale);
  useLayoutEffect(() => { wheelScale.current = scale; }, [scale]);
  const hasDocument = Boolean(document);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      // React wheel listeners may be passive; suppress browser zoom only here.
      event.preventDefault(); event.stopPropagation();
      if (!hasDocument || !event.deltaY) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1);
      const next = Math.max(.1, Math.min(3, wheelScale.current * Math.exp(-Math.max(-100, Math.min(100, delta)) * .002)));
      wheelScale.current = next; // Accumulate rapid events before the next React commit.
      changeZoom(next);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [changeZoom, hasDocument]);
  return <div className="file-viewer-pdf-reader">
    <div className="file-viewer-pdf-tools" role="group" aria-label="Просмотр документа">
      <div className="file-viewer-pdf-pagination"><Input type="number" min={1} max={document?.numPages ?? 1}
        value={pageInput} aria-label="Страница PDF" disabled={!document} onChange={(_, data) => setPageInput(data.value)}
        onBlur={jump} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); jump(); } }} />
        <span>из {document?.numPages ?? "…"}</span></div>
      <div className="file-viewer-pdf-zoom">
        <Button appearance="subtle" icon={<Subtract20Regular />} aria-label="Уменьшить PDF" disabled={!document || scale <= .1} onClick={() => changeZoom(Math.max(.1, scale - .15))} />
        <span className="file-viewer-pdf-scale" title="Ctrl + колесо — масштаб документа">{Math.round(scale * 100)}%</span>
        <Button appearance="subtle" icon={<Add20Regular />} aria-label="Увеличить PDF" disabled={!document || scale >= 3} onClick={() => changeZoom(Math.min(3, scale + .15))} />
        <Button appearance="subtle" aria-pressed={zoom === "comfortable"} disabled={!document} onClick={() => changeZoom("comfortable")}>Удобно</Button>
        <Button appearance="subtle" aria-pressed={zoom === "page"} disabled={!document} onClick={() => changeZoom("page")}>Страница целиком</Button>
        <Button appearance="subtle" aria-pressed={zoom === "width"} disabled={!document} onClick={() => changeZoom("width")}>По ширине</Button>
      </div>
      <Button appearance="subtle" aria-pressed={showText} disabled={!document} onClick={() => setShowText(value => !value)}>Текст страницы</Button>
    </div>
    <div ref={frame} className="file-viewer-pdf-page" onScroll={updateCurrentPage} tabIndex={0} role="region" aria-label="Страницы документа" aria-busy={!document}>
      {!document && <div className="file-viewer-pdf-initial" role="status" aria-label="Открываем документ"><SkeletonBlock width="100%" height="100%" /></div>}
      {document && loaded && Array.from({ length: document.numPages }, (_, index) => <PdfPage key={index + 1}
        pdf={document} number={index + 1} initialSize={loaded.first} frameSize={frameSize} zoom={zoom}
        active={Math.abs(index + 1 - page) <= 2} showText={showText && index + 1 === page}
        onSize={rememberSize}
        register={node => { if (node) sheets.current.set(index + 1, node); else sheets.current.delete(index + 1); }} />)}
    </div>
  </div>;
}
