import type {
  ApprovalRequestSummary,
  ChatMessage,
  DevelopmentSession,
  TaskStatus,
  WorkflowDefinition,
  WorkspaceBootstrap,
  WorkspaceTask,
} from "@yuksalish/contracts";

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8080";

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${apiBaseUrl}/api/v1${path}`, { ...options, headers });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `API request failed with HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function createDevelopmentSession(username: string): Promise<DevelopmentSession> {
  return apiRequest<DevelopmentSession>("/auth/development-session", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

export function loadWorkspace(token: string): Promise<WorkspaceBootstrap> {
  return apiRequest<WorkspaceBootstrap>("/workspace/bootstrap", {}, token);
}

export function sendWorkspaceMessage(
  token: string,
  chatId: string,
  body: string,
): Promise<ChatMessage> {
  return apiRequest<ChatMessage>(
    `/chats/${chatId}/messages`,
    { method: "POST", body: JSON.stringify({ body }) },
    token,
  );
}

export function createWorkspaceTask(
  token: string,
  payload: {
    readonly title: string;
    readonly assigneeId: string;
    readonly project?: string;
    readonly sourceMessageId?: string;
  },
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    "/tasks",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export function changeWorkspaceTaskStatus(
  token: string,
  taskId: string,
  status: TaskStatus,
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}/status`,
    { method: "PATCH", body: JSON.stringify({ status }) },
    token,
  );
}

export function saveWorkspaceWorkflow(
  token: string,
  workflow: WorkflowDefinition,
): Promise<WorkflowDefinition> {
  return apiRequest<WorkflowDefinition>(
    `/approval-templates/${workflow.id}/graph`,
    {
      method: "PUT",
      body: JSON.stringify({ nodes: workflow.nodes, edges: workflow.edges }),
    },
    token,
  );
}

export function createWorkspaceApproval(
  token: string,
  payload: {
    readonly title: string;
    readonly amount: number;
    readonly currency: string;
    readonly purpose: string;
    readonly sourceTaskId?: string;
  },
): Promise<ApprovalRequestSummary> {
  return apiRequest<ApprovalRequestSummary>(
    "/approval-requests",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export function actOnWorkspaceApproval(
  token: string,
  requestId: string,
  action: "approve" | "reject" | "return" | "resubmit",
  comment?: string,
): Promise<ApprovalRequestSummary> {
  return apiRequest<ApprovalRequestSummary>(
    `/approval-requests/${requestId}/actions`,
    { method: "POST", body: JSON.stringify({ action, comment }) },
    token,
  );
}

export function subscribeToWorkspaceEvents(
  token: string,
  onEvent: () => void,
): () => void {
  const websocketUrl = apiBaseUrl.replace(/^http/, "ws") + "/api/v1/events";
  const socket = new WebSocket(websocketUrl);
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "authenticate", token }));
  });
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data)) as { type?: string };
    if (payload.type !== "authenticated" && payload.type !== "pong") onEvent();
  });
  return () => socket.close();
}
