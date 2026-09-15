import { afterEach, describe, expect, it, vi } from "vitest";

describe("web API addresses and session restore", () => {
  const defaultBridge = window.yuksalish;
  const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  afterEach(() => {
    window.yuksalish = defaultBridge;
    if (cookieDescriptor) Object.defineProperty(document, "cookie", cookieDescriptor);
    vi.restoreAllMocks();
  });

  it("derives HTTPS and WebSocket endpoints from the browser origin", async () => {
    window.yuksalish = undefined;
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "__Host-yuksalish_csrf=csrf-from-cookie",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      accessToken: "access",
      csrfToken: "csrf",
      tokenType: "bearer",
      expiresIn: 900,
      user: { id: "1", username: "user", name: "User", role: "employee" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = await import("./workspace-api");
    expect(api.apiBaseUrl).toBe(window.location.origin);
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
