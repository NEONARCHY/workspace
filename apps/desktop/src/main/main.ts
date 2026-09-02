import { app, BrowserWindow, session } from "electron";
import { join } from "node:path";

app.enableSandbox();

const developmentUrl = process.env.VITE_DEV_SERVER_URL;

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
    backgroundColor: "#f4f1e8",
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
