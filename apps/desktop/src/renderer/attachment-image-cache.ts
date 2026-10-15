import type { WorkspaceAttachment } from "@yuksalish/contracts";

const lifetime = 30 * 24 * 60 * 60 * 1000;
const diskBudget = 256 * 1024 * 1024;
const memoryBudget = 64 * 1024 * 1024;
export interface CachedImage { readonly key: string; readonly scope: string; readonly savedAt: number; readonly blob: Blob }
export interface ImageCacheBackend {
  get(key: string): Promise<CachedImage | undefined>;
  put(value: CachedImage): Promise<void>;
  prune(before: number, budget: number): Promise<void>;
  clear(scope: string): Promise<void>;
}

let database: Promise<IDBDatabase> | undefined;
function db() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("yuksalish-private-images", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images", { keyPath: "key" });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error("Image cache unavailable")); };
  });
  return database;
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const database = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction("images", mode);
    let value: T;
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Image cache unavailable"));
    operation(tx.objectStore("images"), next => { value = next; });
  });
}
const backend: ImageCacheBackend = {
  get: key => transaction("readonly", (store, done) => { const request = store.get(key); request.onsuccess = () => done(request.result as CachedImage | undefined); }),
  put: value => transaction("readwrite", (store, done) => { store.put(value); done(undefined); }),
  clear: scope => transaction("readwrite", (store, done) => {
    const cursor = store.openCursor();
    cursor.onsuccess = () => { const item = cursor.result; if (!item) { done(undefined); return; } if ((item.value as CachedImage).scope === scope) item.delete(); item.continue(); };
  }),
  prune: (before, budget) => transaction("readwrite", (store, done) => {
    const items: { key: string; savedAt: number; bytes: number }[] = [];
    let bytes = 0;
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (item) {
        const value = item.value as CachedImage;
        if (value.savedAt <= before) item.delete();
        else { items.push({ key: value.key, savedAt: value.savedAt, bytes: value.blob.size }); bytes += value.blob.size; }
        item.continue(); return;
      }
      for (const value of items.sort((a, b) => a.savedAt - b.savedAt)) {
        if (bytes <= budget) break;
        store.delete(value.key); bytes -= value.bytes;
      }
      done(undefined);
    };
  }),
};

/** Private local copies only: namespace contains server/user, never a bearer token.
 * Callers must still supply an attachment from the current authorized workspace.
 */
export function createAttachmentImageCache(storage: ImageCacheBackend = backend) {
  const memory = new Map<string, CachedImage>();
  const pending = new Map<string, Promise<Blob>>();
  const generations = new Map<string, number>();
  let lastPrune = 0;
  const keyFor = (scope: string, item: WorkspaceAttachment) => JSON.stringify([scope, item.id, item.sha256]);
  const trimMemory = () => {
    let bytes = 0;
    for (const item of [...memory.values()].reverse()) {
      bytes += item.blob.size;
      if (bytes > memoryBudget || Date.now() - item.savedAt >= lifetime) memory.delete(item.key);
    }
  };
  const prune = async (force = false) => {
    trimMemory();
    if (!force && Date.now() - lastPrune < 60 * 60 * 1000) return;
    lastPrune = Date.now();
    await storage.prune(Date.now() - lifetime, diskBudget).catch(() => undefined);
  };
  const store = async (scope: string, item: WorkspaceAttachment, blob: Blob) => {
    if (!scope || !item.sha256 || blob.size > 25 * 1024 * 1024 || !item.contentType.startsWith("image/")) return;
    const value = { key: keyFor(scope, item), scope, blob, savedAt: Date.now() };
    memory.set(value.key, value); trimMemory();
    await storage.put(value).catch(() => undefined);
    await prune(true);
  };
  const load = async (scope: string, item: WorkspaceAttachment, fetchImage: () => Promise<Blob>): Promise<Blob> => {
    if (!scope || !item.sha256) return fetchImage();
    void prune();
    const key = keyFor(scope, item);
    const running = pending.get(key);
    if (running) return running;
    const generation = generations.get(scope) ?? 0;
    const request = (async () => {
      const cached = memory.get(key) ?? await storage.get(key).catch(() => undefined);
      if (cached && cached.blob instanceof Blob && Number.isFinite(cached.savedAt)
        && Date.now() - cached.savedAt < lifetime) {
        memory.delete(key); memory.set(key, cached); trimMemory(); return cached.blob;
      }
      const blob = await fetchImage();
      if ((generations.get(scope) ?? 0) === generation) void store(scope, item, blob);
      return blob;
    })();
    pending.set(key, request);
    try { return await request; } finally { if (pending.get(key) === request) pending.delete(key); }
  };
  return { load, store, prune,
    clear: async (scope: string) => {
      generations.set(scope, (generations.get(scope) ?? 0) + 1);
      for (const [key, item] of memory) if (item.scope === scope) memory.delete(key);
      for (const key of pending.keys()) if ((JSON.parse(key) as string[])[0] === scope) pending.delete(key);
      await storage.clear(scope).catch(() => undefined);
    },
  };
}
export const attachmentImageCache = createAttachmentImageCache();

export function waitForCachedImage(load: Promise<Blob>, signal?: AbortSignal): Promise<Blob> {
  if (!signal) return load;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    load.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
