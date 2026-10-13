import type { TaskPlan } from "@yuksalish/contracts";

export function tasksForPlan<T extends { readonly id: string }>(
  tasks: readonly T[], plans: readonly Pick<TaskPlan, "id" | "taskIds">[], planId: string,
): readonly T[] {
  if (!planId) return tasks;
  const ids = new Set(plans.find((plan) => plan.id === planId)?.taskIds ?? []);
  return tasks.filter((task) => ids.has(task.id));
}
