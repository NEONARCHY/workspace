import { app, ipcMain, safeStorage } from "electron";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const sessionDirectory = () => join(app.getPath("userData"), "auth");
const sessionPath = () => join(sessionDirectory(), "refresh-session.bin");
const maximumRefreshTokenLength = 4_096;
let pending = Promise.resolve();

function isRefreshToken(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 24
    && value.length <= maximumRefreshTokenLength
    && !/\s/.test(value);
}

function enqueue(operation: () => Promise<void>): Promise<void> {
  const next = pending.catch(() => undefined).then(operation);
  pending = next;
  return next;
}

/**
 * Stores only a refresh session, never an account password. On Windows Electron
 * delegates encryption to DPAPI, so another Windows account cannot decrypt it.
 */
export function registerSecureSession(isTrustedPage: (url: string) => boolean): void {
  ipcMain.handle("session:load", async (event) => {
    if (!isTrustedPage(event.sender.getURL()) || !await safeStorage.isAsyncEncryptionAvailable()) return null;
    await pending.catch(() => undefined);
    try {
      const decrypted = await safeStorage.decryptStringAsync(await readFile(sessionPath()));
      if (!isRefreshToken(decrypted.result)) return null;
      if (decrypted.shouldReEncrypt) {
        await enqueue(async () => {
          const temporary = `${sessionPath()}.tmp`;
          await writeFile(temporary, await safeStorage.encryptStringAsync(decrypted.result));
          await rename(temporary, sessionPath());
        });
      }
      return decrypted.result;
    } catch {
      return null;
    }
  });

  ipcMain.handle("session:save", async (event, refreshToken: unknown) => {
    if (!isTrustedPage(event.sender.getURL()) || !isRefreshToken(refreshToken)) return false;
    if (!await safeStorage.isAsyncEncryptionAvailable()) return false;
    await enqueue(async () => {
      await mkdir(sessionDirectory(), { recursive: true });
      const temporary = `${sessionPath()}.tmp`;
      await writeFile(temporary, await safeStorage.encryptStringAsync(refreshToken));
      await rename(temporary, sessionPath());
    });
    return true;
  });

  ipcMain.handle("session:clear", async (event) => {
    if (!isTrustedPage(event.sender.getURL())) return;
    await enqueue(async () => { await unlink(sessionPath()).catch(() => undefined); });
  });
}
