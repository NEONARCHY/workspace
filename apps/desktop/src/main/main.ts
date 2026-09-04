import { app, BrowserWindow, dialog, ipcMain, Notification, screen, session } from "electron";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { fitWindowBounds, type WindowBounds } from "./window-state";

app.enableSandbox();

const developmentUrl = process.env.VITE_DEV_SERVER_URL;
const rendererFile = join(__dirname, "../../dist/index.html");
const diagnostics: object[] = [];
let diagnosticWrite = Promise.resolve();

function recordDiagnostic(category: string, name: string, frames = "") {
  diagnostics.push({ at: new Date().toISOString(), version: app.getVersion(), category, name, frames });
  if (diagnostics.length > 50) diagnostics.shift();
  const data = JSON.stringify(diagnostics, null, 2);
  diagnosticWrite = diagnosticWrite.then(() => writeFile(join(app.getPath("userData"), "diagnostics.json"), data)).catch(() => undefined);
}

interface DesktopNotificationPayload {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly section: string;
  readonly entityId?: string;
}

function isAllowedNavigation(target: string): boolean {
  try {
    if (developmentUrl !== undefined) return new URL(target).origin === new URL(developmentUrl).origin;
    return target.split(/[?#]/)[0] === pathToFileURL(rendererFile).href;
  } catch { return false; }
}

function createWindow(): BrowserWindow {
  let saved: Partial<WindowBounds> & { maximized?: boolean } = {};
  try { saved = JSON.parse(readFileSync(join(app.getPath("userData"), "window-state.json"), "utf8")) as typeof saved; } catch { /* first launch */ }
  if (!saved || typeof saved !== "object") saved = {};
  const validBounds = [saved.x, saved.y, saved.width, saved.height].every((value) => typeof value === "number" && Number.isFinite(value));
  const area = validBounds ? screen.getDisplayMatching(saved as WindowBounds).workArea : screen.getPrimaryDisplay().workArea;
  const window = new BrowserWindow({
    ...fitWindowBounds(saved, area),
    minWidth: Math.min(640, area.width),
    minHeight: Math.min(480, area.height),
    title: "Yuksalish Workspace",
    resizable: true,
    movable: true,
    show: false,
    backgroundColor: "#f5f7fa",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once("ready-to-show", () => { if (saved.maximized) window.maximize(); window.show(); });
  const load = () => developmentUrl !== undefined ? window.loadURL(developmentUrl) : window.loadFile(rendererFile);
  let recoveryOpen = false;
  const recover = async (reason: string, unresponsive = false) => {
    if (recoveryOpen || window.isDestroyed()) return;
    recoveryOpen = true;
    recordDiagnostic(unresponsive ? "renderer-unresponsive" : "renderer-stopped", reason);
    window.show();
    try {
      const result = await dialog.showMessageBox(window, {
        type: "warning", title: "Yuksalish Workspace",
        message: unresponsive ? "Окно временно не отвечает" : "Не удалось открыть интерфейс",
        detail: "Можно подождать или перезапустить окно. Данные на сервере сохранятся; несохранённый ввод будет потерян. При повторении сообщите, что вы делали перед сбоем.",
        buttons: [unresponsive ? "Подождать" : "Закрыть приложение", "Перезапустить окно"], defaultId: 0, cancelId: 0,
      });
      if (window.isDestroyed()) return;
      if (result.response === 1) {
        recoveryOpen = false;
        // A reload can recover a hung renderer without reissuing user mutations.
        if (unresponsive) window.webContents.reload();
        else void load().catch(() => recover("load-failed"));
      } else if (!unresponsive) window.close();
    } finally { recoveryOpen = false; }
  };
  window.on("unresponsive", () => { void recover("event", true); });
  window.webContents.on("render-process-gone", (_event, details) => { void recover(details.reason); });
  window.on("close", () => {
    try { writeFileSync(join(app.getPath("userData"), "window-state.json"), JSON.stringify({ ...window.getNormalBounds(), maximized: window.isMaximized() })); } catch { /* geometry must not block close */ }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (!isAllowedNavigation(target)) {
      event.preventDefault();
    }
  });

  void load().catch(() => recover("initial-load-failed"));
  return window;
}

void app.whenReady().then(() => {
  try {
    const previous: unknown = JSON.parse(readFileSync(join(app.getPath("userData"), "diagnostics.json"), "utf8"));
    if (Array.isArray(previous)) diagnostics.push(...previous.slice(-49));
  } catch { /* no previous diagnostic file */ }
  // Local capability snapshot, not hardware identifiers or employee data. Never
  // bypass Chromium's driver blocklist: software rendering may be a safety fallback.
  let previousGraphics = "";
  const recordGraphics = () => {
    const status = app.getGPUFeatureStatus();
    const snapshot = JSON.stringify({ compositing: status.gpu_compositing, rasterization: status.rasterization });
    if (snapshot !== previousGraphics) {
      previousGraphics = snapshot;
      recordDiagnostic("graphics-status", "Capabilities", snapshot);
    }
  };
  app.on("gpu-info-update", recordGraphics);
  void app.getGPUInfo("basic").then(recordGraphics).catch(() => undefined);
  ipcMain.handle("diagnostics:record", (event, payload: unknown) => {
    if (!isAllowedNavigation(event.sender.getURL()) || !payload || typeof payload !== "object") return;
    const value = payload as { category?: unknown; name?: unknown; frames?: unknown };
    if (typeof value.category !== "string" || typeof value.name !== "string" || typeof value.frames !== "string") return;
    recordDiagnostic(value.category.replace(/[^a-z-]/gi, "").slice(0, 48), value.name.replace(/[^a-z]/gi, "").slice(0, 48), value.frames.slice(0, 1500));
  });
  if (process.platform === "win32") app.setAppUserModelId("uz.yuksalish.workspace");
  ipcMain.handle("notifications:show", (event, payload: DesktopNotificationPayload) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (
      window === null
      || window.isFocused()
      || !Notification.isSupported()
      || typeof payload?.id !== "string"
      || typeof payload?.title !== "string"
      || typeof payload?.body !== "string"
      || typeof payload?.section !== "string"
    ) return false;
    const notification = new Notification({
      title: payload.title.slice(0, 240),
      body: payload.body.slice(0, 500),
      silent: false,
    });
    notification.on("click", () => {
      window.show();
      window.focus();
      window.webContents.send("notifications:open", {
        id: payload.id,
        section: payload.section,
        entityId: payload.entityId,
      });
    });
    notification.show();
    return true;
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
