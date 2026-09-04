import type {
  ApprovalRequestSummary,
  AttachmentOwnerType,
  AuthenticationSession,
  CalendarEvent,
  CalendarEventInput,
  ChatMessage,
  DirectoryBootstrap,
  DirectoryEmployee,
  FeedPost,
  DevelopmentSession,
  InvitationResult,
  NotificationPreferences,
  PasswordResetResult,
  PaymentRequestDetails,
  ProjectInput,
  ProjectStage,
  SessionSummary,
  TaskParticipantRole,
  TaskStatus,
  TripAction,
  TripRequest,
  TripRequestInput,
  WorkflowDefinition,
  WorkspaceBootstrap,
  WorkspaceAttachment,
  WorkspaceTask,
  TotpSetup,
  WorkspacePosition,
  WorkspaceProject,
  WorkspaceNotification,
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

export function markWorkspaceNotificationRead(
  token: string,
  notificationId: string,
): Promise<WorkspaceNotification> {
  return apiRequest<WorkspaceNotification>(
    `/notifications/${notificationId}/read`,
    { method: "PATCH" },
    token,
  );
}

export function markAllWorkspaceNotificationsRead(token: string): Promise<void> {
  return apiRequest<void>("/notifications/read-all", { method: "POST" }, token);
}

export function markWorkspaceNotificationDesktopDelivered(
  token: string,
  notificationId: string,
): Promise<WorkspaceNotification> {
  return apiRequest<WorkspaceNotification>(
    `/notifications/${notificationId}/desktop-delivered`,
    { method: "PATCH" },
    token,
  );
}

export function updateWorkspaceNotificationPreferences(
  token: string,
  preferences: NotificationPreferences,
): Promise<NotificationPreferences> {
  return apiRequest<NotificationPreferences>(
    "/notification-preferences",
    { method: "PUT", body: JSON.stringify(preferences) },
    token,
  );
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

export function markWorkspaceChatRead(token: string, chatId: string): Promise<void> {
  return apiRequest<void>(`/chats/${chatId}/read`, { method: "POST" }, token);
}

export function searchWorkspaceMessages(
  token: string,
  query: string,
): Promise<readonly ChatMessage[]> {
  return apiRequest<readonly ChatMessage[]>(
    `/messages/search?q=${encodeURIComponent(query)}`,
    {},
    token,
  );
}

export function createWorkspaceFeedPost(
  token: string,
  title: string,
  body: string,
): Promise<FeedPost> {
  return apiRequest<FeedPost>(
    "/feed/posts",
    { method: "POST", body: JSON.stringify({ title, body }) },
    token,
  );
}

export function addWorkspaceFeedComment(
  token: string,
  postId: string,
  body: string,
): Promise<FeedPost> {
  return apiRequest<FeedPost>(
    `/feed/posts/${postId}/comments`,
    { method: "POST", body: JSON.stringify({ body }) },
    token,
  );
}

export function setWorkspaceFeedLike(
  token: string,
  postId: string,
  liked: boolean,
): Promise<FeedPost> {
  return apiRequest<FeedPost>(
    `/feed/posts/${postId}/like`,
    { method: liked ? "PUT" : "DELETE" },
    token,
  );
}

export function pinWorkspaceFeedPost(
  token: string,
  postId: string,
  isPinned: boolean,
): Promise<FeedPost> {
  return apiRequest<FeedPost>(
    `/feed/posts/${postId}/pin`,
    { method: "PATCH", body: JSON.stringify({ isPinned }) },
    token,
  );
}

export function createWorkspaceCalendarEvent(
  token: string,
  payload: CalendarEventInput,
): Promise<CalendarEvent> {
  return apiRequest<CalendarEvent>(
    "/calendar/events",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export function updateWorkspaceCalendarEvent(
  token: string,
  eventId: string,
  payload: CalendarEventInput,
): Promise<CalendarEvent> {
  return apiRequest<CalendarEvent>(
    `/calendar/events/${eventId}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    token,
  );
}

export function cancelWorkspaceCalendarEvent(
  token: string,
  eventId: string,
): Promise<CalendarEvent> {
  return apiRequest<CalendarEvent>(
    `/calendar/events/${eventId}/cancel`,
    { method: "POST" },
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
    readonly description?: string;
    readonly priority?: WorkspaceTask["priority"];
    readonly dueAt?: string;
  },
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    "/tasks",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export function updateWorkspaceTask(
  token: string,
  taskId: string,
  payload: {
    readonly title: string;
    readonly description: string;
    readonly project: string;
    readonly assigneeId: string;
    readonly priority: WorkspaceTask["priority"];
    readonly dueAt?: string | null;
  },
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}`,
    { method: "PATCH", body: JSON.stringify(payload) },
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

export function setWorkspaceTaskParticipant(
  token: string,
  taskId: string,
  userId: string,
  role: TaskParticipantRole,
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}/participants`,
    { method: "PUT", body: JSON.stringify({ userId, role }) },
    token,
  );
}

export function removeWorkspaceTaskParticipant(
  token: string,
  taskId: string,
  userId: string,
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}/participants/${userId}`,
    { method: "DELETE" },
    token,
  );
}

export function addWorkspaceTaskChecklistItem(
  token: string,
  taskId: string,
  title: string,
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}/checklist`,
    { method: "POST", body: JSON.stringify({ title }) },
    token,
  );
}

export function toggleWorkspaceTaskChecklistItem(
  token: string,
  taskId: string,
  itemId: string,
  isCompleted: boolean,
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}/checklist/${itemId}`,
    { method: "PATCH", body: JSON.stringify({ isCompleted }) },
    token,
  );
}

export function deleteWorkspaceTaskChecklistItem(
  token: string,
  taskId: string,
  itemId: string,
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}/checklist/${itemId}`,
    { method: "DELETE" },
    token,
  );
}

export function addWorkspaceTaskComment(
  token: string,
  taskId: string,
  body: string,
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}/comments`,
    { method: "POST", body: JSON.stringify({ body }) },
    token,
  );
}

export function setWorkspaceTaskDependency(
  token: string,
  taskId: string,
  dependsOnTaskId: string,
  dependencyKind: "blocks" | "relates" = "blocks",
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}/dependencies`,
    { method: "PUT", body: JSON.stringify({ dependsOnTaskId, dependencyKind }) },
    token,
  );
}

export function removeWorkspaceTaskDependency(
  token: string,
  taskId: string,
  dependsOnTaskId: string,
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}/dependencies/${dependsOnTaskId}`,
    { method: "DELETE" },
    token,
  );
}

export function setWorkspaceTaskCycle(
  token: string,
  taskId: string,
  payload: {
    readonly title: string;
    readonly scheduleKind: "daily" | "weekly" | "monthly";
    readonly interval: number;
    readonly nextRunAt?: string | null;
    readonly isEnabled: boolean;
    readonly timezone?: string;
  },
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}/cycle`,
    { method: "PUT", body: JSON.stringify(payload) },
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

export function publishWorkspaceWorkflow(
  token: string,
  workflowId: string,
): Promise<WorkflowDefinition> {
  return apiRequest<WorkflowDefinition>(
    `/approval-templates/${workflowId}/publish`,
    { method: "POST" },
    token,
  );
}

export interface PaymentRequestInput extends PaymentRequestDetails {
  readonly title: string;
  readonly amount: number;
  readonly currency: string;
  readonly purpose: string;
  readonly sourceTaskId?: string;
  readonly changeComment?: string;
}

export function createWorkspaceApproval(
  token: string,
  payload: PaymentRequestInput,
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
  action: "approve" | "reject" | "return" | "clarify" | "delegate" | "resubmit" | "cancel",
  options: {
    readonly comment?: string;
    readonly nodeKey?: string;
    readonly delegateToUserId?: string;
  } = {},
): Promise<ApprovalRequestSummary> {
  return apiRequest<ApprovalRequestSummary>(
    `/approval-requests/${requestId}/actions`,
    { method: "POST", body: JSON.stringify({ action, ...options }) },
    token,
  );
}

export function updateWorkspaceApproval(
  token: string,
  requestId: string,
  payload: PaymentRequestInput,
): Promise<ApprovalRequestSummary> {
  return apiRequest<ApprovalRequestSummary>(
    `/approval-requests/${requestId}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    token,
  );
}

export function createWorkspaceProject(
  token: string,
  payload: ProjectInput,
): Promise<WorkspaceProject> {
  return apiRequest<WorkspaceProject>(
    "/projects",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export function updateWorkspaceProject(
  token: string,
  projectId: string,
  payload: ProjectInput,
): Promise<WorkspaceProject> {
  return apiRequest<WorkspaceProject>(
    `/projects/${projectId}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    token,
  );
}

export function changeWorkspaceProjectStage(
  token: string,
  projectId: string,
  stage: ProjectStage,
  comment = "",
): Promise<WorkspaceProject> {
  return apiRequest<WorkspaceProject>(
    `/projects/${projectId}/stage`,
    { method: "PATCH", body: JSON.stringify({ stage, comment }) },
    token,
  );
}

export function createWorkspaceTripRequest(
  token: string,
  payload: TripRequestInput,
): Promise<TripRequest> {
  return apiRequest<TripRequest>(
    "/trip-requests",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export function updateWorkspaceTripRequest(
  token: string,
  requestId: string,
  payload: TripRequestInput,
): Promise<TripRequest> {
  return apiRequest<TripRequest>(
    `/trip-requests/${requestId}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    token,
  );
}

export function actOnWorkspaceTripRequest(
  token: string,
  requestId: string,
  action: TripAction,
  comment = "",
): Promise<TripRequest> {
  return apiRequest<TripRequest>(
    `/trip-requests/${requestId}/actions`,
    { method: "POST", body: JSON.stringify({ action, comment }) },
    token,
  );
}

export async function uploadWorkspaceAttachment(
  token: string,
  ownerType: AttachmentOwnerType,
  ownerId: string,
  file: File,
  documentRole: "general" | "primary" | "additional" = "general",
): Promise<WorkspaceAttachment> {
  const url = `${apiBaseUrl}/api/v1/attachments/${ownerType}/${ownerId}?fileName=${encodeURIComponent(file.name)}&documentRole=${documentRole}`;
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
