import type {
  ApprovalRequestSummary,
  AttachmentOwnerType,
  AuthenticationSession,
  ChatMessage,
  DirectoryBootstrap,
  DirectoryEmployee,
  DevelopmentSession,
  InvitationResult,
  PasswordResetResult,
  SessionSummary,
  TaskStatus,
  WorkflowDefinition,
  WorkspaceBootstrap,
  WorkspaceAttachment,
  WorkspaceTask,
  TotpSetup,
  WorkspacePosition,
  WorkspaceRole,
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
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function login(
  username: string,
  password: string,
  totpCode?: string,
): Promise<AuthenticationSession> {
  return apiRequest<AuthenticationSession>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password, totpCode, deviceLabel: "Windows desktop" }),
  });
}

export function refreshAuthentication(refreshToken: string): Promise<AuthenticationSession> {
  return apiRequest<AuthenticationSession>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

export function logout(token: string): Promise<void> {
  return apiRequest<void>("/auth/logout", { method: "POST" }, token);
}

export function acceptInvitation(
  inviteToken: string,
  password: string,
): Promise<AuthenticationSession> {
  return apiRequest<AuthenticationSession>("/auth/invitations/accept", {
    method: "POST",
    body: JSON.stringify({ inviteToken, password, deviceLabel: "Windows desktop" }),
  });
}

export function createInvitation(
  token: string,
  payload: {
    readonly username: string;
    readonly fullName: string;
    readonly jobTitle?: string;
    readonly positionId?: string;
    readonly role: "admin" | "manager" | "employee";
  },
): Promise<InvitationResult> {
  return apiRequest<InvitationResult>(
    "/auth/invitations",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export function loadDirectory(token: string): Promise<DirectoryBootstrap> {
  return apiRequest<DirectoryBootstrap>("/directory", {}, token);
}

export function createPosition(
  token: string,
  name: string,
  sortOrder = 0,
): Promise<WorkspacePosition> {
  return apiRequest<WorkspacePosition>(
    "/directory/positions",
    { method: "POST", body: JSON.stringify({ name, sortOrder }) },
    token,
  );
}

export function updatePosition(
  token: string,
  positionId: string,
  payload: { readonly name?: string; readonly isActive?: boolean; readonly sortOrder?: number },
): Promise<WorkspacePosition> {
  return apiRequest<WorkspacePosition>(
    `/directory/positions/${positionId}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    token,
  );
}

export function updateEmployeeAccess(
  token: string,
  employeeId: string,
  role: Exclude<WorkspaceRole, "superadmin">,
  positionId?: string,
): Promise<DirectoryEmployee> {
  return apiRequest<DirectoryEmployee>(
    `/directory/employees/${employeeId}`,
    { method: "PATCH", body: JSON.stringify({ role, positionId: positionId || null }) },
    token,
  );
}

export function createPasswordReset(
  token: string,
  username: string,
  resetTotp: boolean,
): Promise<PasswordResetResult> {
  return apiRequest<PasswordResetResult>(
    "/auth/password-resets",
    { method: "POST", body: JSON.stringify({ username, resetTotp }) },
    token,
  );
}

export function completePasswordReset(
  resetToken: string,
  password: string,
): Promise<AuthenticationSession> {
  return apiRequest<AuthenticationSession>("/auth/password-resets/complete", {
    method: "POST",
    body: JSON.stringify({ resetToken, password, deviceLabel: "Windows desktop" }),
  });
}

export function getTotpStatus(token: string): Promise<{ readonly enabled: boolean }> {
  return apiRequest<{ readonly enabled: boolean }>("/auth/totp", {}, token);
}

export function setupTotp(token: string): Promise<TotpSetup> {
  return apiRequest<TotpSetup>("/auth/totp/setup", { method: "POST" }, token);
}

export function confirmTotp(
  token: string,
  code: string,
): Promise<{ readonly enabled: boolean }> {
  return apiRequest<{ readonly enabled: boolean }>(
    "/auth/totp/confirm",
    { method: "POST", body: JSON.stringify({ code }) },
    token,
  );
}

export function loadSessions(token: string): Promise<readonly SessionSummary[]> {
  return apiRequest<readonly SessionSummary[]>("/auth/sessions", {}, token);
}

export function revokeSession(token: string, sessionId: string): Promise<void> {
  return apiRequest<void>(`/auth/sessions/${sessionId}`, { method: "DELETE" }, token);
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

export function updateWorkspaceApproval(
  token: string,
  requestId: string,
  payload: {
    readonly title: string;
    readonly amount: number;
    readonly currency: string;
    readonly purpose: string;
    readonly changeComment?: string;
  },
): Promise<ApprovalRequestSummary> {
  return apiRequest<ApprovalRequestSummary>(
    `/approval-requests/${requestId}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    token,
  );
}

export async function uploadWorkspaceAttachment(
  token: string,
  ownerType: AttachmentOwnerType,
  ownerId: string,
  file: File,
): Promise<WorkspaceAttachment> {
  const url = `${apiBaseUrl}/api/v1/attachments/${ownerType}/${ownerId}?fileName=${encodeURIComponent(file.name)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `File upload failed with HTTP ${response.status}`);
  }
  return (await response.json()) as WorkspaceAttachment;
}

export async function downloadWorkspaceAttachment(
  token: string,
  attachmentId: string,
): Promise<Blob> {
  const response = await fetch(`${apiBaseUrl}/api/v1/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `File download failed with HTTP ${response.status}`);
  }
  return response.blob();
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
