import { afterEach, describe, expect, it, vi } from "vitest";

describe("web API addresses and session restore", () => {
  const defaultBridge = window.yuksalish;
  const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  afterEach(() => {
    window.yuksalish = defaultBridge;
    if (cookieDescriptor) Object.defineProperty(document, "cookie", cookieDescriptor);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps chat-specific history separate from the prewarmed legacy conversation", async () => {
    window.yuksalish = undefined;
    const fetchMock = vi.fn().mockImplementation(async () => new Response("[]", { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = await import("./workspace-api");
    api.clearAssistantPreload();
    api.prewarmAssistantMessages("chat-token");
    await api.loadAssistantMessages("chat-token", "second-chat");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/assistant/messages?chat_id=second-chat"), expect.anything(),
    );
    api.clearAssistantPreload();
  });

  it("creates and lists persistent chats and handles an empty clear response", async () => {
    window.yuksalish = undefined;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) =>
      init.method === "DELETE" ? new Response(null, { status: 204 })
        : new Response(JSON.stringify({ id: "chat" }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = await import("./workspace-api");
    await api.listAssistantChats("chat-token");
    await api.createAssistantChat("chat-token");
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("/assistant/chats"), expect.objectContaining({ method: "POST" }));
    await expect(api.clearAssistantChat("chat-token", "chat")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("/assistant/chats/chat/messages"), expect.objectContaining({ method: "DELETE" }));
    await api.sendAssistantMessage("chat-token", "flash-lite", "Hello", undefined, false, "chat");
    const options = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({ model: "flash-lite", message: "Hello", continue_draft: false, chat_id: "chat" });
  });

  it("derives HTTPS and WebSocket endpoints from the browser origin", async () => {
    window.yuksalish = undefined;
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "__Host-yuksalish_csrf=csrf-from-cookie",
    });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      accessToken: "access",
      csrfToken: "csrf",
      tokenType: "bearer",
      expiresIn: 900,
      user: { id: "1", username: "user", name: "User", role: "employee" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = await import("./workspace-api");
    expect(api.getApiBaseUrl()).toBe(window.location.origin);
    await api.refreshAuthentication();
    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/api/v1/auth/web/refresh`,
      expect.objectContaining({
        credentials: "same-origin",
        method: "POST",
        headers: expect.objectContaining({}),
      }),
    );
    const refreshOptions = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(refreshOptions.headers).get("X-CSRF-Token")).toBe("csrf-from-cookie");

    await api.loadProfileAvatar("token", "person-1", "2026-09-19T12:00:00Z");
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${window.location.origin}/api/v1/profile/avatar/person-1?version=2026-09-19T12%3A00%3A00Z`,
      expect.objectContaining({ cache: "no-store" }),
    );

    class Socket {
      static lastUrl = "";
      constructor(url: string) { Socket.lastUrl = url; }
      addEventListener() { /* test transport */ }
      close() { /* test transport */ }
    }
    vi.stubGlobal("WebSocket", Socket);
    const stop = api.subscribeToWorkspaceEvents("token", vi.fn());
    expect(Socket.lastUrl).toBe(`${window.location.origin.replace(/^http/, "ws")}/api/v1/events`);
    stop();
  });
});
