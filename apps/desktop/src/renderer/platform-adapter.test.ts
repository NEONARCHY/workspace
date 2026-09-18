import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("workspace platform adapter", () => {
  let defaultBridge: Window["yuksalish"];

  beforeEach(() => {
    vi.unstubAllGlobals();
    defaultBridge = window.yuksalish;
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    window.yuksalish = defaultBridge;
    vi.restoreAllMocks();
  });

  it("selects web capabilities without exposing a refresh token to browser storage", async () => {
    window.yuksalish = undefined;
    const { workspacePlatform } = await import("./platform-adapter");
    expect(workspacePlatform.kind).toBe("web");
    expect(await workspacePlatform.saveRefreshSession("secret-refresh-token")).toBe(false);
    expect(JSON.stringify({ ...localStorage })).not.toContain("secret-refresh-token");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("secret-refresh-token");

    await workspacePlatform.saveDraft("chat:user:one", "Черновик");
    expect(await workspacePlatform.loadDraft("chat:user:one")).toBe("Черновик");
    expect(localStorage.length).toBe(0);
  });

  it("uses the preload bridge as the only Electron implementation", async () => {
    const loadDraft = vi.fn().mockResolvedValue("desktop draft");
    window.yuksalish = {
      platform: "win32",
      version: "1.2.3",
      reportDiagnostic: vi.fn().mockResolvedValue(undefined),
      showNotification: vi.fn().mockResolvedValue(true),
      onNotificationOpen: vi.fn(() => () => undefined),
      configureUpdates: vi.fn(),
      checkForUpdates: vi.fn(),
      installUpdate: vi.fn(),
      onUpdateStatus: vi.fn(() => () => undefined),
      loadDraft,
      saveDraft: vi.fn(),
      clearDraft: vi.fn(),
      loadSession: vi.fn(),
      saveSession: vi.fn(),
      clearSession: vi.fn(),
    };
    const { workspacePlatform } = await import("./platform-adapter");
    expect(workspacePlatform.kind).toBe("electron");
    expect(workspacePlatform.version).toBe("1.2.3");
    expect(await workspacePlatform.loadDraft("draft")).toBe("desktop draft");
    expect(loadDraft).toHaveBeenCalledWith("draft");
  });

  it("delivers an allowed web notification even while the workspace is visible", async () => {
    window.yuksalish = undefined;
    const close = vi.fn();
    const NotificationMock = vi.fn(function (this: { onclick: (() => void) | null; close: () => void }) {
      this.onclick = null;
      this.close = close;
    });
    Object.assign(NotificationMock, { permission: "granted", requestPermission: vi.fn() });
    vi.stubGlobal("Notification", NotificationMock);
    const { workspacePlatform } = await import("./platform-adapter");

    await expect(workspacePlatform.showNotification({
      id: "notification-1",
      title: "Новая задача",
      body: "Назначена задача",
      section: "tasks",
    })).resolves.toBe(true);
    expect(NotificationMock).toHaveBeenCalledWith("Новая задача", {
      body: "Назначена задача",
      tag: "notification-1",
    });
  });
});
