import { app, BrowserWindow, ipcMain } from "electron";
import { NsisUpdater } from "electron-updater";

export type DesktopUpdatePhase = "idle" | "checking" | "available" | "downloading" | "ready" | "current" | "error";

export interface DesktopUpdateStatus {
  readonly phase: DesktopUpdatePhase;
  readonly version?: string;
  readonly percent?: number;
  readonly message?: string;
}

interface UpdateConfiguration {
  readonly apiBaseUrl: string;
  readonly accessToken: string;
}

function normalizedApiBase(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function registerDesktopUpdates(isTrustedPage: (url: string) => boolean): void {
  let updater: NsisUpdater | undefined;
  let configuredOrigin: string | undefined;
  let status: DesktopUpdateStatus = { phase: "idle" };
  const broadcast = (next: DesktopUpdateStatus) => {
    status = next;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("updates:status", next);
    }
  };
  const trusted = (url: string): boolean => isTrustedPage(url);

  ipcMain.on("app:version", (event) => {
    event.returnValue = trusted(event.sender.getURL()) ? app.getVersion() : "";
  });

  ipcMain.handle("updates:configure", async (event, value: UpdateConfiguration) => {
    if (!trusted(event.sender.getURL())) throw new Error("Недоверенное окно");
    if (!app.isPackaged || process.platform !== "win32") return { phase: "idle" };
    if (!value || typeof value.apiBaseUrl !== "string" || typeof value.accessToken !== "string" || value.accessToken.length < 16) {
      throw new Error("Неверная конфигурация обновлений");
    }
    const origin = normalizedApiBase(value.apiBaseUrl);
    if (!origin || configuredOrigin && configuredOrigin !== origin) {
      throw new Error("Для обновлений нужен постоянный адрес сервера HTTPS");
    }
    if (updater === undefined) {
      configuredOrigin = origin;
      updater = new NsisUpdater({ provider: "generic", url: `${origin}/api/v1/updates/feed/` });
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = false;
      updater.disableDifferentialDownload = true;
      updater.on("checking-for-update", () => broadcast({ phase: "checking" }));
      updater.on("update-available", (info) => broadcast({ phase: "available", version: info.version }));
      updater.on("download-progress", (progress) => broadcast({ phase: "downloading", percent: progress.percent }));
      updater.on("update-downloaded", (info) => broadcast({ phase: "ready", version: info.version }));
      updater.on("update-not-available", () => broadcast({ phase: "current" }));
      updater.on("error", (error) => broadcast({ phase: "error", message: error.message }));
    }
    updater.addAuthHeader(`Bearer ${value.accessToken}`);
    return status;
  });

  ipcMain.handle("updates:check", async (event) => {
    if (!trusted(event.sender.getURL())) throw new Error("Недоверенное окно");
    if (!updater) throw new Error("Обновления доступны только в установленном приложении");
    if (status.phase === "ready" || status.phase === "downloading") return status;
    try {
      await updater.checkForUpdates();
    } catch (error) {
      broadcast({ phase: "error", message: error instanceof Error ? error.message : "Не удалось проверить обновление" });
    }
    return status;
  });

  ipcMain.handle("updates:install", (event) => {
    if (!trusted(event.sender.getURL())) throw new Error("Недоверенное окно");
    if (!updater || status.phase !== "ready") throw new Error("Обновление ещё не загружено");
    updater.quitAndInstall(false, true);
  });
}
