import { describe, expect, it } from "vitest";
import { imageAlbumLayout } from "./image-album-layout";

describe("justified image albums", () => {
  for (let count = 1; count <= 10; count++) it(`lays out ${count} varied images without overlaps or holes between rows`, () => {
    const layout = imageAlbumLayout(Array.from({ length: count }, (_, index) => ({ width: [700, 1600, 1000][index % 3]!, height: 1000 })));
    expect(layout.tiles).toHaveLength(count);
    expect(layout.height).toBeGreaterThan(0); expect(layout.height).toBeLessThanOrEqual(count === 1 ? 764 : 560);
    layout.tiles.forEach((tile, index) => {
      expect(tile.x).toBeGreaterThanOrEqual(0); expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.width).toBeLessThanOrEqual(layout.width + .001);
      expect(tile.y + tile.height).toBeLessThanOrEqual(layout.height + .001);
      for (const other of layout.tiles.slice(index + 1)) {
        const overlapWidth = Math.min(tile.x + tile.width, other.x + other.width) - Math.max(tile.x, other.x);
        const overlapHeight = Math.min(tile.y + tile.height, other.y + other.height) - Math.max(tile.y, other.y);
        expect(overlapWidth <= .001 || overlapHeight <= .001).toBe(true);
      }
    });
  });
  it("uses aspect ratios rather than a fixed equal-cell grid", () => {
    const landscape = imageAlbumLayout([{ width: 2000, height: 1000 }, { width: 600, height: 1000 }]);
    expect(landscape.tiles[0]!.width).toBeGreaterThan(landscape.tiles[1]!.width);
  });
});
