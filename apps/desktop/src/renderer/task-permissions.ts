import type { WorkspacePerson } from "@yuksalish/contracts";

// Mirror repository._task_access_row / position_policy.is_executive_leader.
// The chairman can read all tasks, but edit/manage rights depend on participation.
// Keep the exact title comparison: the calendar's broader title aliases do not apply here.
const executiveLeaderPosition = '"Yuksalish" harakati raisi, Qonunchilik palatasi qo\'mita raisi';

export function canManageAnyTask(person: WorkspacePerson | undefined): boolean {
  if (!person) return false;
  if (person.role === "admin" || person.role === "superadmin") return true;
  return person.role === "manager"
    && (person.jobTitle ?? "").trim().toLowerCase() !== executiveLeaderPosition.toLowerCase();
}
