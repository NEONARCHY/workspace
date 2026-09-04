import { contextBridge, ipcRenderer } from "electron";

export interface DesktopNotificationPayload {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly section: string;
  readonly entityId?: string;
}

export interface DesktopNotificationNavigation {
  readonly id: string;
  readonly section: string;
  readonly entityId?: string;
}

export interface DesktopBridge {
  readonly platform: NodeJS.Platform;
  readonly version: string;
  readonly reportDiagnostic: (payload: { category: string; name: string; frames: string }) => Promise<void>;
  readonly showNotification: (payload: DesktopNotificationPayload) => Promise<boolean>;
  readonly onNotificationOpen: (
    listener: (payload: DesktopNotificationNavigation) => void,
  ) => () => void;
}

const bridge: DesktopBridge = Object.freeze({
  platform: process.platform,
  version: process.env.npm_package_version ?? "0.13.6",
  reportDiagnostic: (payload: { category: string; name: string; frames: string }) => ipcRenderer.invoke("diagnostics:record", payload) as Promise<void>,
  showNotification: (payload: DesktopNotificationPayload) =>
    ipcRenderer.invoke("notifications:show", payload) as Promise<boolean>,
  onNotificationOpen: (listener: (payload: DesktopNotificationNavigation) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: DesktopNotificationNavigation) => {
      listener(payload);
    };
    ipcRenderer.on("notifications:open", handler);
    return () => ipcRenderer.removeListener("notifications:open", handler);
  },
});

contextBridge.exposeInMainWorld("yuksalish", bridge);
