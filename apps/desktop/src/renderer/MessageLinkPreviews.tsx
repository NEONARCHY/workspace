import { useEffect, useMemo, useRef, useState } from "react";

import type { LinkPreview } from "@yuksalish/contracts";

import { InlineVideoPlayer } from "./AttachmentPanel";
import { loadLinkPreview } from "./workspace-api";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION = /[),.!?:;\]}]+$/u;

export function extractMessageLinks(body: string): readonly string[] {
  return [...new Set((body.match(URL_PATTERN) ?? []).map((url) => url.replace(TRAILING_PUNCTUATION, "")))]
    .filter(Boolean)
    .slice(0, 3);
}

function SourceFallback({ preview, label }: { readonly preview: LinkPreview; readonly label: string }) {
  return <a className="message-link-preview-source" href={preview.canonicalUrl} target="_blank" rel="noreferrer">
    {label}<span aria-hidden="true">↗</span>
  </a>;
}

function YouTubePreview({ preview }: { readonly preview: LinkPreview }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [failed, setFailed] = useState(false);
  const embedUrl = useMemo(() => {
    const value = new URL(preview.embedUrl ?? preview.canonicalUrl);
    value.searchParams.set("enablejsapi", "1");
    value.searchParams.set("playsinline", "1");
    if (window.location.origin.startsWith("http")) value.searchParams.set("origin", window.location.origin);
    return value.toString();
  }, [preview]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!new Set(["https://www.youtube.com", "https://www.youtube-nocookie.com"]).has(event.origin)) return;
      try {
        const payload = typeof event.data === "string" ? JSON.parse(event.data) as { event?: string } : event.data as { event?: string };
        if (payload.event === "onError") setFailed(true);
      } catch { /* Ignore unrelated iframe messages. */ }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  return <section className="message-link-preview message-link-preview-embed" aria-label={preview.title}>
    {failed ? <div className="message-link-preview-fallback">
      {preview.imageUrl ? <img src={preview.imageUrl} alt="" /> : null}
      <strong>Видео нельзя воспроизвести внутри Workspace</strong>
      <span>Автор или YouTube ограничил встраивание.</span>
    </div> : <iframe
      ref={frameRef}
      src={embedUrl}
      title={preview.title}
      loading="lazy"
      allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
      onLoad={() => frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening" }), "https://www.youtube.com")}
      onError={() => setFailed(true)}
    />}
    <div><strong>{preview.title}</strong><span>{preview.siteName}</span><SourceFallback preview={preview} label="Открыть на YouTube" /></div>
  </section>;
}

function InstagramPreview({ preview }: { readonly preview: LinkPreview }) {
  const [failed, setFailed] = useState(false);
  return <section className="message-link-preview message-link-preview-instagram" aria-label={preview.title}>
    {preview.embedUrl && !failed ? <iframe
      src={preview.embedUrl}
      title={preview.title}
      loading="lazy"
      allow="autoplay; encrypted-media; picture-in-picture"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
      onError={() => setFailed(true)}
    /> : <div className="message-link-preview-fallback message-link-preview-instagram-fallback">
      {preview.imageUrl ? <img src={preview.imageUrl} alt="" loading="lazy" /> : <span className="message-link-preview-platform" aria-hidden="true">Instagram</span>}
      <strong>Публикация недоступна для встроенного просмотра</strong>
    </div>}
    <div><span>{preview.siteName}</span><strong>{preview.title}</strong><SourceFallback preview={preview} label="Открыть в Instagram" /></div>
  </section>;
}

function LinkPreviewCard({ preview }: { readonly preview: LinkPreview }) {
  if (preview.kind === "youtube") {
    return <YouTubePreview preview={preview} />;
  }
  if (preview.kind === "instagram") {
    return <InstagramPreview preview={preview} />;
  }
  if (preview.kind === "video") {
    return <section className="message-link-preview message-link-preview-video" aria-label={preview.title}>
      <InlineVideoPlayer url={preview.canonicalUrl} fileName={preview.title} />
      <div><strong>{preview.title}</strong><span>{preview.siteName}</span></div>
    </section>;
  }
  return <section className="message-link-preview" aria-label={`Превью ссылки: ${preview.title}`}>
    {preview.imageUrl ? <img src={preview.imageUrl} alt="" loading="lazy" /> : null}
    <div><span>{preview.siteName}</span><strong>{preview.title}</strong>{preview.description ? <p>{preview.description}</p> : null}</div>
  </section>;
}

export function MessageLinkPreviews({ body, token }: { readonly body: string; readonly token: string }) {
  const links = extractMessageLinks(body);
  const [previews, setPreviews] = useState<readonly LinkPreview[]>([]);
  useEffect(() => {
    let active = true;
    const requestedLinks = extractMessageLinks(body);
    void Promise.allSettled(requestedLinks.map((url) => loadLinkPreview(token, url))).then((results) => {
      if (active) setPreviews(results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []));
    });
    return () => { active = false; };
  }, [body, token]);
  const currentPreviews = previews.filter((preview) => links.includes(preview.url));
  if (currentPreviews.length === 0) return null;
  return <div className="message-link-previews">{currentPreviews.map((preview) => <LinkPreviewCard key={preview.url} preview={preview} />)}</div>;
}
