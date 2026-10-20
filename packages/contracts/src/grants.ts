import type { WorkspaceAttachment } from "./index";

export type GrantStatus = "in_progress" | "needs_revision" | "author_review" | "leader_review" | "chair_review" | "completed";
export interface GrantFields {
  readonly title: string;
  readonly description: string;
  readonly assigneeId: string;
  readonly coAssigneeIds: readonly string[];
  readonly dueAt: string;
  readonly checklist: readonly string[];
}
export interface GrantChecklistItem {
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
  readonly completedByUserId: string | null;
  readonly completedAt: string | null;
}
export interface GrantSummary extends Omit<GrantFields, "checklist"> {
  readonly id: string;
  readonly authorUserId: string;
  readonly leaderUserId: string;
  readonly chairUserId: string;
  readonly status: GrantStatus;
  readonly revision: number;
  readonly checklist: readonly GrantChecklistItem[];
  readonly resultText: string;
  readonly chatId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly allowedActions: readonly string[];
}
export interface GrantEvent {
  readonly id: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly text: string;
  readonly fromStatus: GrantStatus;
  readonly toStatus: GrantStatus;
  readonly createdAt: string;
}
export interface GrantDetail extends GrantSummary {
  readonly events: readonly GrantEvent[];
  readonly attachments: readonly WorkspaceAttachment[];
}
export interface GrantSettings {
  readonly leaderUserId: string | null;
  readonly chairUserId: string | null;
  readonly revision: number;
}
export interface GrantAction {
  readonly action: "submit" | "approve" | "return" | "comment" | "check";
  readonly expectedRevision: number;
  readonly text?: string;
  readonly itemId?: string;
  readonly completed?: boolean;
}
