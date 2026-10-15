import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, DialogSurface, DialogTitle, Spinner } from "@fluentui/react-components";
import { ChevronLeft, ChevronRight, Copy, Download, Grid2X2, Minus, MoreHorizontal, Plus, RotateCw, X, Forward, Eye } from "lucide-react";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { MessageContextMenu } from "./MessageContextMenu";
import type { GalleryImage } from "./image-gallery";
import "./image-lightbox.css";

export interface ImageSource { readonly id: string; readonly fileName: string; readonly contentType: string; readonly byteSize: number }
interface Props<T extends ImageSource> {
  readonly attachment: T;
  readonly images?: readonly GalleryImage<T>[];
  readonly onLoad: (attachment: T, signal?: AbortSignal) => Promise<Blob>;
  readonly onDownload: (attachment: T) => void | Promise<void>;
  readonly onClose: () => void;
  readonly onGoToMessage?: (image: GalleryImage<T>) => void;
  readonly onForward?: (image: GalleryImage<T>) => void;
}
function useImage<T extends ImageSource>(attachment: T, onLoad: Props<T>["onLoad"], attempt = 0) {
  const [state, setState] = useState<{ id: string; url: string; error: string }>({ id: "", url: "", error: "" });
  useEffect(() => {
    const controller = new AbortController(); let active = true; let url = "";
    void onLoad(attachment, controller.signal).then((blob) => {
      if (!active) return;
      url = URL.createObjectURL(blob); setState({ id: attachment.id, url, error: "" });
    }).catch((cause) => { if (active) setState({ id: attachment.id, url: "", error: cause instanceof Error ? cause.message : "Не удалось загрузить изображение" }); });
    return () => { active = false; controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [attachment, onLoad, attempt]);
  return state.id === attachment.id ? state : { id: attachment.id, url: "", error: "" };
}
function GalleryThumbnail<T extends ImageSource>({ item, onLoad, onSelect, selected }: {
  readonly item: GalleryImage<T>; readonly onLoad: Props<T>["onLoad"]; readonly onSelect: () => void; readonly selected: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false));
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  return <button ref={ref} type="button" aria-label={`Открыть фото: ${item.attachment.fileName}`} aria-pressed={selected} onClick={onSelect}>
    {visible ? <ThumbnailImage attachment={item.attachment} onLoad={onLoad} /> : <span>{item.attachment.fileName}</span>}
  </button>;
}
function ThumbnailImage<T extends ImageSource>({ attachment, onLoad }: { readonly attachment: T; readonly onLoad: Props<T>["onLoad"] }) {
  const state = useImage(attachment, onLoad);
  return state.url ? <img src={state.url} alt="" /> : <span>{state.error ? "Не загружено" : "…"}</span>;
}

function DelayedImageLoading() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 400);
    return () => window.clearTimeout(timer);
  }, []);
  return visible ? <div className="image-lightbox-state" role="status"><Spinner label="Открываем изображение…" /></div> : null;
}

export default function ImageLightbox<T extends ImageSource>({ attachment, images, onLoad, onDownload, onClose, onGoToMessage, onForward }: Props<T>) {
  const items = useMemo<readonly GalleryImage<T>[]>(() => images?.some((item) => item.attachment.id === attachment.id) ? images : [{ attachment }], [images, attachment]);
  const [selectedId, setSelectedId] = useState(attachment.id);
  const index = Math.max(0, items.findIndex((item) => item.attachment.id === selectedId));
  const item = items[index]!;
  const [attempt, setAttempt] = useState(0);
  const state = useImage(item.attachment, onLoad, attempt);
  const [transform, setTransform] = useState({ zoom: 1, x: 0, y: 0, rotation: 0 });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; portalContainer: HTMLElement }>();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => () => {
    const target = returnFocus.current;
    requestAnimationFrame(() => {
      const dialog = document.activeElement?.closest(".fui-DialogSurface");
      if (target?.isConnected && (!dialog || dialog.contains(target))) target.focus({ preventScroll: true });
    });
  }, []);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [fit, setFit] = useState<{ id: string; width: number; height: number }>();
  const fitImage = useCallback(() => {
    const image = imageRef.current, stage = stageRef.current;
    if (!image?.naturalWidth || !stage) return;
    const turned = transform.rotation % 180 !== 0;
    const ratio = Math.min(1, (turned ? stage.clientHeight : stage.clientWidth) / image.naturalWidth, (turned ? stage.clientWidth : stage.clientHeight) / image.naturalHeight);
    setFit({ id: item.attachment.id, width: image.naturalWidth * ratio, height: image.naturalHeight * ratio });
  }, [transform.rotation, item.attachment.id]);
  useEffect(() => {
    const frame = requestAnimationFrame(fitImage);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(fitImage);
    if (stageRef.current) observer?.observe(stageRef.current);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [fitImage, state.url]);
  const wheelRef = useRef({ total: 0, last: -Infinity });
  useEffect(() => { wheelRef.current = { total: 0, last: performance.now() }; }, []);
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number; moved: boolean } | undefined>(undefined);
  const select = useCallback((id: string) => {
    setSelectedId(id); setTransform({ zoom: 1, x: 0, y: 0, rotation: 0 }); setError(""); setMenu(undefined); setGallery(false);
  }, []);
  const move = useCallback((direction: number) => {
    const next = items[index + direction]; if (next) select(next.attachment.id);
  }, [items, index, select]);
  const constrain = useCallback((value: typeof transform): typeof transform => {
    const image = imageRef.current, stage = stageRef.current;
    if (!image || !stage) return value;
    const turned = value.rotation % 180 !== 0;
    const maxX = Math.max(0, ((turned ? image.offsetHeight : image.offsetWidth) * value.zoom - stage.clientWidth) / 2);
    const maxY = Math.max(0, ((turned ? image.offsetWidth : image.offsetHeight) * value.zoom - stage.clientHeight) / 2);
    return { ...value, x: Math.max(-maxX, Math.min(maxX, value.x)), y: Math.max(-maxY, Math.min(maxY, value.y)) };
  }, []);
  const zoom = useCallback((factor: number, clientX?: number, clientY?: number) => {
    setTransform((current) => {
      const next = Math.max(1, Math.min(8, current.zoom * factor));
      if (next === 1) return { ...current, zoom: 1, x: 0, y: 0 };
      const rect = stageRef.current?.getBoundingClientRect();
      const x = rect && clientX !== undefined ? clientX - rect.left - rect.width / 2 : 0;
      const y = rect && clientY !== undefined ? clientY - rect.top - rect.height / 2 : 0;
      return constrain({ ...current, zoom: next, x: x - (x - current.x) * next / current.zoom, y: y - (y - current.y) * next / current.zoom });
    });
  }, [constrain]);
  useEffect(() => {
    const stage = stageRef.current; if (!stage) return;
    const wheel = (event: WheelEvent) => {
      if (menu || gallery) return;
      event.preventDefault();
      const delta = (event.deltaY || event.deltaX) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
      if (event.ctrlKey || event.metaKey) { zoom(Math.exp(-Math.max(-100, Math.min(100, delta)) * .004), event.clientX, event.clientY); return; }
      if (!delta) return;
      const now = performance.now();
      if (now - wheelRef.current.last < 220) return;
      if (Math.sign(delta) !== Math.sign(wheelRef.current.total)) wheelRef.current.total = 0;
      wheelRef.current.total += delta;
      if (Math.abs(wheelRef.current.total) >= 36) { move(wheelRef.current.total > 0 ? 1 : -1); wheelRef.current = { total: 0, last: now }; }
    };
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => stage.removeEventListener("wheel", wheel);
  }, [move, zoom, menu, gallery]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!(event.target as Element).closest(".image-lightbox-menu")) setMenu(undefined); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menu]);
  const download = async () => {
    setMenu(undefined); setSaving(true); setError("");
    try { await onDownload(item.attachment); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить фото"); }
    finally { setSaving(false); }
  };
  const copy = async () => {
    setMenu(undefined); setError("");
    try {
      const image = imageRef.current;
      if (!image?.complete || !image.naturalWidth || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Копирование изображения недоступно в этом браузере. Используйте «Скачать».");
      if (image.naturalWidth * image.naturalHeight > 32_000_000) throw new Error("Фото слишком большое для буфера обмена. Скачайте оригинал.");
      // Clipboard receives pixels, not an expiring private blob URL or HTML.
      const png = new Promise<Blob>((resolve, reject) => {
        const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d"); if (!context) { reject(new Error("Не удалось скопировать фото")); return; }
        context.drawImage(image, 0, 0); canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Не удалось скопировать фото")), "image/png");
      });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось скопировать фото"); }
  };
  const rotate = () => { setMenu(undefined); setTransform((value) => ({ zoom: 1, x: 0, y: 0, rotation: (value.rotation + 90) % 360 })); };
  const openMenu = (x: number, y: number) => { const portalContainer = surfaceRef.current; if (portalContainer) setMenu({ x, y, portalContainer }); };
  return <WorkspaceDialog open onOpenChange={(_, data) => { if (!data.open) { if (menu) setMenu(undefined); else if (gallery) setGallery(false); else onClose(); } }}>
    <DialogSurface ref={surfaceRef} className="image-lightbox-surface" aria-label="Просмотр изображения" onKeyDownCapture={(event) => {
      if (menu && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMenu(undefined); stageRef.current?.focus(); return; }
      if (gallery && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setGallery(false); return; }
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); const r = stageRef.current?.getBoundingClientRect(); if (r) openMenu(r.left + r.width / 2, r.top + r.height / 2); return; }
      if (menu || gallery || (event.target as Element).closest("input,textarea")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.25); }
      if (event.key === "-") { event.preventDefault(); zoom(.8); }
    }}>
      <header className="image-lightbox-header">
        <div><DialogTitle>{item.attachment.fileName}</DialogTitle><span aria-live="polite">Фото {index + 1} из {items.length}</span></div>
        <div className="image-lightbox-tools">
          <Button appearance="subtle" icon={<Minus size={20} />} aria-label="Уменьшить" disabled={transform.zoom <= 1} onClick={() => zoom(.8)} />
          <Button appearance="subtle" aria-label="Сбросить масштаб" onClick={() => setTransform({ zoom: 1, x: 0, y: 0, rotation: 0 })}>{Math.round(transform.zoom * 100)}%</Button>
          <Button appearance="subtle" icon={<Plus size={20} />} aria-label="Увеличить" disabled={transform.zoom >= 8} onClick={() => zoom(1.25)} />
          <Button appearance="subtle" icon={<Download size={20} />} aria-label="Скачать" disabled={saving} onClick={() => void download()} />
          <Button appearance="subtle" icon={<MoreHorizontal size={20} />} aria-label="Действия с изображением" onClick={(event) => { const r = event.currentTarget.getBoundingClientRect(); openMenu(r.right, r.bottom); }} />
          <Button appearance="subtle" icon={<X size={22} />} aria-label="Закрыть просмотрщик" onClick={onClose} />
        </div>
      </header>
      <div ref={stageRef} tabIndex={0} className={`image-lightbox-stage${transform.zoom > 1 ? " is-zoomed" : ""}`} aria-label="Изображение: Ctrl и колесо — масштаб, колесо — предыдущее или следующее фото" onContextMenu={(event) => { event.preventDefault(); openMenu(event.clientX, event.clientY); }}
        onDoubleClick={() => zoom(transform.zoom > 1 ? 1 / transform.zoom : 2)}
        onPointerDown={(event) => { if (event.button !== 0 || (event.target as Element).closest("button")) return; dragRef.current = { x: event.clientX, y: event.clientY, startX: transform.x, startY: transform.y, moved: false }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
        onPointerMove={(event) => { const drag = dragRef.current; if (!drag || transform.zoom <= 1) return; drag.moved = true; setTransform((value) => constrain({ ...value, x: drag.startX + event.clientX - drag.x, y: drag.startY + event.clientY - drag.y })); }}
        onPointerUp={(event) => { const drag = dragRef.current; dragRef.current = undefined; if (drag && !drag.moved && Math.abs(event.clientX - drag.x) > 60) move(event.clientX < drag.x ? 1 : -1); }} onPointerCancel={() => { dragRef.current = undefined; }}>
        {state.error ? <div className="image-lightbox-state" role="alert"><p>{state.error}</p><Button onClick={() => setAttempt((value) => value + 1)}>Повторить</Button></div>
          : !state.url ? <DelayedImageLoading key={`${item.attachment.id}:${attempt}`} />
            : <img ref={imageRef} key={item.attachment.id} src={state.url} alt={item.attachment.fileName} draggable={false} onLoad={fitImage} style={{ ...(fit?.id === item.attachment.id ? { width: fit.width, height: fit.height, maxWidth: "none", maxHeight: "none" } : {}), transform: `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.zoom})` }} onError={() => setError("Не удалось показать изображение. Скачайте оригинал.")} />}
      </div>
      {!gallery && <><Button className="image-lightbox-prev" appearance="subtle" icon={<ChevronLeft size={32} />} aria-label="Предыдущее фото" disabled={index === 0} onClick={() => move(-1)} /><Button className="image-lightbox-next" appearance="subtle" icon={<ChevronRight size={32} />} aria-label="Следующее фото" disabled={index === items.length - 1} onClick={() => move(1)} /></>}
      <footer className="image-lightbox-footer">
        <div className="image-lightbox-metadata"><strong>{item.author}</strong>{item.createdAt && <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("ru-RU")}</time>}<small>Ctrl + колесо — масштаб · колесо — листать</small></div>
        {item.caption && <p className="image-lightbox-caption">{item.caption}</p>}
        <Button appearance="subtle" icon={<Grid2X2 size={20} />} aria-label={gallery ? "Вернуться к фото" : "Все фотографии"} onClick={() => { setGallery(!gallery); setMenu(undefined); }}>{gallery ? "К фото" : "Все фото"}</Button>
      </footer>
      {error && <p className="image-lightbox-error" role="alert">{error}</p>}
      {gallery && <div className="image-lightbox-gallery" aria-label="Все фотографии"><div className="image-lightbox-gallery-heading"><h2>Все фотографии · {items.length}</h2><Button appearance="subtle" icon={<X size={20} />} aria-label="Закрыть галерею" onClick={() => setGallery(false)} /></div><div className="image-lightbox-thumbnails">{items.map((entry) => <GalleryThumbnail key={entry.attachment.id} item={entry} onLoad={onLoad} selected={entry.attachment.id === item.attachment.id} onSelect={() => select(entry.attachment.id)} />)}</div></div>}
      {menu && <MessageContextMenu x={menu.x} y={menu.y} portalContainer={menu.portalContainer} autoFocus onPointerDown={(event) => event.stopPropagation()}>
        <div className="image-lightbox-menu" onKeyDown={(event) => { if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return; event.preventDefault(); const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")); const current = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }}>
          {item.messageId && onGoToMessage && <Button role="menuitem" appearance="subtle" icon={<Eye size={18} />} onClick={() => onGoToMessage(item)}>Перейти к сообщению</Button>}
          <Button role="menuitem" appearance="subtle" icon={<Copy size={18} />} disabled={!state.url} onClick={() => void copy()}>Копировать</Button>
          {item.messageId && onForward && <Button role="menuitem" appearance="subtle" icon={<Forward size={18} />} onClick={() => onForward(item)}>Переслать</Button>}
          <Button role="menuitem" appearance="subtle" icon={<Download size={18} />} disabled={saving} onClick={() => void download()}>Сохранить как…</Button>
          <Button role="menuitem" appearance="subtle" icon={<RotateCw size={18} />} onClick={rotate}>Повернуть</Button>
          <Button role="menuitem" appearance="subtle" icon={<Grid2X2 size={18} />} onClick={() => { setGallery(true); setMenu(undefined); }}>Все фотографии</Button>
        </div>
      </MessageContextMenu>}
    </DialogSurface>
  </WorkspaceDialog>;
}
