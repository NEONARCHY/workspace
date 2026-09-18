import { useEffect, useState } from "react";

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

function LinkPreviewCard({ preview }: { readonly preview: LinkPreview }) {
  if (preview.kind === "youtube") {
    return (
      <section className="message-link-preview message-link-preview-embed" aria-label={preview.title}>
        <iframe src={preview.embedUrl ?? preview.canonicalUrl} title={preview.title} loading="lazy" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
        <div><strong>{preview.title}</strong><span>{preview.siteName}</span></div>
      </section>
    );
  }
  if (preview.kind === "instagram") {
    return (
      <a className="message-link-preview message-link-preview-instagram" href={preview.canonicalUrl} target="_blank" rel="noreferrer" aria-label={`Открыть в Instagram: ${preview.title}`}>
        {preview.imageUrl ? <img src={preview.imageUrl} alt="" loading="lazy" /> : <span className="message-link-preview-platform" aria-hidden="true">Instagram</span>}
        <div><span>{preview.siteName}</span><strong>{preview.title}</strong><p>Открыть публикацию в Instagram</p></div>
      </a>
    );
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
