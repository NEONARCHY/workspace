export interface NotificationPayload {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly section: string;
  readonly entityId?: string;
}

export interface NotificationNavigation {
  readonly id: string;
  readonly section: string;
  readonly entityId?: string;
}

export interface UpdateStatus {
  readonly phase: "idle" | "checking" | "available" | "downloading" | "ready" | "current" | "error";
  readonly version?: string;
  readonly percent?: number;
  readonly message?: string;
}

export interface WebVersionManifest {
  readonly buildId: string;
  readonly version: string;
  readonly builtAt: string;
}

export interface WorkspacePlatform {
  readonly kind: "electron" | "web";
  readonly platform: string;
  readonly version: string;
  readonly buildId: string;
  readonly supportsDesktopUpdates: boolean;
  readonly reportDiagnostic: (payload: { category: string; name: string; frames: string }) => Promise<void>;
  readonly showNotification: (payload: NotificationPayload) => Promise<boolean>;
  readonly requestNotificationPermission: () => Promise<boolean>;
  readonly onNotificationOpen: (listener: (payload: NotificationNavigation) => void) => () => void;
  readonly configureUpdates?: (apiBaseUrl: string, accessToken: string) => Promise<UpdateStatus>;
  readonly checkForDesktopUpdates?: () => Promise<UpdateStatus>;
  readonly installDesktopUpdate?: () => Promise<void>;
  readonly onDesktopUpdateStatus?: (listener: (status: UpdateStatus) => void) => () => void;
  readonly loadDraft: (key: string) => Promise<string | null>;
  readonly saveDraft: (key: string, text: string) => Promise<boolean>;
  readonly clearDraft: (key: string) => Promise<void>;
  readonly hasSessionHint: () => boolean;
  readonly loadRefreshSession: () => Promise<string | null>;
  readonly saveRefreshSession: (refreshToken: string) => Promise<boolean>;
  readonly clearRefreshSession: () => Promise<void>;
  readonly csrfToken: () => string | undefined;
  readonly checkWebVersion: () => Promise<WebVersionManifest | null>;
}

const notificationListeners = new Set<(payload: NotificationNavigation) => void>();
const webDraftPrefix = "yuksalish:web-draft:";
const csrfCookieName = "__Host-yuksalish_csrf";

function browserCsrfToken(): string | undefined {
  const prefix = `${csrfCookieName}=`;
  const value = document.cookie.split(";").map((item) => item.trim())
    .find((item) => item.startsWith(prefix))?.slice(prefix.length);
  if (!value) return undefined;
  try { return decodeURIComponent(value); } catch { return undefined; }
}

const webPlatform: WorkspacePlatform = {
  kind: "web",
  platform: navigator.platform || "browser",
  version: __YUKSALISH_APP_VERSION__,
  buildId: __YUKSALISH_BUILD_ID__,
  supportsDesktopUpdates: false,
  reportDiagnostic: async () => undefined,
  showNotification: async (payload) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return false;
    const notification = new Notification(payload.title, { body: payload.body, tag: payload.id });
    notification.onclick = () => {
      window.focus();
      for (const listener of notificationListeners) listener(payload);
      notification.close();
    };
    return true;
  },
  requestNotificationPermission: async () => {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return await Notification.requestPermission() === "granted";
  },
  onNotificationOpen: (listener) => {
    notificationListeners.add(listener);
    return () => notificationListeners.delete(listener);
  },
  loadDraft: async (key) => {
    try { return sessionStorage.getItem(`${webDraftPrefix}${key}`); } catch { return null; }
  },
  saveDraft: async (key, text) => {
    try { sessionStorage.setItem(`${webDraftPrefix}${key}`, text); return true; } catch { return false; }
  },
  clearDraft: async (key) => {
    try { sessionStorage.removeItem(`${webDraftPrefix}${key}`); } catch { /* unavailable */ }
  },
  hasSessionHint: () => browserCsrfToken() !== undefined,
  loadRefreshSession: async () => browserCsrfToken() ? "web-cookie" : null,
  saveRefreshSession: async () => false,
  clearRefreshSession: async () => undefined,
  csrfToken: browserCsrfToken,
  checkWebVersion: async () => {
    const response = await fetch(new URL("version.json", window.location.origin), {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Не удалось проверить web-версию (${response.status})`);
    const manifest = await response.json() as Partial<WebVersionManifest>;
    return typeof manifest.buildId === "string"
      && typeof manifest.version === "string"
      && typeof manifest.builtAt === "string"
      ? manifest as WebVersionManifest
      : null;
  },
};

function electronPlatform(): WorkspacePlatform | undefined {
  const bridge = window.yuksalish;
  if (!bridge) return undefined;
  return {
    kind: "electron",
    platform: bridge.platform,
    version: bridge.version,
    buildId: bridge.version,
    supportsDesktopUpdates: true,
    reportDiagnostic: bridge.reportDiagnostic ?? (async () => undefined),
    showNotification: bridge.showNotification ?? (async () => false),
    requestNotificationPermission: async () => true,
    onNotificationOpen: bridge.onNotificationOpen ?? (() => () => undefined),
    configureUpdates: bridge.configureUpdates,
    checkForDesktopUpdates: bridge.checkForUpdates,
    installDesktopUpdate: bridge.installUpdate,
    onDesktopUpdateStatus: bridge.onUpdateStatus,
    loadDraft: bridge.loadDraft ?? (async () => null),
    saveDraft: bridge.saveDraft ?? (async () => false),
    clearDraft: bridge.clearDraft ?? (async () => undefined),
    hasSessionHint: () => true,
    loadRefreshSession: bridge.loadSession ?? (async () => null),
    saveRefreshSession: bridge.saveSession ?? (async () => false),
    clearRefreshSession: bridge.clearSession ?? (async () => undefined),
    csrfToken: () => undefined,
    checkWebVersion: async () => null,
  };
}

export const workspacePlatform = new Proxy({} as WorkspacePlatform, {
  get(_target, property: keyof WorkspacePlatform) {
    return (electronPlatform() ?? webPlatform)[property];
  },
});

export function requestWebReload(): void {
  window.dispatchEvent(new Event("yuksalish:prepare-web-update"));
  window.setTimeout(() => window.location.reload(), 75);
}
