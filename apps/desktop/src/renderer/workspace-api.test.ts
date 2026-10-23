import { afterEach, describe, expect, it, vi } from "vitest";

describe("web API addresses and session restore", () => {
  const defaultBridge = window.yuksalish;
  const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  it("loads separate personal trip and leave inboxes without falling back on an old server", async () => {
    window.yuksalish = undefined;
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ enabled: true, items: [] }))
      .mockResolvedValueOnce(Response.json({ detail: "Not Found" }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = await import("./workspace-api");
    await expect(api.loadTeamApprovalInbox("approval-token", "trips")).resolves.toEqual({ enabled: true, items: [] });
    const [url, options] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("/home/approval-inbox/trips");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer approval-token");
    await expect(api.loadTeamApprovalInbox("approval-token", "leaves")).rejects.toThrow();
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/home/approval-inbox/leaves");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("sends grant source files together with their idempotent payload and lets the browser set multipart boundaries", async () => {
    window.yuksalish = undefined;
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ id: "grant" }));
    vi.stubGlobal("fetch", fetchMock);
    const api = await import("./workspace-api");
    const fields = { title: "Grant", description: "", assigneeId: "executor", coAssigneeIds: [], dueAt: "2099-11-01T09:00:00Z", checklist: [] };
    const files = [new File(["terms"], "terms.txt"), new File(["budget"], "budget.csv")];
    await api.createGrant("grant-token", fields, "request-id", files);
    const [url, request] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("/grants/with-files");
    expect(new Headers(request.headers).get("Content-Type")).toBeNull();
    expect(new Headers(request.headers).get("Authorization")).toBe("Bearer grant-token");
    expect(request.body).toBeInstanceOf(FormData);
    const body = request.body as FormData;
    expect(JSON.parse(String(body.get("payload")))).toEqual({ ...fields, requestId: "request-id" });
    expect(body.getAll("files").map((file) => (file as File).name)).toEqual(["terms.txt", "budget.csv"]);
    fetchMock.mockClear();
    expect(() => api.createGrant("grant-token", fields, "bad", [new File([], "empty.txt")])).toThrow("Пустые файлы");
    expect(fetchMock).not.toHaveBeenCalled();
    await api.createGrant("grant-token", fields, "json-request");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/grants$/), expect.objectContaining({body: JSON.stringify({...fields, requestId: "json-request"})}));
  });
  it("loads the personal signature inbox and does not fall back to the general registry on an old server", async () => {
    window.yuksalish = undefined;
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ letters: [], totalCount: 0 }))
      .mockResolvedValueOnce(Response.json({ detail: "Not Found" }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = await import("./workspace-api");
    await api.loadSignatureInbox("signature-token", 20);
    const [url, options] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("/ai-referent/signature-inbox?offset=20");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer signature-token");
    await expect(api.loadSignatureInbox("signature-token")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("rejects a malformed proposal list instead of crashing the tasks screen", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ tasks: [] })));
    const api = await import("./workspace-api");
    await expect(api.loadTaskProposals("test-token")).rejects.toThrow("некорректный список заявок");
  });
  it("loads Word PDF previews as binary while keeping spreadsheet JSON previews", async () => {
    window.yuksalish = undefined;
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("%PDF-1.7", { headers: { "Content-Type": "application/pdf" } }))
      .mockResolvedValueOnce(Response.json({ kind: "excel", rows: [["42"]] }));
    vi.stubGlobal("fetch", fetchMock);
    const api = await import("./workspace-api");
    const pdf = await api.loadOfficeFilePreview("test-token", "file id");
    expect(pdf).toHaveProperty("type", "application/pdf");
    const [url, options] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("/attachments/file%20id/preview?sheet=0&offset=0&render=true");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer test-token");
    expect(new Headers(options.headers).get("Accept")).toContain("application/pdf");
    expect(await api.loadOfficeFilePreview("test-token", "book", 1, 200)).toEqual({ kind: "excel", rows: [["42"]] });
  });
  it("deletes only the specified task attachment and propagates a server refusal", async () => {
    window.yuksalish = undefined;
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, {status: 204}))
      .mockResolvedValueOnce(Response.json({detail: "Можно удалить только собственный файл"}, {status: 403}));
    vi.stubGlobal("fetch", fetchMock);
    const api = await import("./workspace-api");
    await api.deleteWorkspaceTaskAttachment("qa-token", "task-id", "file-id");
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("/tasks/task-id/attachments/file-id"),
      expect.objectContaining({method: "DELETE"}));
    await expect(api.deleteWorkspaceTaskAttachment("qa-token", "task-id", "other-file"))
      .rejects.toThrow("Можно удалить только собственный файл");
  });
  afterEach(() => {
    window.yuksalish = defaultBridge;
    if (cookieDescriptor) Object.defineProperty(document, "cookie", cookieDescriptor);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps private survey filenames out of URLs and sends versioned settings to authenticated endpoints", async () => {
    window.yuksalish = undefined;
    const fetchMock = vi.fn().mockImplementation(async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = await import("./workspace-api");
    const file = new File(["Q\nA"], "Мой опрос.csv", { type: "text/csv" });
    await api.importSurveyAnalysis("survey-token", file, "request-id", "utf-8-sig", ";");
    const [input, request] = fetchMock.mock.calls.at(-1)! as [string, RequestInit];
    const url = new URL(input);
    expect(url.searchParams.get("fileName")).toBeNull();
    expect(url.searchParams.get("requestId")).toBe("request-id");
    expect(new Headers(request.headers).get("X-Survey-Filename")).toBe(encodeURIComponent(file.name));
    expect(new Headers(request.headers).get("Authorization")).toBe("Bearer survey-token");
    expect(request.body).toBe(file);
    const configuration = { sheet: 0, headerRow: 0, types: {}, separator: ";" as const, missingValues: [], query: "", filters: [], savedViews: [] };
    await api.saveSurveyAnalysis("survey-token", "analysis-id", { expectedRevision: 3, title: "Analysis", archived: false, configuration });
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("/survey-analyses/analysis-id"), expect.objectContaining({ method: "PUT", body: expect.stringContaining('"expectedRevision":3') }));
    await expect(api.importSurveyAnalysis("survey-token", new File([], "empty.csv"), "empty-id", "utf-8-sig", ",")).rejects.toThrow("Файл пуст");
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
  it("cancels a file download after headers while the body is still loading", async () => {
    window.yuksalish = undefined;
    let bodyStarted: (() => void) | undefined;
    const started = new Promise<void>(resolve => { bodyStarted = resolve; });
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => ({
      ok: true, status: 200,
      blob: () => new Promise<Blob>((_resolve, reject) => {
        bodyStarted?.();
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {once:true});
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const api = await import("./workspace-api");
    const controller = new AbortController();
    const result = api.downloadWorkspaceAttachment("test-token", "private-file", controller.signal);
    const rejected = expect(result).rejects.toHaveProperty("name", "AbortError");
    await started;
    controller.abort();
    await rejected;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses EDO-specific authorized routes for original and paginated Office content", async () => {
    window.yuksalish = undefined;
    const fetchMock = vi.fn().mockImplementation(async () => new Response("{}", {
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const api = await import("./workspace-api");
    await api.loadEdoIncomingOfficePreview("edo-token", 17, "external file", 1, 200);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining(
      "/incoming-letters/17/attachments/external%20file/preview?sheet=1&offset=200",
    ), expect.anything());
    const options = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer edo-token");
    await api.downloadEdoIncomingAttachment("edo-token", 17, "external file");
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining(
      "/incoming-letters/17/attachments/external%20file",
    ), expect.objectContaining({ cache: "no-store" }));
  });

  it("uploads an unsaved Office file only to the transient preview endpoint", async () => {
    window.yuksalish = undefined;
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", {headers:{"Content-Type":"application/json"}}));
    vi.stubGlobal("fetch", fetchMock);
    const api = await import("./workspace-api");
    const file = new File(["PK"], "local document.docx", {type:"application/octet-stream"});
    await api.previewAIReferentLocalFile("test-token", file, 0, 0);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(
      "/ai-referent/file-preview?fileName=local%20document.docx&sheet=0&offset=0",
    ), expect.objectContaining({method:"POST",body:file,cache:"no-store"}));
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

  it("pins and permanently deletes chats using the authenticated server list", async () => {
    window.yuksalish = undefined;
    const remaining = [{ id: "remaining", title: "Рабочий чат", isPinned: true }];
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(remaining), {
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const api = await import("./workspace-api");
    await expect(api.pinAssistantChat("chat-token", "chat/id", true)).resolves.toEqual(remaining);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/assistant/chats/chat%2Fid/pin"),
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ pinned: true }) }),
    );
    expect(new Headers(fetchMock.mock.calls.at(-1)?.[1].headers).get("Authorization")).toBe("Bearer chat-token");
    await expect(api.deleteAssistantChat("chat-token", "chat/id")).resolves.toEqual(remaining);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/assistant/chats/chat%2Fid"), expect.objectContaining({ method: "DELETE" }),
    );
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
