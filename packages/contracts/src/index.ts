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
  readonly name: string;
  readonly initials: string;
  readonly role: string;
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
  readonly own?: boolean;
}

export type TaskStatus =
  | "new"
  | "in_progress"
  | "awaiting_review"
  | "completed"
  | "overdue";

export interface WorkspaceTask {
  readonly id: string;
  readonly title: string;
  readonly project: string;
  readonly assigneeId: string;
  readonly dueLabel: string;
  readonly status: TaskStatus;
  readonly priority: "normal" | "high" | "urgent";
  readonly checklistDone: number;
  readonly checklistTotal: number;
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
