import type {
  NavigationKey,
  PersonalChatAction,
  PersonalPreferences,
  ApprovalRequestSummary,
  AttachmentOwnerType,
  AuthenticationSession,
  CalendarEvent,
  CalendarEventInput,
  ChatMessage,
  ChatMember,
  ChatSummary,
  CreateChatInput,
  MessageOptions,
  MessageReactionEmoji,
  DirectoryBootstrap,
  DirectoryEmployee,
  EfficiencyOverview,
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
  TaskEfficiencyExclusionReason,
  TaskReturnReason,
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

export function changePersonalChat(token: string, chatId: string, action: PersonalChatAction) {
  return apiRequest<PersonalPreferences>(`/personal-preferences/chats/${chatId}`, {
    method: "PATCH", body: JSON.stringify({ action }),
  }, token);
}

export function reorderPinnedChats(token: string, chatIds: readonly string[], revision: number) {
  return apiRequest<PersonalPreferences>("/personal-preferences/pinned-chats", {
    method: "PUT", body: JSON.stringify({ chatIds, revision }),
  }, token);
}

export function reorderNavigation(token: string, order: readonly NavigationKey[], revision: number) {
  return apiRequest<PersonalPreferences>("/personal-preferences/navigation", {
    method: "PUT", body: JSON.stringify({ order, revision }),
  }, token);
}

async function boundedRequest<T>(url: string, options: RequestInit, read: (response: Response) => Promise<T>, timeout = 30_000): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = window.setTimeout(abort, timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
      throw new Error(typeof payload?.detail === "string" ? payload.detail : `Сервер вернул ошибку ${response.status}`);
    }
    return await read(response);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Сервер не ответил вовремя. Обновите данные перед повтором операции: изменения могли сохраниться.", { cause: error });
    throw error;
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);
  return boundedRequest(`${apiBaseUrl}/api/v1${path}`, { ...options, headers }, async (response) =>
    response.status === 204 ? undefined as T : await response.json() as T);
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
  options?: MessageOptions,
): Promise<ChatMessage> {
  return apiRequest<ChatMessage>(
    `/chats/${chatId}/messages`,
    { method: "POST", body: JSON.stringify({ body, ...options }) },
    token,
  );
}

export function createWorkspaceChat(token: string, payload: CreateChatInput): Promise<ChatSummary> {
  return apiRequest("/chats", { method: "POST", body: JSON.stringify(payload) }, token);
}

export function updateWorkspaceChat(token: string, id: string, title: string, description: string): Promise<ChatSummary> {
  return apiRequest(`/chats/${id}`, { method: "PATCH", body: JSON.stringify({ title, description }) }, token);
}

export function addWorkspaceChatMembers(token: string, id: string, memberIds: readonly string[]): Promise<ChatSummary> {
  return apiRequest(`/chats/${id}/members`, { method: "POST", body: JSON.stringify({ memberIds }) }, token);
}

export function setWorkspaceChatMember(token: string, id: string, member: ChatMember): Promise<ChatSummary> {
  return apiRequest(`/chats/${id}/members/${member.userId}`, { method: "PUT", body: JSON.stringify(member) }, token);
}

export function removeWorkspaceChatMember(token: string, id: string, userId: string): Promise<void> {
  return apiRequest(`/chats/${id}/members/${userId}`, { method: "DELETE" }, token);
}

export function transferWorkspaceChatOwner(token: string, id: string, userId: string): Promise<ChatSummary> {
  return apiRequest(`/chats/${id}/owner`, { method: "POST", body: JSON.stringify({ userId }) }, token);
}

export function editWorkspaceMessage(token: string, message: ChatMessage, body: string): Promise<ChatMessage> {
  return apiRequest(`/messages/${message.id}`, {
    method: "PATCH", body: JSON.stringify({ body, expectedRevision: message.revision ?? 1, mentionUserIds: message.mentionUserIds ?? [] }),
  }, token);
}

export function deleteWorkspaceMessage(token: string, message: ChatMessage): Promise<ChatMessage> {
  return apiRequest(`/messages/${message.id}`, {
    method: "DELETE", body: JSON.stringify({ expectedRevision: message.revision ?? 1 }),
  }, token);
}

export function toggleWorkspaceMessageReaction(
  token: string,
  messageId: string,
  emoji: MessageReactionEmoji,
): Promise<ChatMessage> {
  return apiRequest(`/messages/${messageId}/reactions`, {
    method: "POST",
    body: JSON.stringify({ emoji }),
  }, token);
}

export function setWorkspaceMessagePinned(
  token: string,
  messageId: string,
  pinned: boolean,
): Promise<ChatMessage> {
  return apiRequest(`/messages/${messageId}/pin`, {
    method: "PUT",
    body: JSON.stringify({ pinned }),
  }, token);
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
    readonly parentTaskId?: string;
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

export function submitWorkspaceTaskResult(
  token: string,
  taskId: string,
  resultText: string,
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}/submit-result`,
    { method: "POST", body: JSON.stringify({ resultText }) },
    token,
  );
}

export function acceptWorkspaceTaskResult(
  token: string,
  taskId: string,
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}/accept-result`,
    { method: "POST" },
    token,
  );
}

export function loadWorkspaceEfficiency(
  token: string,
  period?: string,
): Promise<EfficiencyOverview> {
  const suffix = period ? `?period=${encodeURIComponent(period)}` : "";
  return apiRequest<EfficiencyOverview>(`/efficiency${suffix}`, {}, token);
}

export function returnWorkspaceTaskForRevision(
  token: string,
  taskId: string,
  reasonCode: TaskReturnReason,
  reasonText: string,
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}/return-for-revision`,
    { method: "POST", body: JSON.stringify({ reasonCode, reasonText }) },
    token,
  );
}

export function setWorkspaceTaskEfficiencyExclusion(
  token: string,
  taskId: string,
  excluded: boolean,
  reasonCode?: TaskEfficiencyExclusionReason,
  reasonText = "",
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}/efficiency-exclusion`,
    { method: "PUT", body: JSON.stringify({ excluded, reasonCode, reasonText }) },
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
  media?: {
    readonly mediaKind: "voice";
    readonly mediaDurationMs: number;
    readonly mediaCodec: "opus";
  },
): Promise<WorkspaceAttachment> {
  const query = new URLSearchParams({ fileName: file.name, documentRole });
  if (media) {
    query.set("mediaKind", media.mediaKind);
    query.set("mediaDurationMs", String(media.mediaDurationMs));
    query.set("mediaCodec", media.mediaCodec);
  }
  const url = `${apiBaseUrl}/api/v1/attachments/${ownerType}/${ownerId}?${query.toString()}`;
  return boundedRequest(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  }, async (response) => await response.json() as WorkspaceAttachment, 120_000);
}

export async function downloadWorkspaceAttachment(
  token: string,
  attachmentId: string,
): Promise<Blob> {
  return boundedRequest(`${apiBaseUrl}/api/v1/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  }, (response) => response.blob(), 120_000);
}

export function subscribeToWorkspaceEvents(
  token: string,
  onEvent: () => void,
  onError: (error: unknown) => void = () => undefined,
): () => void {
  const websocketUrl = apiBaseUrl.replace(/^http/, "ws") + "/api/v1/events";
  let socket: WebSocket;
  let stopped = false;
  let retry = 1_000;
  let reconnectTimer: number | undefined;
  let eventTimer: number | undefined;
  const scheduleRefresh = () => {
    if (eventTimer !== undefined || stopped) return;
    eventTimer = window.setTimeout(() => {
      eventTimer = undefined;
      try { onEvent(); } catch (error) { onError(error); }
    }, 200);
  };
  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(websocketUrl);
    socket.addEventListener("open", () => {
      if (!stopped) socket.send(JSON.stringify({ type: "authenticate", token }));
    });
    socket.addEventListener("message", (event) => {
      if (stopped) return;
      try {
        const payload: unknown = JSON.parse(String(event.data));
        if (!payload || typeof payload !== "object" || !("type" in payload)) return;
        if (payload.type === "authenticated") {
          retry = 1_000;
          scheduleRefresh(); // catch changes missed while disconnected
        } else if (payload.type !== "pong") scheduleRefresh();
      } catch { onError(new Error("Не удалось прочитать обновление. Данные можно обновить вручную.")); }
    });
    socket.addEventListener("close", (event) => {
      if (stopped) return;
      onError(new Error("Связь с сервером прервана. Переподключаемся; несохранённый ввод остаётся на экране."));
      if ([1008, 4401, 4403].includes(event.code)) return;
      reconnectTimer = window.setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30_000);
    });
  };
  connect();
  return () => {
    stopped = true;
    window.clearTimeout(reconnectTimer);
    window.clearTimeout(eventTimer);
    socket?.close();
  };
}
