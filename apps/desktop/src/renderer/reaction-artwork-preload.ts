import { reactionAnimatedUrl, reactionCatalog, reactionStillUrl } from "./reaction-catalog";

export const reactionArtworkUrls = [...new Set([
  ...reactionCatalog.map(item => reactionStillUrl(item.emoji)),
  ...reactionCatalog.flatMap(item => { const url = reactionAnimatedUrl(item.emoji); return url ? [url] : []; }),
])];

/** Warm bytes, not offscreen animation decoders. One bounded queue per app session. */
export function createReactionArtworkWarmer(urls: readonly string[], load: (url: string) => Promise<unknown>) {
  let pending: Promise<void> | undefined;
  return () => pending ??= (async () => {
    let index = 0;
    const worker = async () => {
      while (index < urls.length) {
        const url = urls[index++]!;
        try { await load(url); } catch { /* Optional cache warmup; artwork has its own fallback. */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, urls.length) }, worker));
  })();
}

// Retain only decoded static thumbnails (~2 MiB), never hidden running decoders.
// Browser HTTP caching alone retains bytes, not the decoded first frame.
const thumbnails = new Map<string, HTMLImageElement>();
export async function warmReactionThumbnail(url: string) {
  if (thumbnails.has(url)) return;
  const image = new Image();
  thumbnails.set(url, image);
  image.decoding = "async";
  image.src = url;
  try { await image.decode(); }
  catch { thumbnails.delete(url); }
}

export const warmReactionArtwork = createReactionArtworkWarmer(reactionArtworkUrls, async url => {
  if (!url.includes("?v=")) { await warmReactionThumbnail(url); return; }
  const response = await fetch(url, { cache: "force-cache", credentials: "same-origin" });
  if (response.ok) await response.arrayBuffer();
});
