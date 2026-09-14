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
  readonly configureUpdates: (apiBaseUrl: string, accessToken: string) => Promise<DesktopUpdateStatus>;
  readonly checkForUpdates: () => Promise<DesktopUpdateStatus>;
  readonly installUpdate: () => Promise<void>;
  readonly onUpdateStatus: (listener: (status: DesktopUpdateStatus) => void) => () => void;
  readonly loadDraft: (key: string) => Promise<string | null>;
  readonly saveDraft: (key: string, text: string) => Promise<boolean>;
  readonly clearDraft: (key: string) => Promise<void>;
  readonly loadSession: () => Promise<string | null>;
  readonly saveSession: (refreshToken: string) => Promise<boolean>;
  readonly clearSession: () => Promise<void>;
}

export interface DesktopUpdateStatus {
  readonly phase: "idle" | "checking" | "available" | "downloading" | "ready" | "current" | "error";
  readonly version?: string;
  readonly percent?: number;
  readonly message?: string;
}

const bridge: DesktopBridge = Object.freeze({
  platform: process.platform,
  version: ipcRenderer.sendSync("app:version") as string,
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
  configureUpdates: (apiBaseUrl: string, accessToken: string) =>
    ipcRenderer.invoke("updates:configure", { apiBaseUrl, accessToken }) as Promise<DesktopUpdateStatus>,
  checkForUpdates: () => ipcRenderer.invoke("updates:check") as Promise<DesktopUpdateStatus>,
  installUpdate: () => ipcRenderer.invoke("updates:install") as Promise<void>,
  onUpdateStatus: (listener: (status: DesktopUpdateStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: DesktopUpdateStatus) => listener(status);
    ipcRenderer.on("updates:status", handler);
    return () => ipcRenderer.removeListener("updates:status", handler);
  },
  loadDraft: (key: string) => ipcRenderer.invoke("drafts:load", key) as Promise<string | null>,
  saveDraft: (key: string, text: string) => ipcRenderer.invoke("drafts:save", key, text) as Promise<boolean>,
  clearDraft: (key: string) => ipcRenderer.invoke("drafts:clear", key) as Promise<void>,
  loadSession: () => ipcRenderer.invoke("session:load") as Promise<string | null>,
  saveSession: (refreshToken: string) => ipcRenderer.invoke("session:save", refreshToken) as Promise<boolean>,
  clearSession: () => ipcRenderer.invoke("session:clear") as Promise<void>,
});

contextBridge.exposeInMainWorld("yuksalish", bridge);
