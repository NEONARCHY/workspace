import type {
  AIReferentArchiveLetter,
  AIReferentJournalFile,
  AIReferentPacketFile,
  AIReferentPacketKind,
  AIReferentAction,
  AIReferentConfiguration,
  AIReferentConfigurationUpdate,
  AIReferentIncomingRegistry,
  AIReferentLetter,
  AIReferentLetterInput,
  AIReferentRegistry,
  NavigationKey,
  AdministrativeChat,
  AbsenceAction,
  AbsenceRequest,
  AbsenceRequestInput,
  AdministrativeChatInspection,
  PersonalChatAction,
  PersonalPreferences,
  InterfaceLocale,
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
  LinkPreview,
  ModuleAccessRule,
  ModuleAccessSubject,
  ModulePermissionSet,
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
  TripStage,
  TripRequest,
  TripRequestInput,
  WorkflowDefinition,
  WorkspaceBootstrap,
  WorkspaceAttachment,
  WorkspaceTask,
  WorkspaceTaskCreateInput,
  TotpSetup,
  WorkspacePosition,
  WorkspaceDepartment,
  WorkspaceProject,
  WorkspaceNotification,
  WorkspaceRole,
  ManagedEmployeeStatus,
  MembersRegistry,
  HrOverview,
  HrProfile,
  HrRegister,
  HrSettings,
  HrProfileImportRow,
  HrWorkbookPreview,
  ZoomAvailability,
  ZoomMeeting,
  ZoomMeetingInput,
  ZoomMeetingsRegistry,
  DesktopRelease,
  DesktopUpdatePolicy,
} from "@yuksalish/contracts";
import { workspacePlatform } from "./platform-adapter";

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
  ?? (workspacePlatform.kind === "web" ? window.location.origin : "http://127.0.0.1:8080");

let pendingMutations = 0;
export const hasPendingMutation = () => pendingMutations > 0;

export function loadDesktopUpdatePolicy(token: string): Promise<DesktopUpdatePolicy> {
  return apiRequest<DesktopUpdatePolicy>("/updates/policy", {}, token);
}

export function loadLinkPreview(token: string, url: string): Promise<LinkPreview> {
  return apiRequest<LinkPreview>(
    `/messenger/link-preview?url=${encodeURIComponent(url)}`,
    {},
    token,
  );
}

export function loadMembersRegistry(token: string): Promise<MembersRegistry> {
  return apiRequest<MembersRegistry>("/members", {}, token);
}

export function loadAIReferentRegistry(
  token: string,
  filters: { readonly query?: string; readonly status?: string; readonly offset?: number } = {},
): Promise<AIReferentRegistry> {
  const query = new URLSearchParams();
  if (filters.query?.trim()) query.set("query", filters.query.trim());
  if (filters.status) query.set("status", filters.status);
  if (filters.offset) query.set("offset", String(filters.offset));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return apiRequest<AIReferentRegistry>(`/ai-referent/letters${suffix}`, {}, token);
}

export function loadAIReferentConfiguration(token: string) {
  return apiRequest<AIReferentConfiguration>(
    "/ai-referent/configuration", {}, token,
  );
}

export function loadAIReferentReviewers(token: string) {
  return apiRequest<AIReferentConfiguration>(
    "/ai-referent/reviewers", {}, token,
  );
}

export function saveAIReferentConfiguration(
  token: string, payload: AIReferentConfigurationUpdate,
) {
  return apiRequest<AIReferentConfiguration>(
    "/ai-referent/configuration", { method: "PUT", body: JSON.stringify(payload) }, token,
  );
}

export function loadAIReferentIncomingRegistry(
  token: string,
  filters: { readonly query?: string; readonly status?: string; readonly offset?: number; readonly category?: string } = {},
): Promise<AIReferentIncomingRegistry> {
  const query = new URLSearchParams();
  if (filters.query?.trim()) query.set("query", filters.query.trim());
  if (filters.status) query.set("status", filters.status);
  if (filters.offset) query.set("offset", String(filters.offset));
  if (filters.category) query.set("category", filters.category);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return apiRequest<AIReferentIncomingRegistry>(`/ai-referent/incoming${suffix}`, {}, token);
}

export function downloadAIReferentJournal(token: string): Promise<Blob> {
  return boundedRequest(`${apiBaseUrl}/api/v1/ai-referent/journal/latest`, {
    headers: { Authorization: `Bearer ${token}` },
  }, (response) => response.blob(), 120_000);
}

export function createAIReferentLetter(
  token: string,
  payload: AIReferentLetterInput,
): Promise<AIReferentLetter> {
  return apiRequest<AIReferentLetter>(
    "/ai-referent/letters",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export function updateAIReferentLetter(
  token: string,
  letterId: string,
  payload: AIReferentLetterInput,
  expectedRevision: number,
): Promise<AIReferentLetter> {
  return apiRequest<AIReferentLetter>(
    `/ai-referent/letters/${letterId}`,
    { method: "PATCH", body: JSON.stringify({ ...payload, expectedRevision }) },
    token,
  );
}

export function actOnAIReferentLetter(
  token: string,
  letter: Pick<AIReferentLetter, "id" | "revision">,
  action: AIReferentAction,
  comment = "",
  operationId?: string,
): Promise<AIReferentLetter> {
  return apiRequest<AIReferentLetter>(
    `/ai-referent/letters/${letter.id}/actions`,
    {
      method: "POST",
      body: JSON.stringify({ action, comment, expectedRevision: letter.revision, operationId }),
    },
    token,
  );
}

export function loadAIReferentLetter(token: string, id: string) {
  return apiRequest<AIReferentLetter>(`/ai-referent/letters/${id}`, {}, token);
}

export function loadAIReferentPacket(token: string, kind: AIReferentPacketKind, owner: string) {
  return apiRequest<{ readonly files: readonly AIReferentPacketFile[] }>(`/ai-referent/packets/${kind}/${owner}`, {}, token);
}

export function downloadAIReferentPacket(token: string, kind: AIReferentPacketKind, owner: string, file?: AIReferentPacketFile) {
  const suffix = file ? `/files/${file.id}?source=${file.source}` : "/zip";
  return boundedRequest(`${apiBaseUrl}/api/v1/ai-referent/packets/${kind}/${owner}${suffix}`, {
    headers: { Authorization: `Bearer ${token}` },
  }, (response) => response.blob(), 120_000);
}

export function loadAIReferentArchive(token: string, offset = 0, query = "") {
  return apiRequest<{ readonly letters: readonly AIReferentArchiveLetter[] }>(
    `/ai-referent/archive?${new URLSearchParams({ offset: String(offset), query })}`, {}, token);
}

export function loadAIReferentJournals(token: string) {
  return apiRequest<{ readonly files: readonly AIReferentJournalFile[] }>("/ai-referent/journals", {}, token);
}

export function loadAIReferentTelegramLink(token: string) {
  return apiRequest<{ readonly telegramId: string | null }>("/ai-referent/telegram-link", {}, token);
}

export function createAIReferentTelegramLink(token: string) {
  return apiRequest<{ readonly code: string; readonly expiresAt: string }>("/ai-referent/telegram-link", { method: "POST" }, token);
}

export function loadHrOverview(token: string): Promise<HrOverview> {
  return apiRequest<HrOverview>("/hr", {}, token);
}

export function saveHrSettings(token: string, payload: HrSettings): Promise<HrSettings> {
  return apiRequest<HrSettings>("/hr/settings", { method: "PUT", body: JSON.stringify(payload) }, token);
}

export function saveHrProfile(token: string, userId: string, payload: {
  employmentDate: string; serviceAnchorDate: string; serviceYears: number; serviceMonths: number;
  serviceDays: number; serviceReason: string;
}): Promise<HrProfile> {
  return apiRequest<HrProfile>(`/hr/profiles/${userId}`, { method: "PUT", body: JSON.stringify(payload) }, token);
}

export function createHrProfile(token: string, payload: {
  fullName: string; jobTitle?: string | null; employmentDate: string; serviceAnchorDate: string;
  serviceYears: number; serviceMonths: number; serviceDays: number; serviceReason: string;
}): Promise<HrProfile> {
  return apiRequest<HrProfile>("/hr/profiles", { method: "POST", body: JSON.stringify(payload) }, token);
}

export function previewHrWorkbook(token: string, file: File): Promise<HrWorkbookPreview> {
  if (file.size > 10 * 1024 * 1024) throw new Error("Файл Excel должен быть не больше 10 МБ");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "xlsx") throw new Error("Выберите файл Excel формата .xlsx");
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  if (workspacePlatform.kind === "electron") headers.set("X-Desktop-Version", workspacePlatform.version);
  return boundedRequest(
    `${apiBaseUrl}/api/v1/hr/profiles/import/preview?filename=${encodeURIComponent(file.name)}`,
    { method: "POST", headers, body: file },
    async (response) => await response.json() as HrWorkbookPreview,
    120_000,
  );
}

export function importHrProfiles(token: string, payload: {
  sourceLabel: string; rows: readonly HrProfileImportRow[];
}): Promise<{ created: number; alreadyImported: number }> {
  return apiRequest<{ created: number; alreadyImported: number }>("/hr/profiles/import", {
    method: "POST", body: JSON.stringify(payload),
  }, token);
}

export function terminateHrProfile(token: string, profileId: string, payload: { terminatedOn: string; terminationReason: string }): Promise<HrProfile> {
  return apiRequest<HrProfile>(`/hr/profiles/${profileId}/terminate`, { method: "POST", body: JSON.stringify(payload) }, token);
}

export function generateHrRegister(token: string, period: string): Promise<HrRegister> {
  return apiRequest<HrRegister>(`/hr/registers/generate?period=${encodeURIComponent(period)}`, { method: "POST" }, token);
}

export function actHrRegister(token: string, registerId: string, action: "submit" | "approve" | "return" | "account", comment?: string): Promise<HrRegister> {
  return apiRequest<HrRegister>(`/hr/registers/${registerId}/actions`, { method: "POST", body: JSON.stringify({ action, comment }) }, token);
}

export function loadZoomMeetings(token: string): Promise<ZoomMeetingsRegistry> {
  return apiRequest<ZoomMeetingsRegistry>("/zoom-meetings", {}, token);
}

/** `day` is a local calendar date (YYYY-MM-DD) in the organization timezone. */
export function loadZoomAvailability(token: string, day: string): Promise<ZoomAvailability> {
  return apiRequest<ZoomAvailability>(`/zoom-meetings/availability?day=${encodeURIComponent(day)}`, {}, token);
}

export function createZoomMeeting(token: string, payload: ZoomMeetingInput): Promise<ZoomMeeting> {
  return apiRequest<ZoomMeeting>("/zoom-meetings", { method: "POST", body: JSON.stringify(payload) }, token);
}

export function updateZoomMeeting(token: string, meetingId: string, payload: ZoomMeetingInput): Promise<ZoomMeeting> {
  return apiRequest<ZoomMeeting>(`/zoom-meetings/${meetingId}`, { method: "PATCH", body: JSON.stringify(payload) }, token);
}

export function cancelZoomMeeting(token: string, meetingId: string): Promise<ZoomMeeting> {
  return apiRequest<ZoomMeeting>(`/zoom-meetings/${meetingId}/cancel`, { method: "POST" }, token);
}

export function loadDesktopReleases(token: string): Promise<readonly DesktopRelease[]> {
  return apiRequest<DesktopRelease[]>("/updates/releases", {}, token);
}

export function stageDesktopRelease(token: string, version: string, file: File, title: string, notes: readonly string[]): Promise<DesktopRelease> {
  const query = new URLSearchParams({ title });
  notes.forEach((note) => query.append("notes", note));
  return boundedRequest(`${apiBaseUrl}/api/v1/updates/releases?${query}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "X-Release-Version": version,
    },
    body: file,
  }, (response) => response.json() as Promise<DesktopRelease>, 20 * 60_000);
}

export function publishDesktopRelease(token: string, version: string): Promise<DesktopUpdatePolicy> {
  return apiRequest<DesktopUpdatePolicy>(
    `/updates/releases/${encodeURIComponent(version)}/publish`, { method: "POST" }, token,
  );
}

export function setMandatoryDesktopUpdate(token: string, mandatory: boolean): Promise<DesktopUpdatePolicy> {
  return apiRequest<DesktopUpdatePolicy>(
    "/updates/mandatory", { method: "PUT", body: JSON.stringify({ mandatory }) }, token,
  );
}

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

export function changeInterfaceLocale(token: string, locale: InterfaceLocale, revision: number) {
  return apiRequest<PersonalPreferences>("/personal-preferences/locale", {
    method: "PUT", body: JSON.stringify({ locale, revision }),
  }, token);
}

async function boundedRequest<T>(url: string, options: RequestInit, read: (response: Response) => Promise<T>, timeout = 30_000): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = window.setTimeout(abort, timeout);
  const method = (options.method ?? "GET").toUpperCase();
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  const headers = new Headers(options.headers);
  if (workspacePlatform.kind === "web" && isMutation) {
    const csrfToken = workspacePlatform.csrfToken();
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }
  if (isMutation) pendingMutations += 1;
  try {
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: workspacePlatform.kind === "web" ? "same-origin" : "omit",
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
      throw new Error(typeof payload?.detail === "string" ? payload.detail : `Сервер вернул ошибку ${response.status}`);
    }
    return await read(response);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Сервер не ответил вовремя. Обновите данные перед повтором операции: изменения могли сохраниться.", { cause: error });
    throw error;
  } finally {
    if (isMutation) pendingMutations = Math.max(0, pendingMutations - 1);
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
  if (workspacePlatform.kind === "electron") {
    headers.set("X-Desktop-Version", workspacePlatform.version);
  }
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
  const path = workspacePlatform.kind === "web" ? "/auth/web/login" : "/auth/login";
  return apiRequest<AuthenticationSession>(path, {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
      totpCode,
      deviceLabel: workspacePlatform.kind === "web" ? "Yuksalish Web" : "Windows desktop",
    }),
  });
}

export function refreshAuthentication(refreshToken?: string): Promise<AuthenticationSession> {
  if (workspacePlatform.kind === "web") {
    return apiRequest<AuthenticationSession>("/auth/web/refresh", { method: "POST" });
  }
  if (!refreshToken) return Promise.reject(new Error("Refresh session is missing"));
  return apiRequest<AuthenticationSession>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

export function logout(token: string): Promise<void> {
  return apiRequest<void>(
    workspacePlatform.kind === "web" ? "/auth/web/logout" : "/auth/logout",
    { method: "POST" },
    token,
  );
}

export function acceptInvitation(
  inviteToken: string,
  password: string,
): Promise<AuthenticationSession> {
  const path = workspacePlatform.kind === "web"
    ? "/auth/web/invitations/accept" : "/auth/invitations/accept";
  return apiRequest<AuthenticationSession>(path, {
    method: "POST",
    body: JSON.stringify({
      inviteToken,
      password,
      deviceLabel: workspacePlatform.kind === "web" ? "Yuksalish Web" : "Windows desktop",
    }),
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

export function deletePosition(token: string, positionId: string): Promise<void> {
  return apiRequest<void>(`/directory/positions/${positionId}`, { method: "DELETE" }, token);
}

export function updateEmployeeAccess(
  token: string,
  employeeId: string,
  role: Exclude<WorkspaceRole, "superadmin">,
  positionId?: string,
  departmentId?: string,
  directManagerUserId?: string,
): Promise<DirectoryEmployee> {
  return apiRequest<DirectoryEmployee>(
    `/directory/employees/${employeeId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        role,
        positionId: positionId || null,
        departmentId: departmentId || null,
        directManagerUserId: directManagerUserId || null,
      }),
    },
    token,
  );
}

export function updateEmployeeStatus(
  token: string,
  employeeId: string,
  status: ManagedEmployeeStatus,
  reason: string,
): Promise<DirectoryEmployee> {
  return apiRequest<DirectoryEmployee>(
    `/directory/employees/${employeeId}/status`,
    { method: "PATCH", body: JSON.stringify({ status, reason }) },
    token,
  );
}

export function loadAdministrativeChats(token: string): Promise<readonly AdministrativeChat[]> {
  return apiRequest<readonly AdministrativeChat[]>("/administration/chats", {}, token);
}

export function createAdministrativeChatInspection(
  token: string,
  chatId: string,
  reason: string,
  durationMinutes: 15 | 30 | 60,
): Promise<AdministrativeChatInspection> {
  return apiRequest<AdministrativeChatInspection>(
    "/administration/chat-inspections",
    { method: "POST", body: JSON.stringify({ chatId, reason, durationMinutes }) },
    token,
  );
}

export function revokeAdministrativeChatInspection(token: string, inspectionId: string): Promise<void> {
  return apiRequest<void>(
    `/administration/chat-inspections/${inspectionId}`,
    { method: "DELETE" },
    token,
  );
}

export function createDepartment(
  token: string,
  payload: { readonly code: string; readonly name: string; readonly parentId?: string },
): Promise<WorkspaceDepartment> {
  return apiRequest<WorkspaceDepartment>(
    "/directory/departments",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export function updateDepartment(
  token: string,
  departmentId: string,
  payload: { readonly code?: string; readonly name?: string; readonly parentId?: string | null },
): Promise<WorkspaceDepartment> {
  return apiRequest<WorkspaceDepartment>(
    `/directory/departments/${departmentId}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    token,
  );
}

export function updateDepartmentMembers(
  token: string,
  departmentId: string,
  memberIds: readonly string[],
): Promise<WorkspaceDepartment> {
  return apiRequest<WorkspaceDepartment>(
    `/directory/departments/${departmentId}/members`,
    { method: "PUT", body: JSON.stringify({ memberIds }) },
    token,
  );
}

export function setModuleAccessRule(
  token: string,
  subjectType: ModuleAccessSubject,
  subjectKey: string,
  moduleKey: string,
  permissions: ModulePermissionSet,
): Promise<ModuleAccessRule> {
  return apiRequest<ModuleAccessRule>(
    `/directory/access-rules/${subjectType}/${subjectKey}/${moduleKey}`,
    { method: "PUT", body: JSON.stringify({ permissions }) },
    token,
  );
}

export function deleteModuleAccessRule(
  token: string,
  subjectType: ModuleAccessSubject,
  subjectKey: string,
  moduleKey: string,
): Promise<void> {
  return apiRequest<void>(
    `/directory/access-rules/${subjectType}/${subjectKey}/${moduleKey}`,
    { method: "DELETE" },
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

export function changeOwnPassword(token: string, password: string): Promise<void> {
  return apiRequest<void>(
    "/auth/password",
    { method: "PUT", body: JSON.stringify({ password }) },
    token,
  );
}

export function changeUserPassword(token: string, userId: string, password: string): Promise<void> {
  return apiRequest<void>(
    `/auth/users/${encodeURIComponent(userId)}/password`,
    { method: "PUT", body: JSON.stringify({ password }) },
    token,
  );
}

export function completePasswordReset(
  resetToken: string,
  password: string,
): Promise<AuthenticationSession> {
  const path = workspacePlatform.kind === "web"
    ? "/auth/web/password-resets/complete" : "/auth/password-resets/complete";
  return apiRequest<AuthenticationSession>(path, {
    method: "POST",
    body: JSON.stringify({
      resetToken,
      password,
      deviceLabel: workspacePlatform.kind === "web" ? "Yuksalish Web" : "Windows desktop",
    }),
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

export function deleteWorkspaceChat(token: string, id: string): Promise<void> {
  return apiRequest(`/chats/${id}`, { method: "DELETE" }, token);
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

export function editWorkspaceMessage(
  token: string,
  message: ChatMessage,
  body: string,
  mentionUserIds: readonly string[],
): Promise<ChatMessage> {
  return apiRequest(`/messages/${message.id}`, {
    method: "PATCH", body: JSON.stringify({ body, expectedRevision: message.revision ?? 1, mentionUserIds }),
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
  parentCommentId?: string,
): Promise<FeedPost> {
  return apiRequest<FeedPost>(
    `/feed/posts/${postId}/comments`,
    { method: "POST", body: JSON.stringify({ body, parentCommentId }) },
    token,
  );
}

export function deleteWorkspaceFeedComment(
  token: string,
  postId: string,
  commentId: string,
): Promise<FeedPost> {
  return apiRequest<FeedPost>(
    `/feed/posts/${postId}/comments/${commentId}`,
    { method: "DELETE" },
    token,
  );
}

export function setWorkspaceFeedReaction(
  token: string,
  postId: string,
  emoji: string,
  reacted: boolean,
  commentId?: string,
): Promise<FeedPost> {
  const target = commentId ? `/comments/${commentId}` : "";
  return apiRequest<FeedPost>(
    `/feed/posts/${postId}${target}/reactions/${encodeURIComponent(emoji)}`,
    { method: reacted ? "PUT" : "DELETE" },
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

export function deleteWorkspaceFeedPost(token: string, postId: string): Promise<void> {
  return apiRequest<void>(`/feed/posts/${postId}`, { method: "DELETE" }, token);
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

export function respondToWorkspaceCalendarEvent(
  token: string,
  eventId: string,
  status: "accepted" | "declined",
): Promise<CalendarEvent> {
  return apiRequest<CalendarEvent>(
    `/calendar/events/${eventId}/response`,
    { method: "POST", body: JSON.stringify({ status }) },
    token,
  );
}

export function createWorkspaceTask(
  token: string,
  payload: WorkspaceTaskCreateInput,
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

export function deleteWorkspaceTask(token: string, taskId: string): Promise<void> {
  return apiRequest<void>(`/tasks/${taskId}`, { method: "DELETE" }, token);
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

export function setWorkspaceTaskCommentReaction(
  token: string,
  taskId: string,
  commentId: string,
  emoji: string,
  reacted: boolean,
): Promise<WorkspaceTask> {
  return apiRequest<WorkspaceTask>(
    `/tasks/${taskId}/comments/${commentId}/reactions/${encodeURIComponent(emoji)}`,
    { method: reacted ? "PUT" : "DELETE" },
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
    readonly scheduleKind: "daily" | "weekly" | "monthly" | "calendar";
    readonly interval: number;
    readonly calendarRule?: "weekdays" | "month_days" | null;
    readonly weekdays?: readonly number[];
    readonly monthDays?: readonly number[];
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
  readonly calendarEventId?: string;
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
  action: "approve" | "reject" | "return" | "clarify" | "delegate" | "resubmit" | "cancel" | "move",
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

export function deleteWorkspaceApproval(token: string, requestId: string): Promise<void> {
  return apiRequest<void>(`/approval-requests/${requestId}`, { method: "DELETE" }, token);
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
  targetStage?: TripStage,
): Promise<TripRequest> {
  return apiRequest<TripRequest>(
    `/trip-requests/${requestId}/actions`,
    { method: "POST", body: JSON.stringify({ action, comment, targetStage }) },
    token,
  );
}

export function createWorkspaceAbsence(token: string, payload: AbsenceRequestInput): Promise<AbsenceRequest> {
  return apiRequest<AbsenceRequest>("/absence-requests", { method: "POST", body: JSON.stringify(payload) }, token);
}

export function updateWorkspaceAbsence(token: string, requestId: string, payload: AbsenceRequestInput): Promise<AbsenceRequest> {
  return apiRequest<AbsenceRequest>(`/absence-requests/${requestId}`, { method: "PATCH", body: JSON.stringify(payload) }, token);
}

export function actOnWorkspaceAbsence(token: string, requestId: string, action: AbsenceAction, comment = ""): Promise<AbsenceRequest> {
  return apiRequest<AbsenceRequest>(`/absence-requests/${requestId}/actions`, { method: "POST", body: JSON.stringify({ action, comment }) }, token);
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
  const isAudioFile = file.type.toLowerCase().startsWith("audio/")
    || /\.(?:mp3|m4a|aac|wav|flac|ogg|oga|opus|webm)$/i.test(file.name);
  const maxBytes = media ? 4 * 1024 * 1024 : isAudioFile ? 100 * 1024 * 1024 : 25 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error(isAudioFile ? "Аудиофайл должен быть не больше 100 МБ" : "Файл должен быть не больше 25 МБ");
  }
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

export async function uploadProfileAvatar(token: string, file: File): Promise<{ avatarVersion: string }> {
  if (file.size > 15 * 1024 * 1024) throw new Error("Аватар должен быть не больше 15 МБ");
  const extension = file.name.split(".").pop()?.toLowerCase();
  const supportedTypes = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/svg+xml"];
  const supportedExtensions = ["jpg", "jpeg", "png", "heic", "heif", "svg"];
  if (!supportedTypes.includes(file.type.toLowerCase()) && !supportedExtensions.includes(extension ?? "")) {
    throw new Error("Поддерживаются JPG, JPEG, PNG, HEIC и SVG");
  }
  const inferredType = file.type || ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", svg: "image/svg+xml" } as const)[extension as "jpg" | "jpeg" | "png" | "heic" | "heif" | "svg"];
  const headers = new Headers({ "Content-Type": inferredType, Authorization: `Bearer ${token}` });
  if (workspacePlatform.kind === "electron") headers.set("X-Desktop-Version", workspacePlatform.version);
  return boundedRequest(`${apiBaseUrl}/api/v1/profile/avatar`, { method: "PUT", headers, body: file },
    async (response) => await response.json() as { avatarVersion: string }, 120_000);
}

export function loadProfileAvatar(token: string, userId: string, avatarVersion?: string | null): Promise<Blob> {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (workspacePlatform.kind === "electron") headers.set("X-Desktop-Version", workspacePlatform.version);
  const version = avatarVersion ? `?version=${encodeURIComponent(avatarVersion)}` : "";
  return boundedRequest(`${apiBaseUrl}/api/v1/profile/avatar/${userId}${version}`, { headers, cache: "no-store" },
    async (response) => await response.blob());
}

export function subscribeToWorkspaceEvents(
  token: string,
  onEvent: () => void,
  onError: (error: unknown) => void = () => undefined,
): () => void {
  const websocketUrl = new URL("/api/v1/events", apiBaseUrl);
  websocketUrl.protocol = websocketUrl.protocol === "https:" ? "wss:" : "ws:";
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
    socket = new WebSocket(websocketUrl.toString());
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
