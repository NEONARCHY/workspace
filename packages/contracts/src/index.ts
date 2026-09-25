export const moduleKeys = [
  "crm",
  "tasks",
  "team_overview",
  "payment_requests",
  "ai_referent",
  "ai_hisobot",
  "telegram_access",
  "feed",
  "projects",
  "project_hub",
  "project_funding",
  "trip_approvals",
  "absences",
  "members",
  "hr",
  "messenger",
  "calendar",
  "zoom_meetings",
  "employees",
] as const;

export type ModuleKey = (typeof moduleKeys)[number];
export const navigationKeys = [...moduleKeys, "notifications", "settings"] as const;
export type NavigationKey = (typeof navigationKeys)[number];
export type PersonalChatAction = "pin" | "unpin" | "archive" | "unarchive";
export const interfaceLocales = ["ru", "uz_cyrl", "uz_latn"] as const;
export type InterfaceLocale = (typeof interfaceLocales)[number];
export interface PersonalPreferences {
  readonly pinnedChatIds: readonly string[];
  readonly archivedChatIds: readonly string[];
  readonly navigationOrder: readonly NavigationKey[];
  readonly locale: InterfaceLocale;
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
export type ModuleAccessSubject = "role" | "department" | "position" | "user";

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
  readonly leadUserId?: string | null;
  readonly assignedUsersCount: number;
  readonly memberIds?: readonly string[];
  readonly chatId?: string | null;
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

export interface HrSettings {
  readonly hrUserId?: string | null;
  readonly chairUserId?: string | null;
  readonly accountantUserId?: string | null;
}
export interface HrProfile {
  readonly id: string;
  readonly userId?: string | null;
  readonly fullName: string;
  readonly jobTitle?: string | null;
  readonly employmentDate: string;
  readonly serviceAnchorDate: string;
  readonly serviceYears: number;
  readonly serviceMonths: number;
  readonly serviceDays: number;
  readonly allowancePercent: number;
  readonly employmentStatus: "active" | "terminated";
  readonly terminatedOn?: string | null;
  readonly terminationReason?: string | null;
  readonly hiddenAfterYear: boolean;
  readonly updatedAt: string;
}
export interface HrRegisterItem {
  readonly userId?: string | null;
  readonly fullName: string;
  readonly jobTitle?: string | null;
  readonly serviceYears: number;
  readonly serviceMonths: number;
  readonly serviceDays: number;
  readonly allowancePercent: number;
}
export interface HrRegister {
  readonly id: string;
  readonly period: string;
  readonly version: number;
  readonly status: string;
  readonly returnComment?: string | null;
  readonly createdAt: string;
  readonly submittedAt?: string | null;
  readonly approvedAt?: string | null;
  readonly accountedAt?: string | null;
  readonly items: readonly HrRegisterItem[];
}
export interface HrOverview {
  readonly settings: HrSettings;
  readonly calculatedAt: string;
  readonly profiles: readonly HrProfile[];
  readonly registers: readonly HrRegister[];
}
export interface HrProfileImportRow {
  readonly sourceRow: number;
  readonly fullName: string;
  readonly jobTitle?: string | null;
  readonly employmentDate: string;
  readonly serviceAnchorDate: string;
  readonly serviceYears: number;
  readonly serviceMonths: number;
  readonly serviceDays: number;
  readonly serviceReason: string;
}
export interface HrWorkbookPreview {
  readonly sourceLabel: string;
  readonly controlDate: string;
  readonly rows: readonly HrProfileImportRow[];
}

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
  readonly avatarVersion?: string | null;
}

export type RecognitionTier =
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "sapphire"
  | "amethyst"
  | "prism"
  | "cosmic";
export type RecognitionCategory =
  | "tasks"
  | "projects"
  | "trips"
  | "meetings"
  | "correspondence"
  | "feed"
  | "payment_creation"
  | "payment_completion"
  | "efficiency"
  | "tenure"
  | "communication"
  | "support";

export interface EmployeeAchievement {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly category: RecognitionCategory;
  readonly tier: RecognitionTier;
  readonly iconKey: string;
  readonly progress: number;
  readonly target: number;
  readonly unlocked: boolean;
  readonly earnedAt?: string | null;
}

export interface EmployeeReward {
  readonly id: string;
  readonly iconKey: string;
  readonly title: string;
  readonly description: string;
  readonly recipientUserId: string;
  readonly issuerUserId: string;
  readonly issuerName: string;
  readonly createdAt: string;
}

export interface EmployeeRecognitionProfile {
  readonly person: WorkspacePerson;
  readonly departmentName?: string | null;
  readonly employmentDate?: string | null;
  readonly serviceYears?: number | null;
  readonly serviceMonths?: number | null;
  readonly serviceDays?: number | null;
  readonly activeTaskCount?: number | null;
  readonly activeTaskCountVisible: boolean;
  readonly achievements: readonly EmployeeAchievement[];
  readonly rewards: readonly EmployeeReward[];
  readonly canIssueReward: boolean;
  readonly canManageSettings: boolean;
}

export interface RecognitionSettings {
  readonly activeTaskCountVisible: boolean;
  readonly updatedAt?: string | null;
}

export interface EmployeeRewardInput {
  readonly iconKey: string;
  readonly title: string;
  readonly description: string;
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
  readonly contextType?: string | null;
  readonly contextId?: string | null;
  readonly preview: string;
  readonly time: string;
  readonly unread: number;
  readonly description: string;
  readonly ownerId?: string | null;
  readonly canDelete?: boolean;
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
  readonly canDelete?: boolean;
  readonly reactions?: readonly MessageReaction[];
  readonly isPinned?: boolean;
  readonly pinnedAt?: string | null;
  readonly pinnedByUserId?: string | null;
  readonly canPin?: boolean;
}

export interface LinkPreview {
  readonly url: string;
  readonly canonicalUrl: string;
  readonly kind: "page" | "video" | "youtube" | "instagram";
  readonly title: string;
  readonly description: string;
  readonly siteName: string;
  readonly imageUrl?: string | null;
  readonly embedUrl?: string | null;
}

export type MessageReactionEmoji = string;

export interface MessageReaction {
  readonly emoji: MessageReactionEmoji;
  readonly count: number;
  readonly reactedByCurrentUser: boolean;
  readonly reactorUserIds?: readonly string[];
}

export interface FeedComment {
  readonly id: string;
  readonly authorUserId: string;
  readonly body: string;
  readonly parentCommentId?: string | null;
  readonly reactions?: readonly MessageReaction[];
  readonly canDelete?: boolean;
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
  readonly reactions?: readonly MessageReaction[];
  readonly canEdit: boolean;
  readonly canDelete?: boolean;
  readonly canPin: boolean;
  readonly comments: readonly FeedComment[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CalendarEventType = "meeting" | "deadline" | "trip" | "task" | "general";
export type CalendarAttendanceStatus = "accepted" | "pending" | "declined";

export interface CalendarEventAttendee {
  readonly userId: string;
  readonly status: CalendarAttendanceStatus;
  readonly respondedAt?: string | null;
}

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
  /** Includes the organiser and each invited colleague with their reply state. */
  readonly attendees: readonly CalendarEventAttendee[];
  readonly currentUserAttendanceStatus?: CalendarAttendanceStatus | null;
  readonly canRespond: boolean;
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

export type WorkdayStatus = "working" | "finished" | "approved_absence" | "not_started" | "weekend_off";

export interface WorkdaySchedule {
  readonly userId: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface WorkdaySession {
  readonly id: string;
  readonly userId: string;
  readonly workDate: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly scheduledStartAt: string;
  readonly scheduledEndAt: string;
  readonly closedAt: string | null;
  readonly closeSource: "manual" | "automatic" | null;
  readonly isWeekend: boolean;
}

export interface WorkdayMe {
  readonly status: WorkdayStatus;
  readonly schedule: WorkdaySchedule;
  readonly session: WorkdaySession | null;
  readonly absenceKind: string | null;
  readonly asOf: string;
}

export interface WorkdayTeamMember {
  readonly userId: string;
  readonly name: string;
  readonly jobTitle: string | null;
  readonly status: WorkdayStatus;
  readonly schedule: WorkdaySchedule;
  readonly session: WorkdaySession | null;
  readonly absenceKind: string | null;
  readonly canEditSchedule: boolean;
}

export interface WorkdayTeam {
  readonly asOf: string;
  readonly workingCount: number;
  readonly members: readonly WorkdayTeamMember[];
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
  | "zoom"
  | "hisobot";
export type NotificationPriority = "normal" | "attention" | "urgent";
export type NotificationSection = Extract<
  WorkspaceSection,
  | "messenger"
  | "tasks"
  | "payment_requests"
  | "project_hub"
  | "project_funding"
  | "trip_approvals"
  | "calendar"
  | "absences"
  | "zoom_meetings"
  | "hr"
  | "ai_referent"
  | "ai_hisobot"
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

export type AttachmentOwnerType =
  | "message"
  | "task"
  | "approval_request"
  | "project_funding_request"
  | "absence"
  | "ai_referent_letter";

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

export type AIReferentRoute = "exat" | "webmail";
export type AIReferentStatus =
  | "operator_revision"
  | "awaiting_final_send"
  | "referent_review_pending"
  | "delivery_unknown"
  | "draft"
  | "pending_review"
  | "needs_revision"
  | "approved"
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled"
  | "signed";
export type AIReferentWorkflowKind = "delivery" | "sign_only";
export type AIReferentSource = "workspace" | "telegram" | "import";
export type AIReferentAction =
  | "remind"
  | "replace_document"
  | "mark_sent"
  | "prepare_replacement"
  | "release_delivery"
  | "send"
  | "confirm_sent"
  | "confirm_not_sent"
  | "submit"
  | "approve"
  | "return_for_revision"
  | "cancel"
  | "queue_delivery"
  | "retry_delivery";

export interface AIReferentDocumentCheck {
  readonly id: string;
  readonly status: "pending" | "checking" | "passed" | "failed";
  readonly reviewerKeys: readonly string[];
  readonly detail: string;
}

export interface AIReferentCommentAudio {
  readonly id: string;
  readonly contentType: string;
  readonly durationMs: number;
  readonly byteSize: number;
}

export interface AIReferentEvent {
  readonly id: string;
  readonly eventType: string;
  readonly actorUserId?: string | null;
  readonly actorName: string;
  readonly fromStatus?: AIReferentStatus | null;
  readonly toStatus?: AIReferentStatus | null;
  readonly comment: string;
  readonly audio?: AIReferentCommentAudio | null;
  readonly createdAt: string;
}

export interface AIReferentLetter {
  readonly documentCheck?: AIReferentDocumentCheck | null;
  readonly finalPdfFileId?: string | null;
  readonly canDelete?: boolean;
  readonly canReplaceDocument?: boolean;
  readonly initialReviewerUserId?: string | null;
  readonly finalReviewerUserId?: string | null;
  readonly finalReviewerName?: string | null;
  readonly deliveryError?: string;
  readonly id: string;
  readonly displayNumber?: string | null;
  readonly outgoingNumber?: number | null;
  readonly yearSuffix?: string | null;
  readonly subject: string;
  readonly recipientOrganization: string;
  readonly recipientAddress: string;
  readonly route: AIReferentRoute;
  readonly note: string;
  readonly status: AIReferentStatus;
  readonly workflowKind: AIReferentWorkflowKind;
  readonly source: AIReferentSource;
  readonly createdByUserId: string;
  readonly createdByName: string;
  readonly reviewerUserId?: string | null;
  readonly reviewerName?: string | null;
  readonly revision: number;
  readonly sentAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly attachments: readonly WorkspaceAttachment[];
  readonly events: readonly AIReferentEvent[];
  readonly availableActions: readonly AIReferentAction[];
  readonly canEdit: boolean;
}

export interface AIReferentRegistry {
  readonly letters: readonly AIReferentLetter[];
  readonly totalCount: number;
  readonly pendingReviewCount: number;
  readonly readyCount: number;
  readonly sentCount: number;
  readonly signedCount: number;
}

export interface AIReferentRecipient {
  readonly id: string;
  readonly name: string;
  readonly categoryKey: "ministries" | "agencies" | "committees" | "other" | "international";
  readonly addresses: readonly string[];
  readonly route: AIReferentRoute;
  readonly addressBookOrganization: string;
}

export interface AIReferentRecipientRegistry {
  readonly entries: readonly AIReferentRecipient[];
  readonly totalCount: number;
  readonly updatedAt: string | null;
}

export interface AIReferentLetterInput {
  readonly workflowKind?: AIReferentWorkflowKind;
  readonly finalReviewerUserId?: string | null;
  readonly operationId?: string;
  readonly subject: string;
  readonly recipientOrganization: string;
  readonly recipientAddress: string;
  readonly route: AIReferentRoute;
  readonly note: string;
  readonly reviewerUserId?: string | null;
}

export type AIReferentPacketKind = "incoming" | "outgoing" | "archive" | "journal";
export interface AIReferentPacketFile {
  readonly id: string;
  readonly name: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly source: "packet" | "attachment";
  readonly createdAt: string;
}
export interface AIReferentArchiveLetter {
  readonly id: string;
  readonly displayNumber: string;
  readonly subject: string;
  readonly senderName: string;
  readonly recipientOrganization: string;
  readonly route: string;
  readonly status: string;
  readonly sentAt?: string | null;
}
export interface AIReferentJournalFile {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly byteSize: number;
  readonly createdAt: string;
}

export type AIReferentIncomingSource = "exat" | "webmail" | "import";

export interface AIReferentIncomingLetter {
  readonly id: string;
  readonly agentId: string;
  readonly externalId: string;
  readonly sequenceNumber: string;
  readonly platformIncomingNumber: string;
  readonly senderLetterNumber: string;
  readonly platformIncomingDate?: string | null;
  readonly platformOutgoingDate?: string | null;
  readonly receivedAt?: string | null;
  readonly processedAt?: string | null;
  readonly registeredAt?: string | null;
  readonly senderOrganization: string;
  readonly senderPerson: string;
  readonly subject: string;
  readonly responsibleExternalId: string;
  readonly responsibleDisplayName: string;
  readonly responsibleUserId?: string | null;
  readonly responsibleUserName?: string | null;
  readonly urgency: string;
  readonly hasAttachments: boolean;
  readonly attachmentsCount: number;
  readonly mainDocumentFilename: string;
  readonly platformRecordId: string;
  readonly status: string;
  readonly fallbackUsed: boolean;
  readonly errorMessage: string;
  readonly source: AIReferentIncomingSource;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AIReferentJournal {
  readonly available: boolean;
  readonly fileName?: string | null;
  readonly byteSize?: number | null;
  readonly sha256?: string | null;
  readonly updatedAt?: string | null;
  readonly agentName?: string | null;
}

export type AIReferentReviewerKey = "askar" | "bobur" | "umid" | "davronbek";

export interface AIReferentReviewerBinding {
  readonly key: AIReferentReviewerKey;
  readonly label: string;
  readonly suggestedUsername: string;
  readonly userId: string | null;
  readonly username: string;
  readonly fullName: string;
  readonly telegramId: string | null;
  readonly enabled: boolean;
  readonly accountActive: boolean;
  readonly canApprove: boolean;
}

export interface AIReferentConfiguration {
  readonly revision: number;
  readonly updatedAt: string;
  readonly reviewers: readonly AIReferentReviewerBinding[];
  readonly runtimes: readonly {
    readonly agentId: string;
    readonly agentName: string;
    readonly appliedRevision: number | null;
    readonly appliedAt: string | null;
    readonly lastSeenAt: string;
    readonly error: string | null;
  }[];
}

export interface AIReferentConfigurationUpdate {
  readonly expectedRevision: number;
  readonly reviewers: readonly {
    readonly key: AIReferentReviewerKey;
    readonly username: string;
    readonly telegramId: string | null;
    readonly enabled: boolean;
  }[];
}

export type TelegramBotKey = "ai_referent" | "hisobot" | "takliflar" | "hudud_rating" | "ai_news_reader";

export interface TelegramBotDescriptor {
  readonly key: TelegramBotKey;
  readonly label: string;
  readonly connected: boolean;
}

export interface TelegramAccessPerson {
  readonly userId: string;
  readonly username: string;
  readonly fullName: string;
  readonly jobTitle: string | null;
  readonly telegramId: string | null;
  readonly verified: boolean;
  readonly verificationSource: string | null;
  readonly botKeys: readonly TelegramBotKey[];
  readonly hisobotScope: "central" | "hudud" | null;
  readonly hisobotRegion: string | null;
  readonly hisobotReportRequired: boolean;
  readonly hisobotManager: boolean;
  readonly revision: number;
}

export interface TelegramAccessRegistry {
  readonly bots: readonly TelegramBotDescriptor[];
  readonly people: readonly TelegramAccessPerson[];
}

export interface TelegramAccessUpdate {
  readonly telegramId: string | null;
  readonly botKeys: readonly TelegramBotKey[];
  readonly hisobotScope: "central" | "hudud" | null;
  readonly hisobotRegion: string | null;
  readonly hisobotReportRequired: boolean;
  readonly hisobotManager: boolean;
  readonly expectedRevision: number;
}

export interface HisobotReport {
  readonly id: string;
  readonly userId: string | null;
  readonly telegramId: string;
  readonly employeeKey: string;
  readonly fullName: string;
  readonly position: string;
  readonly reportScope: "central" | "hudud";
  readonly regionName: string | null;
  readonly reportDate: string;
  readonly content: string;
  readonly submittedAt: string;
  readonly isLate: boolean;
  readonly source: "telegram" | "workspace";
}

export interface HisobotUnitReport {
  readonly id: string;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly reporterTelegramId: string;
  readonly reporterEmployeeKey: string;
  readonly reporterName: string;
  readonly reporterPosition: string;
  readonly reportScope: "central" | "hudud";
  readonly regionName: string | null;
  readonly coveredTelegramIds: readonly string[];
  readonly reportDate: string;
  readonly content: string;
  readonly submittedAt: string;
  readonly isLate: boolean;
  readonly source: "telegram" | "workspace";
}

export interface HisobotUnit {
  readonly id: string;
  readonly name: string;
  readonly isLead: boolean;
  readonly memberCount: number;
}

export interface HisobotProfile {
  readonly telegramId: string;
  readonly fullName: string;
  readonly position: string;
  readonly reportScope: "central" | "hudud";
  readonly regionName: string | null;
  readonly reportRequired: boolean;
  readonly managementAccess: boolean;
  readonly absenceKind: "vacation" | "sick_leave" | "personal_time" | null;
  readonly today: string;
  readonly canSubmit: boolean;
  readonly canSubmitUnit?: boolean;
  readonly windowOpensAt: string;
  readonly windowClosesAt: string;
  readonly todayReport: HisobotReport | null;
  readonly unit?: HisobotUnit | null;
  readonly todayUnitReport?: HisobotUnitReport | null;
  readonly coveredByReport?: boolean;
}

export interface AIReferentIncomingRegistry {
  readonly letters: readonly AIReferentIncomingLetter[];
  readonly totalCount: number;
  readonly filteredCount: number;
  readonly registeredCount: number;
  readonly attentionCount: number;
  readonly withAttachmentsCount: number;
  readonly lastSyncAt?: string | null;
  readonly journal: AIReferentJournal;
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
  readonly reactions?: readonly MessageReaction[];
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
  readonly calendarEventId?: string | null;
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
  readonly calendarEventId?: string;
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
  readonly chatId?: string | null;
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

export interface ProjectHubProject {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly managerUserId: string;
  readonly responsibleUserIds: readonly string[];
  readonly approverUserIds: readonly string[];
  readonly startDate?: string | null;
  readonly endDate?: string | null;
  readonly budget: number;
  readonly currency: "UZS" | "USD" | "EUR";
  readonly accessStatus: "open" | "closed";
  readonly lifecycleStatus: "active" | "completed";
  readonly approvedAmount: number;
  readonly canEdit: boolean;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ProjectHubProjectInput = Pick<ProjectHubProject,
  "code" | "title" | "description" | "managerUserId" | "responsibleUserIds" |
  "approverUserIds" | "startDate" | "endDate" | "budget" | "currency" |
  "accessStatus" | "lifecycleStatus">;

export interface ProjectHubWorkstream {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ProjectHubWorkstreamInput = Pick<ProjectHubWorkstream, "title" | "description" | "startDate" | "endDate">;

export interface ProjectHubItemAction {
  readonly actorUserId: string;
  readonly action: "status" | "comment";
  readonly fromStatus?: ProjectHubItem["status"] | null;
  readonly toStatus?: ProjectHubItem["status"] | null;
  readonly comment?: string | null;
  readonly createdAt: string;
}

export interface ProjectHubItem {
  readonly id: string;
  readonly projectId: string;
  readonly workstreamId: string;
  readonly kind: "task" | "event";
  readonly title: string;
  readonly description: string;
  readonly startsAt?: string | null;
  readonly dueAt?: string | null;
  readonly budget: number;
  readonly status: "planned" | "active" | "completed" | "rejected" | "cancelled";
  readonly assigneeUserIds: readonly string[];
  readonly calendarEventId?: string | null;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly requestCount: number;
  readonly approvedRequestCount: number;
  readonly actions: readonly ProjectHubItemAction[];
}

export type ProjectHubItemInput = Pick<ProjectHubItem,
  "workstreamId" | "kind" | "title" | "description" | "startsAt" | "dueAt" | "budget" | "assigneeUserIds">;

export interface ProjectHubRequestAction {
  readonly actorUserId: string;
  readonly action: "submit" | "approve" | "reject";
  readonly step: number;
  readonly comment?: string | null;
  readonly createdAt: string;
}

export interface ProjectHubRequest {
  readonly id: string;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly itemId: string;
  readonly itemTitle: string;
  readonly title: string;
  readonly purpose: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: "pending" | "approved" | "rejected";
  readonly approverUserIds: readonly string[];
  readonly currentStep: number;
  readonly approvalDueAt?: string | null;
  readonly requesterUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly canDecide: boolean;
  readonly actions: readonly ProjectHubRequestAction[];
  readonly attachments: readonly WorkspaceAttachment[];
}

export interface ProjectHubOverview {
  readonly projects: readonly ProjectHubProject[];
  readonly workstreams: readonly ProjectHubWorkstream[];
  readonly items: readonly ProjectHubItem[];
  readonly requests: readonly ProjectHubRequest[];
}

export type TripStage = "launch" | "manager_approval" | "hr" | "approved" | "rejected";
export type TripStatus = "draft" | "running" | "needs_revision" | "approved" | "rejected";
export type TripAction = "submit" | "approve" | "return" | "reject" | "resubmit" | "move";

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
  readonly chatId?: string | null;
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
  readonly calendarEventId?: string | null;
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
  readonly departments: readonly WorkspaceDepartment[];
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
  readonly projectWorkflow?: WorkflowDefinition | null;
  readonly tripWorkflow?: WorkflowDefinition | null;
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
  readonly title: string;
  readonly notes: readonly string[];
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
