export const moduleKeys = [
  "crm",
  "tasks",
  "payment_requests",
  "feed",
  "projects",
  "trip_approvals",
  "messenger",
  "calendar",
  "employees",
] as const;

export type ModuleKey = (typeof moduleKeys)[number];
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
  readonly positionId?: string | null;
  readonly jobTitle?: string | null;
  readonly status: string;
}

export interface DirectoryBootstrap {
  readonly roles: readonly RoleDescriptor[];
  readonly positions: readonly WorkspacePosition[];
  readonly employees: readonly DirectoryEmployee[];
}

export interface WorkspacePerson {
  readonly id: string;
  readonly username?: string;
  readonly name: string;
  readonly initials: string;
  readonly role: string;
  readonly positionId?: string | null;
  readonly jobTitle?: string | null;
  readonly color: string;
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

export type NotificationKind = "message" | "task" | "approval" | "trip" | "calendar";
export type NotificationPriority = "normal" | "attention" | "urgent";
export type NotificationSection = Extract<
  WorkspaceSection,
  "messenger" | "tasks" | "payment_requests" | "trip_approvals" | "calendar"
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
  readonly remindersEnabled: boolean;
}

export type AttachmentOwnerType = "message" | "task" | "approval_request";

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
  readonly scheduleKind: "daily" | "weekly" | "monthly";
  readonly interval: number;
  readonly timezone: string;
  readonly nextRunAt?: string | null;
  readonly isEnabled: boolean;
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
  readonly participants: readonly TaskParticipant[];
  readonly checklist: readonly TaskChecklistItem[];
  readonly comments: readonly TaskComment[];
  readonly dependencies: readonly TaskDependency[];
  readonly cycle?: TaskCycle | null;
}

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
  readonly currentUser: WorkspacePerson;
  readonly canCreatePaymentRequests: boolean;
  readonly people: readonly WorkspacePerson[];
  readonly positions: readonly WorkflowPosition[];
  readonly chats: readonly ChatSummary[];
  readonly messages: readonly ChatMessage[];
  readonly tasks: readonly WorkspaceTask[];
  readonly requests: readonly ApprovalRequestSummary[];
  readonly projects: readonly WorkspaceProject[];
  readonly tripRequests: readonly TripRequest[];
  readonly feedPosts: readonly FeedPost[];
  readonly calendarEvents: readonly CalendarEvent[];
  readonly notifications: readonly WorkspaceNotification[];
  readonly notificationPreferences: NotificationPreferences;
  readonly attachments: readonly WorkspaceAttachment[];
  readonly workflow: WorkflowDefinition;
}

export interface DevelopmentSession {
  readonly accessToken: string;
  readonly tokenType: "bearer";
  readonly user: WorkspacePerson;
}

export interface AuthenticationSession {
  readonly accessToken: string;
  readonly refreshToken: string;
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
