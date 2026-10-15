import { describe, expect, it, vi } from "vitest";
import { createReactionArtworkWarmer, reactionArtworkUrls } from "./reaction-artwork-preload";
import { reactionCatalog, reactionStillUrl, reactionAnimatedUrl } from "./reaction-catalog";

describe("reaction artwork warmup", () => {
  it("covers every still and animation without duplicate downloads", () => {
    expect(new Set(reactionArtworkUrls).size).toBe(reactionArtworkUrls.length);
    for (const item of reactionCatalog) {
      expect(reactionArtworkUrls).toContain(reactionStillUrl(item.emoji));
      const animated = reactionAnimatedUrl(item.emoji);
      if (animated) expect(reactionArtworkUrls).toContain(animated);
    }
  });
  it("runs once, caps requests at three, and tolerates failed optional files", async () => {
    let active = 0, maximum = 0;
    const load = vi.fn(async (url: string) => {
      active++; maximum = Math.max(active, maximum);
      await Promise.resolve(); active--;
      if (url === "bad") throw new Error("offline");
    });
    const warm = createReactionArtworkWarmer(["1", "2", "bad", "4", "5"], load);
    const first = warm();
    expect(warm()).toBe(first);
    await first;
    await warm();
    expect(maximum).toBe(3);
    expect(load).toHaveBeenCalledTimes(5);
  });
});
