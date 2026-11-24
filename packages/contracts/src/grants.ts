import type { WorkspaceAttachment } from "./index";

export type GrantStatus = "launch_review" | "launch_revision" | "launch_rejected" | "in_progress" | "needs_revision" | "author_review" | "leader_review" | "chair_review" | "completed";
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
  readonly authorUserId: string | null;
  readonly initiatorUserId: string;
  readonly workflowVersion: 1 | 2;
  readonly launchApprovedAt: string | null;
  readonly launchApprovedByUserId: string | null;
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
  readonly pendingDeadlineRequest?: GrantDeadlineRequest | null;
}
export interface GrantEvent {
  readonly id: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly text: string;
  readonly fromStatus: GrantStatus;
  readonly toStatus: GrantStatus;
  readonly createdAt: string;
  readonly oldDueAt?: string | null;
  readonly dueAt?: string | null;
}
export interface GrantDeadlineRequest {
  readonly id: string;
  readonly requestedByUserId: string;
  readonly oldDueAt: string;
  readonly dueAt: string;
  readonly reason: string;
  readonly status: "pending" | "approved" | "rejected" | "superseded";
  readonly decidedByUserId: string | null;
  readonly decisionReason: string;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}
export interface GrantDetail extends GrantSummary {
  readonly events: readonly GrantEvent[];
  readonly attachments: readonly WorkspaceAttachment[];
  readonly deadlineRequests?: readonly GrantDeadlineRequest[];
}
export interface GrantSettings {
  readonly leaderUserId: string | null;
  readonly chairUserId: string | null;
  readonly revision: number;
}
export interface GrantAction {
  readonly action: "submit" | "approve" | "return" | "comment" | "check" | "approve_launch" | "return_launch" | "reject_launch" | "submit_launch" | "extend_deadline" | "request_deadline" | "approve_deadline" | "reject_deadline";
  readonly expectedRevision: number;
  readonly text?: string;
  readonly itemId?: string;
  readonly completed?: boolean;
  readonly dueAt?: string;
  readonly requestId?: string;
}
