import { afterEach, describe, expect, it, vi } from "vitest";

const lan = "https://192.168.0.119:8443";
const remote = "https://workspace.opinions.uz";
const deploymentId = "35c08844-c7c6-4ba4-85e8-51c60926c60b";
const originalBridge = window.yuksalish;

async function configuredModule() {
  vi.resetModules();
  vi.stubEnv("VITE_LAN_API_BASE_URL", lan);
  vi.stubEnv("VITE_API_BASE_URL", remote);
  vi.stubEnv("VITE_DEPLOYMENT_ID", deploymentId);
  window.yuksalish = { platform: "win32", version: "test" };
  return await import("./api-origin");
}

function ready(id = deploymentId): Response {
  return new Response(JSON.stringify({ status: "ready", service: "yuksalish-api", deployment_id: id }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  window.yuksalish = originalBridge;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("dual-network desktop server selection", () => {
  it("recognizes the public browser route as remote", async () => {
    vi.resetModules();
    const browserWindow = { ...window, location: { origin: remote }, yuksalish: undefined };
    vi.stubGlobal("window", browserWindow);
    const api = await import("./api-origin");
    expect(api.isRemoteApiOrigin()).toBe(true);
    browserWindow.location.origin = lan;
    expect(api.isRemoteApiOrigin()).toBe(false);
  });

  it("prefers the LAN server and does not send credentials while probing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ready());
    vi.stubGlobal("fetch", fetchMock);
    const api = await configuredModule();
    await expect(api.initializeApiOrigin()).resolves.toBe(lan);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`${lan}/api/v1/health/ready`, expect.objectContaining({ credentials: "omit" }));
  });

  it("falls back only when the public route identifies the same deployment", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ready("be741695-b821-4ca7-828c-8f9999a27e9b"))
      .mockResolvedValueOnce(ready());
    vi.stubGlobal("fetch", fetchMock);
    const api = await configuredModule();
    await expect(api.initializeApiOrigin()).resolves.toBe(remote);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(api.isRemoteApiOrigin()).toBe(true);
  });

  it("refuses an unrelated or unavailable remote server", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ready()).mockResolvedValueOnce(ready("be741695-b821-4ca7-828c-8f9999a27e9b"));
    vi.stubGlobal("fetch", fetchMock);
    const api = await configuredModule();
    await api.initializeApiOrigin();
    await expect(api.switchApiOrigin()).rejects.toThrow("другому развёртыванию");
    expect(api.getApiBaseUrl()).toBe(lan);
  });

  it("retries a read after LAN loss but never replays a write with an unknown result", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    let lanAvailable = true;
    const fetchMock = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
      const method = options.method ?? "GET";
      calls.push({ url, method });
      if (url.endsWith("/health/ready")) return ready();
      if (url.startsWith(lan) && !lanAvailable) throw new TypeError("network lost");
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await configuredModule();
    const api = await import("./workspace-api");
    await api.initializeApiOrigin();
    lanAvailable = false;
    await expect(api.listAssistantChats("token")).resolves.toEqual([]);
    expect(api.getApiBaseUrl()).toBe(remote);
    expect(calls.filter((call) => call.url.endsWith("/assistant/chats"))).toEqual([
      { url: `${lan}/api/v1/assistant/chats`, method: "GET" },
      { url: `${remote}/api/v1/assistant/chats`, method: "GET" },
    ]);

    lanAvailable = true;
    await api.switchWorkspaceOrigin();
    lanAvailable = false;
    await expect(api.createAssistantChat("token")).rejects.toThrow("Запрос не повторён");
    expect(api.getApiBaseUrl()).toBe(remote);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("rejects an oversized remote file before sending any upload", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ready()).mockResolvedValueOnce(ready());
    vi.stubGlobal("fetch", fetchMock);
    await configuredModule();
    const api = await import("./workspace-api");
    await api.initializeApiOrigin();
    await api.switchWorkspaceOrigin();
    const file = new File(["x"], "installer.exe");
    Object.defineProperty(file, "size", { value: 90_000_001 });
    expect(() => api.stageDesktopRelease("token", "1.0.0", file, "Update", [])).toThrow("90 МБ");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends long release notes in the upload body instead of the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ready()).mockResolvedValueOnce(
      new Response(JSON.stringify({ version: "1.0.18" }), {
        status: 201, headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await configuredModule();
    const api = await import("./workspace-api");
    await api.initializeApiOrigin();
    const file = new File(["MZinstaller"], "Yuksalish-Workspace-Setup-1.0.18.exe");
    const notes = Array.from({ length: 50 }, (_, index) => `Изменение ${index}: ${"Описание ".repeat(12)}`);

    await api.stageDesktopRelease("token", "1.0.18", file, "Новое обновление", notes);

    const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${lan}/api/v1/updates/releases/upload`);
    expect(options.body).toBeInstanceOf(FormData);
    const body = options.body as FormData;
    expect(JSON.parse(body.get("metadata") as string)).toEqual({ title: "Новое обновление", notes });
    expect(body.get("file")).toBeInstanceOf(File);
    expect(new Headers(options.headers).has("Content-Type")).toBe(false);
  });
});
