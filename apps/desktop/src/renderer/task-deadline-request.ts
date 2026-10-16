import type { TaskDeadlineRequest, WorkspaceTask } from "@yuksalish/contracts";

export function pendingTaskDeadlineRequest(task: WorkspaceTask): TaskDeadlineRequest | undefined {
  if (["completed", "cancelled"].includes(task.status)) return undefined;
  return task.deadlineRequests?.find((item) => item.status === "pending"
    && Date.parse(item.oldDueAt) === Date.parse(task.dueAt ?? ""));
}

export function needsTaskDeadlineDecision(task: WorkspaceTask, userId: string): boolean {
  return task.authorId === userId && Boolean(pendingTaskDeadlineRequest(task));
}
