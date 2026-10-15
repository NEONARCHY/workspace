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

export const warmReactionArtwork = createReactionArtworkWarmer(reactionArtworkUrls, async url => {
  const response = await fetch(url, { cache: "force-cache", credentials: "same-origin" });
  if (response.ok) await response.arrayBuffer();
});
