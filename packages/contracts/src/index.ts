export const moduleKeys = [
  "crm",
  "tasks",
  "payment_requests",
  "feed",
  "projects",
  "trip_approvals",
  "absences",
  "members",
  "messenger",
  "calendar",
  "zoom_meetings",
  "outgoing_letters",
  "employees",
] as const;

export type ModuleKey = (typeof moduleKeys)[number];
export const navigationKeys = [...moduleKeys, "notifications", "settings"] as const;
export type NavigationKey = (typeof navigationKeys)[number];
export type PersonalChatAction = "pin" | "unpin" | "archive" | "unarchive";
export interface PersonalPreferences {
  readonly pinnedChatIds: readonly string[];
  readonly archivedChatIds: readonly string[];
  readonly navigationOrder: readonly NavigationKey[];
  readonly revision: number;
}
export type ModuleStatus = "placeholder" | "available";

export interface LocalizedLabel {
  readonly ru: string;
  readonly uz_cyrl: string;
  readonly uz_latn: string;
}

export interface ModuleDescriptor {
  readonly key: ModuleKey;
  readonly label: LocalizedLabel;
  readonly route: `/${string}`;
  readonly status: ModuleStatus;
}

export interface ModuleCatalogResponse {
  readonly modules: readonly ModuleDescriptor[];
}

export type WorkspaceSection = ModuleKey;

export type WorkspaceRole = "superadmin" | "admin" | "manager" | "employee";
export type ModuleAccessAction = "view" | "create" | "edit" | "approve" | "admin";
export type ModuleAccessSubject = "role" | "department" | "user";

export interface ModulePermissionSet {
  readonly view: boolean;
  readonly create: boolean;
  readonly edit: boolean;
  readonly approve: boolean;
  readonly admin: boolean;
}

export interface EffectiveModuleAccess {
  readonly moduleKey: ModuleKey;
  readonly permissions: ModulePermissionSet;
}

export interface ModuleAccessRule {
  readonly id: string;
  readonly subjectType: ModuleAccessSubject;
  readonly subjectKey: string;
  readonly moduleKey: ModuleKey;
  readonly permissions: ModulePermissionSet;
}

export interface ModuleAccessDescriptor {
  readonly key: ModuleKey;
  readonly label: string;
  readonly status: ModuleStatus;
}

export interface WorkspaceDepartment {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly parentId?: string | null;
  readonly assignedUsersCount: number;
}

export interface RoleDescriptor {
  readonly key: WorkspaceRole;
  readonly label: string;
  readonly description: string;
}

export interface WorkspacePosition {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly sortOrder: number;
  readonly source: string;
  readonly assignedUsersCount: number;
}

export interface DirectoryEmployee {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly role: WorkspaceRole;
  readonly departmentId?: string | null;
  readonly positionId?: string | null;
  readonly jobTitle?: string | null;
  readonly status: string;
  readonly directManagerUserId?: string | null;
}

export interface DirectoryBootstrap {
  readonly roles: readonly RoleDescriptor[];
  readonly departments: readonly WorkspaceDepartment[];
  readonly positions: readonly WorkspacePosition[];
  readonly employees: readonly DirectoryEmployee[];
  readonly modules: readonly ModuleAccessDescriptor[];
  readonly accessRules: readonly ModuleAccessRule[];
}

export type ManagedEmployeeStatus = "active" | "blocked" | "archived";

export interface AdministrativeChatMember {
  readonly userId: string;
  readonly name: string;
  readonly status: string;
}

export interface AdministrativeChat {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly members: readonly AdministrativeChatMember[];
  readonly messageCount: number;
  readonly updatedAt: string;
}

export interface AdministrativeChatMessage {
  readonly id: string;
  readonly authorUserId: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
  readonly editedAt?: string | null;
  readonly deletedAt?: string | null;
}

export interface AdministrativeChatInspection {
  readonly id: string;
  readonly chat: AdministrativeChat;
  readonly messages: readonly AdministrativeChatMessage[];
  readonly reason: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly totalMessages: number;
  readonly truncated: boolean;
}

export interface WorkspacePerson {
  readonly id: string;
  readonly username?: string;
  readonly name: string;
  readonly initials: string;
  readonly role: string;
  readonly departmentId?: string | null;
  readonly positionId?: string | null;
  readonly jobTitle?: string | null;
  readonly color: string;
  readonly status?: "pending" | "active" | "blocked" | "archived";
}

export interface WorkflowPosition {
  readonly id: string;
  readonly name: string;
}

export interface ChatPermissions {
  readonly sendMessages: boolean;
  readonly uploadFiles: boolean;
  readonly inviteMembers: boolean;
  readonly manageMembers: boolean;
  readonly editInfo: boolean;
  readonly manageMessages?: boolean;
}

export interface ChatMember {
  readonly userId: string;
  readonly role: "owner" | "moderator" | "member";
  readonly permissions: ChatPermissions;
}

export interface CreateChatInput {
  readonly kind: "direct" | "group";
  readonly title: string;
  readonly description: string;
  readonly memberIds: readonly string[];
}

export interface MessageOptions {
  readonly replyToMessageId?: string | null;
  readonly mentionUserIds: readonly string[];
}

export interface ChatSummary {
  readonly id: string;
  readonly title: string;
  readonly kind: "direct" | "group" | "department" | "project" | "task" | "approval";
  readonly preview: string;
  readonly time: string;
  readonly unread: number;
  readonly description: string;
  readonly ownerId?: string | null;
  readonly members: readonly ChatMember[];
  readonly permissions: ChatPermissions;
}

export interface ChatMessage {
  readonly id: string;
  readonly chatId: string;
  readonly authorId: string;
  readonly body: string;
  readonly time: string;
  readonly createdAt?: string;
  readonly own?: boolean;
  readonly replyToMessageId?: string | null;
  readonly mentionUserIds?: readonly string[];
  readonly editedAt?: string | null;
  readonly deletedAt?: string | null;
  readonly revision?: number;
  readonly canEdit?: boolean;
  readonly reactions?: readonly MessageReaction[];
  readonly isPinned?: boolean;
  readonly pinnedAt?: string | null;
  readonly pinnedByUserId?: string | null;
  readonly canPin?: boolean;
}

export type MessageReactionEmoji = "👍" | "❤️" | "👏" | "🎉" | "👀" | "✅";

export interface MessageReaction {
  readonly emoji: MessageReactionEmoji;
  readonly count: number;
  readonly reactedByCurrentUser: boolean;
}

export interface FeedComment {
  readonly id: string;
  readonly authorUserId: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface FeedPost {
  readonly id: string;
  readonly authorUserId: string;
  readonly title: string;
  readonly body: string;
  readonly isPinned: boolean;
  readonly likedByCurrentUser: boolean;
  readonly likeCount: number;
  readonly canEdit: boolean;
  readonly canDelete?: boolean;
  readonly canPin: boolean;
  readonly comments: readonly FeedComment[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CalendarEventType = "meeting" | "deadline" | "trip" | "task" | "general";

export interface CalendarEvent {
  readonly id: string;
  readonly organizerUserId: string;
  readonly title: string;
  readonly description: string;
  readonly eventType: CalendarEventType;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly allDay: boolean;
  readonly location: string;
  readonly status: "scheduled" | "cancelled";
  readonly attendeeIds: readonly string[];
  readonly canEdit: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CalendarEventInput {
  readonly title: string;
  readonly description: string;
  readonly eventType: CalendarEventType;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly allDay: boolean;
  readonly location: string;
  readonly attendeeIds: readonly string[];
}

export type AbsenceKind = "vacation" | "personal_time" | "late_arrival" | "sick_leave" | "business_event";
export type AbsenceStatus = "draft" | "pending" | "approved" | "acknowledged" | "rejected" | "cancelled";
export type AbsenceAction = "submit" | "approve" | "acknowledge" | "reject" | "cancel";

export interface AbsenceActionHistory {
  readonly id: string;
  readonly actorUserId: string;
  readonly action: AbsenceAction | "created";
  readonly comment?: string | null;
  readonly createdAt: string;
}

export interface AbsenceRequest {
  readonly id: string;
  readonly requesterUserId: string;
  readonly directManagerUserId: string;
  readonly kind: AbsenceKind;
  readonly reason: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: AbsenceStatus;
  readonly statusLabel: string;
  readonly documentStatus: "not_required" | "required" | "uploaded" | "overdue";
  readonly canEdit: boolean;
  readonly allowedActions: readonly AbsenceAction[];
  readonly actions: readonly AbsenceActionHistory[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AbsenceRequestInput {
  readonly kind: AbsenceKind;
  readonly reason: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface PresenceSummaryItem {
  readonly userId: string;
  readonly status: "working" | "trip" | AbsenceKind;
  readonly startsAt?: string | null;
  readonly endsAt?: string | null;
}

export interface MemberDirectoryItem {
  readonly id: number;
  readonly telegramId?: string | null;
  readonly username?: string | null;
  readonly firstName: string;
  readonly lastName?: string | null;
  readonly language?: string | null;
  readonly phone?: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly regionId?: number | null;
  readonly regionNameRu?: string | null;
  readonly regionNameUz?: string | null;
  readonly sphereId?: number | null;
  readonly sphereNameRu?: string | null;
  readonly sphereNameUz?: string | null;
  readonly gender?: "male" | "female" | null;
  readonly birthDate?: string | null;
  readonly profileStatus?: string | null;
  readonly updatedAt?: string | null;
}

export interface MemberDirectoryReference {
  readonly id: number;
  readonly nameRu: string;
  readonly nameUz: string;
  readonly nameEn?: string | null;
}

export interface MembersRegistry {
  readonly configured: boolean;
  readonly generatedAt?: string | null;
  readonly members: readonly MemberDirectoryItem[];
  readonly regions: readonly MemberDirectoryReference[];
  readonly spheres: readonly MemberDirectoryReference[];
}

export type NotificationKind =
  | "message"
  | "task"
  | "approval"
  | "trip"
  | "calendar"
  | "absence"
  | "zoom";
export type NotificationPriority = "normal" | "attention" | "urgent";
export type NotificationSection = Extract<
  WorkspaceSection,
  | "messenger"
  | "tasks"
  | "payment_requests"
  | "trip_approvals"
  | "calendar"
  | "absences"
  | "zoom_meetings"
>;

export interface WorkspaceNotification {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly priority: NotificationPriority;
  readonly title: string;
  readonly body: string;
  readonly section: NotificationSection;
  readonly entityId?: string | null;
  readonly requiresAction: boolean;
  readonly isReminder: boolean;
  readonly occurredAt: string;
  readonly readAt?: string | null;
  readonly resolvedAt?: string | null;
  readonly desktopDeliveredAt?: string | null;
}

export interface NotificationPreferences {
  readonly desktopEnabled: boolean;
  readonly messagesEnabled: boolean;
  readonly tasksEnabled: boolean;
  readonly approvalsEnabled: boolean;
  readonly tripsEnabled: boolean;
  readonly calendarEnabled: boolean;
  readonly absencesEnabled: boolean;
  readonly zoomEnabled: boolean;
  readonly remindersEnabled: boolean;
}

export type ZoomMeetingStatus =
  | "provisioning"
  | "scheduled"
  | "cancellation_pending"
  | "cancelled"
  | "failed";
export type ZoomMeetingSource = "workspace" | "zoombot";
export type ZoomBusySource = "workspace" | "external";

export interface ZoomMeeting {
  readonly id: string;
  readonly topic: string;
  readonly description: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly durationMinutes: number;
  readonly status: ZoomMeetingStatus;
  readonly source: ZoomMeetingSource;
  readonly organizerUserId?: string | null;
  readonly organizerName: string;
  readonly participantIds: readonly string[];
  /** Connection details are omitted for people outside the meeting. */
  readonly zoomMeetingId?: string | null;
  readonly joinUrl?: string | null;
  readonly passcode?: string | null;
  readonly canEdit: boolean;
  readonly canCancel: boolean;
}

export interface ZoomMeetingInput {
  readonly topic: string;
  readonly description: string;
  readonly startsAt: string;
  readonly durationMinutes: number;
  readonly participantIds: readonly string[];
}

export interface ZoomMeetingsRegistry {
  readonly configured: boolean;
  readonly timezone: string;
  readonly reminderMinutes: number;
  readonly bookingHorizonDays: number;
  readonly slotMinutes: number;
  readonly meetings: readonly ZoomMeeting[];
}

export interface ZoomBusyInterval {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly topic: string;
  readonly source: ZoomBusySource;
  readonly meetingId?: string | null;
}

export interface ZoomAvailability {
  readonly configured: boolean;
  readonly timezone: string;
  readonly slotMinutes: number;
  /** False when the Zoom host calendar could not be read: the day may be incomplete. */
  readonly hostCalendarSynced: boolean;
  readonly intervals: readonly ZoomBusyInterval[];
}

export type AttachmentOwnerType = "message" | "task" | "approval_request" | "absence";

export interface WorkspaceAttachment {
  readonly id: string;
  readonly ownerType: AttachmentOwnerType;
  readonly ownerId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly uploadedByUserId: string;
  readonly documentRole: "general" | "primary" | "additional";
  readonly mediaKind?: "file" | "voice";
  readonly mediaDurationMs?: number | null;
  readonly mediaCodec?: "opus" | null;
  readonly createdAt: string;
}

export type TaskStatus =
  | "new"
  | "in_progress"
  | "awaiting_review"
  | "completed"
  | "overdue"
  | "cancelled";

export type TaskParticipantRole = "co_assignee" | "observer";

export interface TaskParticipant {
  readonly userId: string;
  readonly role: TaskParticipantRole;
}

export interface TaskChecklistItem {
  readonly id: string;
  readonly title: string;
  readonly isCompleted: boolean;
  readonly sortOrder: number;
  readonly createdByUserId: string;
  readonly completedByUserId?: string | null;
  readonly completedAt?: string | null;
  readonly createdAt: string;
}

export interface TaskComment {
  readonly id: string;
  readonly authorUserId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly editedAt?: string | null;
}

export interface TaskDependency {
  readonly dependsOnTaskId: string;
  readonly dependencyKind: "blocks" | "relates";
  readonly title: string;
  readonly status: TaskStatus;
}

export interface TaskCycle {
  readonly id: string;
  readonly title: string;
  readonly scheduleKind: "daily" | "weekly" | "monthly" | "calendar";
  readonly interval: number;
  readonly calendarRule?: "weekdays" | "month_days" | null;
  readonly weekdays?: readonly number[];
  readonly monthDays?: readonly number[];
  readonly timezone: string;
  readonly nextRunAt?: string | null;
  readonly isEnabled: boolean;
}

export interface TaskReturn {
  readonly reasonCode: string;
  readonly reasonText?: string | null;
  readonly actorUserId: string;
  readonly createdAt: string;
}

export interface WorkspaceTask {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly project: string;
  readonly authorId: string;
  readonly assigneeId: string;
  readonly dueLabel: string;
  readonly startsAt?: string | null;
  readonly dueAt?: string | null;
  readonly status: TaskStatus;
  readonly priority: "low" | "normal" | "high" | "urgent";
  readonly checklistDone: number;
  readonly checklistTotal: number;
  readonly sourceMessageId?: string | null;
  readonly resultText?: string | null;
  readonly parentTaskId?: string | null;
  readonly parentTaskTitle?: string | null;
  readonly chatId?: string | null;
  readonly latestReturn?: TaskReturn | null;
  readonly participants: readonly TaskParticipant[];
  readonly checklist: readonly TaskChecklistItem[];
  readonly comments: readonly TaskComment[];
  readonly dependencies: readonly TaskDependency[];
  readonly cycle?: TaskCycle | null;
}

export interface TaskCycleInput {
  readonly title: string;
  readonly scheduleKind: "daily" | "weekly" | "monthly" | "calendar";
  readonly interval: number;
  readonly calendarRule?: "weekdays" | "month_days" | null;
  readonly weekdays?: readonly number[];
  readonly monthDays?: readonly number[];
  readonly timezone?: string;
  readonly nextRunAt?: string | null;
  readonly isEnabled?: boolean;
}

export interface WorkspaceTaskCreateInput {
  readonly title: string;
  readonly description?: string;
  readonly project?: string;
  readonly assigneeId: string;
  readonly sourceMessageId?: string;
  readonly parentTaskId?: string;
  readonly priority?: WorkspaceTask["priority"];
  readonly dueAt?: string;
  readonly participants?: readonly {
    readonly userId: string;
    readonly role: TaskParticipantRole;
  }[];
  readonly checklist?: readonly { readonly title: string }[];
  readonly dependencies?: readonly {
    readonly dependsOnTaskId: string;
    readonly dependencyKind: "blocks" | "relates";
  }[];
  readonly cycle?: TaskCycleInput | null;
}

export type EfficiencyHistoryCompleteness = "complete" | "partial" | "unavailable";

export interface EfficiencyHistoryPoint {
  readonly period: string;
  readonly percentage?: number | null;
  readonly onTimeCount: number;
  readonly eligibleCount: number;
  readonly historyCompleteness: EfficiencyHistoryCompleteness;
}

export interface EmployeeEfficiency {
  readonly userId: string;
  readonly name: string;
  readonly jobTitle: string;
  readonly period: string;
  readonly timezone: string;
  readonly percentage?: number | null;
  readonly onTimeCount: number;
  readonly eligibleCount: number;
  readonly overdueCount: number;
  readonly awaitingReviewCount: number;
  readonly noDueDateCount: number;
  readonly returnedForRevisionCount: number;
  readonly excludedCount: number;
  readonly sampleSize: number;
  readonly methodologyVersion: string;
  readonly trackingStartedAt: string;
  readonly historyCompleteness: EfficiencyHistoryCompleteness;
  readonly smallSample: boolean;
  readonly history: readonly EfficiencyHistoryPoint[];
}

export interface EfficiencyOverview {
  readonly period: string;
  readonly timezone: string;
  readonly methodologyVersion: string;
  readonly trackingStartedAt: string;
  readonly currentUserId: string;
  readonly employees: readonly EmployeeEfficiency[];
}

export type TaskReturnReason =
  | "incomplete_result"
  | "requirements_not_met"
  | "corrections_required"
  | "other";

export type TaskEfficiencyExclusionReason =
  | "cancelled"
  | "external_dependency"
  | "requirements_changed"
  | "duplicate"
  | "other";

export type ProjectStage = "start" | "preparation" | "approval" | "success" | "failure";
export type ProjectStatus = "new" | "in_progress" | "completed";

export interface ProjectStageAction {
  readonly id: string;
  readonly actorUserId: string;
  readonly fromStage?: ProjectStage | null;
  readonly toStage: ProjectStage;
  readonly action: "created" | "moved";
  readonly comment?: string | null;
  readonly createdAt: string;
}

export interface WorkspaceProject {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly managerUserId: string;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
  readonly budget: number;
  readonly spentBudget: number;
  readonly remainingBudget: number;
  readonly currency: "UZS" | "USD" | "EUR";
  readonly status: ProjectStatus;
  readonly stage: ProjectStage;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly canEdit: boolean;
  readonly canMove: boolean;
  readonly history: readonly ProjectStageAction[];
}

export interface ProjectInput {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly managerUserId: string;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
  readonly budget: number;
  readonly spentBudget: number;
  readonly currency: "UZS" | "USD" | "EUR";
}

export type TripStage = "launch" | "manager_approval" | "hr" | "approved" | "rejected";
export type TripStatus = "draft" | "running" | "needs_revision" | "approved" | "rejected";
export type TripAction = "submit" | "approve" | "return" | "reject" | "resubmit";

export interface TripActionHistory {
  readonly id: string;
  readonly actorUserId: string;
  readonly fromStage?: TripStage | null;
  readonly toStage: TripStage;
  readonly action: "created" | TripAction;
  readonly comment?: string | null;
  readonly createdAt: string;
}

export interface TripRequest {
  readonly id: string;
  readonly number: string;
  readonly requesterUserId: string;
  readonly purpose: string;
  readonly destination: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly employeeIds: readonly string[];
  readonly stage: TripStage;
  readonly stageLabel: string;
  readonly status: TripStatus;
  readonly statusLabel: string;
  readonly canEdit: boolean;
  readonly allowedActions: readonly TripAction[];
  readonly actions: readonly TripActionHistory[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finishedAt?: string | null;
}

export interface TripRequestInput {
  readonly purpose: string;
  readonly destination: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly employeeIds: readonly string[];
}

export type ApprovalNodeKind =
  | "start"
  | "approval"
  | "condition"
  | "parallel"
  | "correction"
  | "end";

export interface ApprovalNodeData extends Record<string, unknown> {
  readonly label: string;
  readonly kind: ApprovalNodeKind;
  readonly detail: string;
}

export type ApprovalStatus =
  | "draft"
  | "running"
  | "needs_revision"
  | "approved"
  | "rejected"
  | "cancelled";

export interface ApprovalRequestVersion {
  readonly version: number;
  readonly title: string;
  readonly amount: number;
  readonly currency: string;
  readonly purpose: string;
  readonly details: PaymentRequestDetails;
  readonly attachmentIds: readonly string[];
  readonly editedByUserId: string;
  readonly changeReason: string;
  readonly changeComment?: string | null;
  readonly createdAt: string;
}

export interface ApprovalActionHistory {
  readonly action: string;
  readonly comment?: string | null;
  readonly actorUserId: string;
  readonly delegatedToUserId?: string | null;
  readonly nodeKey: string;
  readonly createdAt: string;
}

export interface ApprovalStage {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly canAct: boolean;
}

export interface ApprovalDeadlineEvent {
  readonly id: string;
  readonly eventType: "reminder" | "overdue" | "escalation";
  readonly recipientUserId: string;
  readonly recipientRole: "approver" | "requester" | "process_owner";
  readonly nodeKey: string;
  readonly thresholdHours: number;
  readonly deadlineAt: string;
  readonly createdAt: string;
}

export interface ApprovalDeadlineControl {
  readonly status: "not_set" | "on_track" | "due_soon" | "overdue" | "finished";
  readonly remainingSeconds?: number | null;
  readonly reminderHoursBefore: readonly number[];
  readonly escalationAfterHours?: number | null;
  readonly nextEventAt?: string | null;
  readonly escalationAt?: string | null;
  readonly events: readonly ApprovalDeadlineEvent[];
}

export interface PaymentRequestDetails {
  readonly transferType?: "Гонорар (с расчетом)" | "Конвертация" | "Другие услуги" | null;
  readonly projectName: string;
  readonly projectCode: string;
  readonly sourceAccount: string;
  readonly destinationAccount: string;
  readonly requestPriority: "normal" | "urgent";
  readonly deadline?: string | null;
  readonly comment: string;
  readonly tripPurpose: string;
  readonly tripStartDate?: string | null;
  readonly tripEndDate?: string | null;
  readonly employeeIds: readonly string[];
  readonly paymentPurpose?: "Мероприятия" | "Гонорары" | "Зарплаты" | "Перелеты" | "Оплата за услуги" | "Другие" | null;
  readonly paymentReason: string;
  readonly responsibleUserId?: string | null;
}

export interface ApprovalRequestSummary {
  readonly id: string;
  readonly workflowId?: string;
  readonly number: string;
  readonly title: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: ApprovalStatus;
  readonly statusLabel: string;
  readonly activeNodeKeys: readonly string[];
  readonly activeStages: readonly ApprovalStage[];
  readonly stageLabel: string;
  readonly requesterId: string;
  readonly responsibleUserId: string;
  readonly sourceTaskId?: string | null;
  readonly purpose: string;
  readonly details: PaymentRequestDetails;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly versions: readonly ApprovalRequestVersion[];
  readonly actions: readonly ApprovalActionHistory[];
  readonly deadlineControl?: ApprovalDeadlineControl;
}

export interface WorkflowNodeDefinition {
  readonly id: string;
  readonly kind: ApprovalNodeKind;
  readonly label: string;
  readonly detail: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly config: Readonly<Record<string, unknown>>;
}

export interface WorkflowEdgeDefinition {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly outcome: string;
  readonly label?: string | null;
  readonly condition: Readonly<Record<string, unknown>>;
  readonly sortOrder: number;
}

export interface WorkflowDefinition {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly status: string;
  readonly publishedVersion?: number | null;
  readonly formSchema: Readonly<Record<string, unknown>>;
  readonly nodes: readonly WorkflowNodeDefinition[];
  readonly edges: readonly WorkflowEdgeDefinition[];
}

export interface WorkspaceBootstrap {
  readonly personalPreferences: PersonalPreferences;
  readonly currentUser: WorkspacePerson;
  readonly moduleAccess: readonly EffectiveModuleAccess[];
  readonly canCreatePaymentRequests: boolean;
  readonly people: readonly WorkspacePerson[];
  readonly positions: readonly WorkflowPosition[];
  readonly chats: readonly ChatSummary[];
  readonly messages: readonly ChatMessage[];
  readonly tasks: readonly WorkspaceTask[];
  readonly requests: readonly ApprovalRequestSummary[];
  readonly requestWorkflows?: readonly WorkflowDefinition[];
  readonly projects: readonly WorkspaceProject[];
  readonly tripRequests: readonly TripRequest[];
  readonly absenceRequests: readonly AbsenceRequest[];
  readonly presenceSummary: readonly PresenceSummaryItem[];
  readonly feedPosts: readonly FeedPost[];
  readonly calendarEvents: readonly CalendarEvent[];
  readonly notifications: readonly WorkspaceNotification[];
  readonly notificationPreferences: NotificationPreferences;
  readonly attachments: readonly WorkspaceAttachment[];
  readonly workflow?: WorkflowDefinition | null;
}

export interface DevelopmentSession {
  readonly accessToken: string;
  readonly tokenType: "bearer";
  readonly user: WorkspacePerson;
}

export interface AuthenticationSession {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly csrfToken?: string;
  readonly tokenType: "bearer";
  readonly expiresIn: number;
  readonly user: WorkspacePerson;
}

export interface InvitationResult {
  readonly id: string;
  readonly username: string;
  readonly fullName: string;
  readonly role: string;
  readonly inviteToken: string;
  readonly expiresAt: string;
}

export interface PasswordResetResult {
  readonly id: string;
  readonly username: string;
  readonly resetToken: string;
  readonly resetTotp: boolean;
  readonly expiresAt: string;
}

export interface TotpSetup {
  readonly secret: string;
  readonly otpauthUri: string;
}

export interface SessionSummary {
  readonly id: string;
  readonly deviceLabel: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly current: boolean;
}

export interface DesktopRelease {
  readonly version: string;
  readonly fileName: string;
  readonly sha512: string;
  readonly sizeBytes: number;
  readonly uploadedAt: string;
  readonly publishedAt: string | null;
}

export interface DesktopUpdatePolicy {
  readonly publishedVersion: string | null;
  readonly minimumVersion: string | null;
  readonly mandatory: boolean;
  readonly updatedAt: string | null;
  readonly release: DesktopRelease | null;
}
