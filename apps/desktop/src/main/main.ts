import { app, BrowserWindow, ipcMain, Notification, session } from "electron";
import { join } from "node:path";

app.enableSandbox();

const developmentUrl = process.env.VITE_DEV_SERVER_URL;

interface DesktopNotificationPayload {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly section: string;
  readonly entityId?: string;
}

function isAllowedNavigation(target: string): boolean {
  if (developmentUrl !== undefined) {
    return new URL(target).origin === new URL(developmentUrl).origin;
  }
  return target.startsWith("file://");
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1240,
    height: 780,
    minWidth: 960,
    minHeight: 640,
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

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (!isAllowedNavigation(target)) {
      event.preventDefault();
    }
  });

  if (developmentUrl !== undefined) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(join(__dirname, "../../dist/index.html"));
  }
  return window;
}

void app.whenReady().then(() => {
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
