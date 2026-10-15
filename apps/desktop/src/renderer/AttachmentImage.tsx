import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { WorkspaceAttachment } from "@yuksalish/contracts";
import { albumTileStyle, imageAlbumLayout, rememberedImageGeometry, rememberImageGeometry } from "./image-album-layout";

export function attachmentGeometry(item: WorkspaceAttachment) {
  return rememberedImageGeometry(item.sha256 || item.id,
    item.imageWidth && item.imageHeight ? { width: item.imageWidth, height: item.imageHeight } : undefined);
}

export interface AttachmentImageProps {
  readonly attachment: WorkspaceAttachment;
  readonly onLoad: (attachment: WorkspaceAttachment, signal?: AbortSignal) => Promise<Blob>;
  readonly onOpen: (attachment: WorkspaceAttachment) => void | Promise<void>;
  readonly style?: CSSProperties;
}

/** The frame never depends on network/decoder completion. Once loaded, the img
 * stays mounted on scroll; only unmount/scope changes release its object URL. */
export function AttachmentImage({ attachment, onLoad, onOpen, style }: AttachmentImageProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const current = useRef(attachment);
  useEffect(() => { current.current = attachment; }, [attachment]);
  const [started, setStarted] = useState(() => typeof IntersectionObserver === "undefined");
  const [resource, setResource] = useState<{ key: string; url: string; failed: boolean }>();
  const key = `${attachment.id}:${attachment.sha256}`;
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setStarted(true); observer.disconnect(); }
    }, { rootMargin: "300px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!started) return;
    let active = true, url = "";
    const controller = new AbortController();
    void Promise.resolve().then(() => onLoad(current.current, controller.signal)).then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob); setResource({ key, url, failed: false });
    }).catch(() => { if (active) setResource({ key, url: "", failed: true }); });
    return () => { active = false; controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [key, onLoad, started]);
  const shown = resource?.key === key ? resource : undefined;
  return <button ref={ref} className="attachment-image-thumb" style={style} type="button"
    aria-label={`Открыть изображение: ${attachment.fileName}`} onClick={() => void onOpen(attachment)}>
    {shown?.url && !shown.failed ? <img src={shown.url} alt={attachment.fileName} decoding="async"
      onLoad={event => {
        const image = event.currentTarget;
        rememberImageGeometry(attachment.sha256 || attachment.id, { width: image.naturalWidth, height: image.naturalHeight });
      }} onError={() => setResource(value => value ? { ...value, failed: true } : value)} />
      : <span className="attachment-image-placeholder" data-failed={shown?.failed || undefined}>
          {shown?.failed ? "Предпросмотр недоступен · открыть" : "Фото"}
        </span>}
  </button>;
}

export function AttachmentImageAlbum({ attachments, onLoad, onOpen }: Omit<AttachmentImageProps, "attachment" | "style"> & {
  readonly attachments: readonly WorkspaceAttachment[];
}) {
  // Freeze unknown legacy geometry for this mount. Loading never changes the
  // chat's scroll height; future mounts can use its remembered real dimensions.
  const [layout] = useState(() => imageAlbumLayout(attachments.map(attachmentGeometry)));
  return <div className="attachment-image-album" role="group" aria-label={`Альбом · ${attachments.length} фото`}
    style={{ aspectRatio: `${layout.width} / ${layout.height}` }}>
    {attachments.map((attachment, index) => <AttachmentImage key={attachment.id} attachment={attachment}
      onLoad={onLoad} onOpen={onOpen} style={albumTileStyle(layout.tiles[index]!, layout)} />)}
  </div>;
}
