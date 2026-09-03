export const moduleKeys = ["messenger", "tasks", "requests", "hisobot"] as const;

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

export type WorkspaceSection = "messenger" | "tasks" | "approvals";

export interface WorkspacePerson {
  readonly id: string;
  readonly username?: string;
  readonly name: string;
  readonly initials: string;
  readonly role: string;
  readonly jobTitle?: string | null;
  readonly color: string;
}

export interface ChatSummary {
  readonly id: string;
  readonly title: string;
  readonly kind: "direct" | "group" | "department" | "project" | "task" | "approval";
  readonly preview: string;
  readonly time: string;
  readonly unread: number;
}

export interface ChatMessage {
  readonly id: string;
  readonly chatId: string;
  readonly authorId: string;
  readonly body: string;
  readonly time: string;
  readonly createdAt?: string;
  readonly own?: boolean;
}

export type TaskStatus =
  | "new"
  | "in_progress"
  | "awaiting_review"
  | "completed"
  | "overdue"
  | "cancelled";

export interface WorkspaceTask {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly project: string;
  readonly assigneeId: string;
  readonly dueLabel: string;
  readonly status: TaskStatus;
  readonly priority: "normal" | "high" | "urgent";
  readonly checklistDone: number;
  readonly checklistTotal: number;
  readonly sourceMessageId?: string | null;
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

export interface ApprovalRequestSummary {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: ApprovalStatus;
  readonly statusLabel: string;
  readonly activeNodeKeys: readonly string[];
  readonly requesterId: string;
  readonly sourceTaskId?: string | null;
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
  readonly nodes: readonly WorkflowNodeDefinition[];
  readonly edges: readonly WorkflowEdgeDefinition[];
}

export interface WorkspaceBootstrap {
  readonly currentUser: WorkspacePerson;
  readonly people: readonly WorkspacePerson[];
  readonly chats: readonly ChatSummary[];
  readonly messages: readonly ChatMessage[];
  readonly tasks: readonly WorkspaceTask[];
  readonly requests: readonly ApprovalRequestSummary[];
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
