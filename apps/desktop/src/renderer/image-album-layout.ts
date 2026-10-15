export interface ImageGeometry { readonly width: number; readonly height: number }
export interface AlbumTile { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
const fallback: ImageGeometry = { width: 1200, height: 900 };
const sizes = new Map<string, ImageGeometry & { at: number }>();
let restored = false;
const storageKey = "yuksalish:image-layouts:v1";
const lifetime = 30 * 86400_000;
function valid(size?: ImageGeometry | null): size is ImageGeometry {
  return Boolean(size && Number.isFinite(size.width) && Number.isFinite(size.height)
    && size.width > 0 && size.height > 0 && size.width <= 100_000 && size.height <= 100_000);
}
export function rememberedImageGeometry(key: string, provided?: ImageGeometry | null): ImageGeometry {
  if (valid(provided)) return provided;
  if (!restored) {
    restored = true;
    try {
      const data = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as unknown;
      if (Array.isArray(data)) for (const entry of data.slice(-1000)) {
        const key: unknown = entry?.key, at: unknown = entry?.at;
        if (typeof key === "string" && typeof at === "number"
          && Date.now() - at < lifetime && valid(entry)) sizes.set(key, { width: entry.width, height: entry.height, at });
      }
    } catch { /* optional local geometry cache */ }
  }
  const remembered = sizes.get(key);
  if (remembered && Date.now() - remembered.at < lifetime) return remembered;
  sizes.delete(key);
  return fallback;
}
export function rememberImageGeometry(key: string, size: ImageGeometry) {
  if (!key || !valid(size)) return;
  rememberedImageGeometry(key);
  sizes.delete(key); sizes.set(key, { ...size, at: Date.now() });
  for (const [id, value] of sizes) if (Date.now() - value.at >= lifetime) sizes.delete(id);
  while (sizes.size > 1000) sizes.delete(sizes.keys().next().value!);
  try { localStorage.setItem(storageKey, JSON.stringify([...sizes].map(([key, size]) => ({ key, ...size })))); }
  catch { /* geometry is useful even when optional persistence is unavailable */ }
}

/** Bounded justified rows, preserving order. Cropping is preview-only.
 * At most ten tiles per album; callers split larger selections into albums.
 */
export function imageAlbumLayout(images: readonly ImageGeometry[]) {
  if (images.length < 1 || images.length > 10) throw new Error("Albums contain 1–10 images");
  const width = 420, gap = 3;
  const ratios = images.map(size => Math.max(.55, Math.min(2, valid(size) ? size.width / size.height : 1)));
  if (images.length === 1) return { width, height: width / ratios[0]!, tiles: [{ x: 0, y: 0, width, height: width / ratios[0]! }] };
  const targetHeight = images.length <= 3 ? 340 : images.length <= 6 ? 440 : 520;
  let best: number[] = [], bestScore = Infinity;
  function choose(offset: number, rows: number[], height: number, score: number) {
    if (offset === images.length) {
      const total = score + ((height - targetHeight) / 150) ** 2;
      if (total < bestScore) { best = rows; bestScore = total; }
      return;
    }
    for (let count = 1; count <= Math.min(3, images.length - offset); count++) {
      const sum = ratios.slice(offset, offset + count).reduce((a, b) => a + b, 0);
      const rowHeight = (width - gap * (count - 1)) / sum;
      choose(offset + count, [...rows, count], height + rowHeight + (offset ? gap : 0),
        score + ((rowHeight - 190) / 220) ** 2 + (count === 1 ? .5 : 0));
    }
  }
  choose(0, [], 0, 0);
  const tiles: AlbumTile[] = [];
  let y = 0, index = 0;
  for (const count of best) {
    const sum = ratios.slice(index, index + count).reduce((a, b) => a + b, 0);
    const height = (width - gap * (count - 1)) / sum;
    let x = 0;
    for (let cell = 0; cell < count; cell++) {
      const tileWidth = height * ratios[index++]!;
      tiles.push({ x, y, width: tileWidth, height }); x += tileWidth + gap;
    }
    y += height + gap;
  }
  const height = Math.min(560, y - gap), scale = height / (y - gap);
  return { width, height, tiles: tiles.map(tile => ({ ...tile, y: tile.y * scale, height: tile.height * scale })) };
}

export function albumTileStyle(tile: AlbumTile, layout: { width: number; height: number }) {
  return { left: `${tile.x / layout.width * 100}%`, top: `${tile.y / layout.height * 100}%`,
    width: `${tile.width / layout.width * 100}%`, height: `${tile.height / layout.height * 100}%` };
}
