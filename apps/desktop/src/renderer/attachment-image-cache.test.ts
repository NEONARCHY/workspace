import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceAttachment } from "@yuksalish/contracts";
import { createAttachmentImageCache, waitForCachedImage, type CachedImage, type ImageCacheBackend } from "./attachment-image-cache";
const attachment = { id: "photo", sha256: "one", contentType: "image/png" } as WorkspaceAttachment;
function disk() {
  const data = new Map<string, CachedImage>();
  const store: ImageCacheBackend = {
    get: async key => data.get(key), put: async item => { data.set(item.key, item); },
    prune: async (before, budget) => {
      for (const [key, value] of data) if (value.savedAt <= before) data.delete(key);
      let total = [...data.values()].reduce((sum, item) => sum + item.blob.size, 0);
      for (const [key, value] of data) { if (total <= budget) break; data.delete(key); total -= value.blob.size; }
    },
    clear: async scope => { for (const [key, value] of data) if (value.scope === scope) data.delete(key); },
  };
  return { data, store };
}
afterEach(() => vi.useRealTimers());
describe("30 day private image cache", () => {
  it("deduplicates concurrent downloads and reuses persistent originals across instances", async () => {
    const { store } = disk(), cache = createAttachmentImageCache(store);
    const original = new Blob(["original unmodified bytes"], { type: "image/png" });
    const fetch = vi.fn(async () => original);
    const [one, two] = await Promise.all([cache.load("server:user", attachment, fetch), cache.load("server:user", attachment, fetch)]);
    expect(one).toBe(original); expect(two).toBe(original); expect(fetch).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(createAttachmentImageCache(store).load("server:user", attachment, fetch)).resolves.toBe(original));
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("isolates users, servers and immutable hashes, and expires after 30 days", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01"));
    const { data, store } = disk(), cache = createAttachmentImageCache(store);
    const fetch = vi.fn(async () => new Blob(["original"]));
    await cache.load("server:a", attachment, fetch);
    await cache.load("server:b", attachment, fetch);
    await cache.load("other-server:a", attachment, fetch);
    await cache.load("server:a", { ...attachment, sha256: "changed" }, fetch);
    expect(fetch).toHaveBeenCalledTimes(4);
    vi.setSystemTime(new Date("2026-11-01"));
    await cache.load("server:a", attachment, fetch);
    expect(fetch).toHaveBeenCalledTimes(5);
    await cache.prune(true);
    expect([...data.values()].every(item => Date.now() - item.savedAt < 30 * 86400_000)).toBe(true);
  });
  it("survives unavailable storage and prevents a logged-out request refilling the cache", async () => {
    const { data, store } = disk(), cache = createAttachmentImageCache(store);
    let finish!: (blob: Blob) => void;
    const request = cache.load("user", attachment, () => new Promise(resolve => { finish = resolve; }));
    await vi.waitFor(() => expect(finish).toBeDefined());
    await cache.clear("user"); finish(new Blob(["old"])); await request;
    expect(data.size).toBe(0);
    const broken = createAttachmentImageCache({ ...store, get: async () => { throw new Error("quota"); }, put: async () => { throw new Error("quota"); } });
    const original = new Blob(["new"]);
    expect(await broken.load("user", attachment, async () => original)).toBe(original);
  });
  it("aborting one viewer does not cancel another viewer's shared request", async () => {
    let finish!: (blob: Blob) => void;
    const shared = new Promise<Blob>(resolve => { finish = resolve; });
    const controller = new AbortController();
    const aborted = waitForCachedImage(shared, controller.signal);
    controller.abort();
    await expect(aborted).rejects.toHaveProperty("name", "AbortError");
    const blob = new Blob(["original"]); finish(blob);
    expect(await waitForCachedImage(shared)).toBe(blob);
  });
});
