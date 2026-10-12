import { useEffect, useState } from "react";
import type { WorkspaceTask } from "@yuksalish/contracts";

export function useTaskDeadlineClock(tasks: readonly WorkspaceTask[]): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const date = new Date(now);
    let next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    for (const task of tasks) {
      if (!task.dueAt || task.status === "completed" || task.status === "cancelled") continue;
      const due = Date.parse(task.dueAt) + 1;
      if (due > now && due < next) next = due;
    }
    const refresh = () => setNow(Date.now());
    const timer = window.setTimeout(refresh, Math.max(1, next - now));
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [tasks, now]);
  return now;
}
