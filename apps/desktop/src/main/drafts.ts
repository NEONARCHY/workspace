import { app, ipcMain, safeStorage } from "electron";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const keyPattern = /^[a-z0-9:_-]{1,160}$/i;
const pending = new Map<string, Promise<void>>();
const retentionMs = 30 * 24 * 60 * 60 * 1000;

async function pruneOldDrafts(): Promise<void> {
  const directory = join(app.getPath("userData"), "drafts");
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-z0-9:_-]{1,160}\.bin(?:\.tmp)?$/i.test(entry.name)) continue;
    const path = join(directory, entry.name);
    const details = await stat(path).catch(() => null);
    const maxAge = entry.name.endsWith(".tmp") ? 24 * 60 * 60 * 1000 : retentionMs;
    if (details && Date.now() - details.mtimeMs > maxAge) {
      await unlink(path).catch(() => undefined);
    }
  }
}

function location(key: string): string {
  if (!keyPattern.test(key)) throw new Error("Неверный ключ черновика");
  return join(app.getPath("userData"), "drafts", `${key}.bin`);
}

function queue(key: string, operation: () => Promise<void>): Promise<void> {
  const previous = pending.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  pending.set(key, next);
  const release = () => { if (pending.get(key) === next) pending.delete(key); };
  void next.then(release, release);
  return next;
}

export function registerEncryptedDrafts(isTrustedPage: (url: string) => boolean): void {
  void pruneOldDrafts();
  ipcMain.handle("drafts:load", async (event, key: string) => {
    if (!isTrustedPage(event.sender.getURL()) || !safeStorage.isEncryptionAvailable()) return null;
    const path = location(key);
    await pending.get(key)?.catch(() => undefined);
    try { return safeStorage.decryptString(await readFile(path)); }
    catch { return null; }
  });
  ipcMain.handle("drafts:save", async (event, key: string, text: string) => {
    if (!isTrustedPage(event.sender.getURL()) || !safeStorage.isEncryptionAvailable()) return false;
    if (typeof text !== "string" || text.length > 128_000) throw new Error("Черновик слишком большой");
    const path = location(key);
    await queue(key, async () => {
      await mkdir(join(app.getPath("userData"), "drafts"), { recursive: true });
      const temporary = `${path}.tmp`;
      await writeFile(temporary, safeStorage.encryptString(text));
      await rename(temporary, path);
    });
    return true;
  });
  ipcMain.handle("drafts:clear", async (event, key: string) => {
    if (!isTrustedPage(event.sender.getURL())) return;
    const path = location(key);
    await queue(key, async () => { await unlink(path).catch(() => undefined); });
  });
}
