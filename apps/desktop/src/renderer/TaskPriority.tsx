import type { WorkspaceTask } from "@yuksalish/contracts";

export type TaskPriority = WorkspaceTask["priority"];

export const taskPriorityLabels: Readonly<Record<TaskPriority, string>> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  urgent: "Срочный",
};

export function isTaskPriority(value: string): value is TaskPriority {
  return Object.hasOwn(taskPriorityLabels, value);
}

export function TaskPriorityIcon({ priority }: { readonly priority: TaskPriority }) {
  if (priority === "normal") {
    return <svg className={`task-priority-icon priority-${priority}`} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="3.5" cy="8" r="1.4" fill="currentColor" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.4" fill="currentColor" />
    </svg>;
  }

  const activeBars = priority === "low" ? 1 : 3;
  return <svg className={`task-priority-icon priority-${priority}`} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    {[{ x: 2, y: 9, height: 5 }, { x: 6.5, y: 6.5, height: 7.5 }, { x: 11, y: 3.5, height: 10.5 }].map((bar, index) => (
      <rect key={bar.x} x={bar.x} y={bar.y} width="3" height={bar.height} rx="1" fill="currentColor" opacity={index < activeBars ? 1 : 0.22} />
    ))}
  </svg>;
}

export function TaskPriorityIndicator({ priority, className = "", label }: {
  readonly priority: TaskPriority;
  readonly className?: string;
  readonly label?: string;
}) {
  const accessibleLabel = `Приоритет: ${taskPriorityLabels[priority]}`;
  return <span className={["task-priority-indicator", `priority-${priority}`, className].filter(Boolean).join(" ")} role="img" aria-label={accessibleLabel} title={accessibleLabel}>
    <TaskPriorityIcon priority={priority} />
    <span>{label ?? `${taskPriorityLabels[priority]} приоритет`}</span>
  </span>;
}
