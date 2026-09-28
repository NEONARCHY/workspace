import type { WorkspaceDepartment } from "@yuksalish/contracts";

export type EmployeeScope = NonNullable<WorkspaceDepartment["scope"]>;

const indexes = new WeakMap<readonly WorkspaceDepartment[], {
  readonly byId: Map<string, WorkspaceDepartment>;
  readonly resolved: Map<string, EmployeeScope>;
}>();

export function employeeScope(
  departmentId: string | null | undefined,
  departments: readonly WorkspaceDepartment[],
): EmployeeScope {
  if (!departmentId) return "central";
  let index = indexes.get(departments);
  if (!index) {
    index = {
      byId: new Map(departments.map((department) => [department.id, department])),
      resolved: new Map(),
    };
    indexes.set(departments, index);
  }
  const cached = index.resolved.get(departmentId);
  if (cached) return cached;
  const visited = new Set<string>();
  let current = index.byId.get(departmentId);
  let scope: EmployeeScope = "central";
  while (current && !visited.has(current.id)) {
    if (current.scope === "regional") { scope = "regional"; break; }
    const known = index.resolved.get(current.id);
    if (known) { scope = known; break; }
    visited.add(current.id);
    current = current.parentId ? index.byId.get(current.parentId) : undefined;
  }
  for (const id of visited) index.resolved.set(id, scope);
  index.resolved.set(departmentId, scope);
  return scope;
}
