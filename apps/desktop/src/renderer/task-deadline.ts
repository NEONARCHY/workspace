import type { WorkspaceTask } from "@yuksalish/contracts";

type DeadlineTask = Pick<WorkspaceTask, "status" | "dueAt">;

export function taskDeadlineLabel(task: Pick<WorkspaceTask, "dueAt" | "dueLabel">): string {
  const due = task.dueAt ? new Date(task.dueAt) : undefined;
  return due && Number.isFinite(due.getTime()) ? due.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }) : task.dueLabel;
}

export function isTaskOverdue(task: DeadlineTask, now: number): boolean {
  if (task.status === "completed" || task.status === "cancelled") return false;
  return task.status === "overdue" || Boolean(task.dueAt && Date.parse(task.dueAt) < now);
}

export function taskDeadlineTone(task: DeadlineTask, now: number): "warning" | "danger" | undefined {
  if (task.status === "completed" || task.status === "cancelled") return undefined;
  if (isTaskOverdue(task, now)) return "danger";
  if (!task.dueAt) return undefined;
  const due = new Date(task.dueAt), today = new Date(now);
  if (!Number.isFinite(due.getTime())) return undefined;
  // Compare local calendar dates, not 24-hour buckets (including DST changes).
  const day = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = (day(due) - day(today)) / 86_400_000;
  return days <= 1 ? "danger" : days === 2 ? "warning" : undefined;
}
