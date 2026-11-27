import type { DirectoryBootstrap, ModuleAccessSubject } from "@yuksalish/contracts";

/** One index per server snapshot; keep the first rule, as the previous find did. */
export function indexAccessRules(rules: DirectoryBootstrap["accessRules"]) {
  const index = new Map<string, (typeof rules)[number]>();
  const key = (type: ModuleAccessSubject, subject: string, module: string) => JSON.stringify([type, subject, module]);
  for (const rule of rules) {
    const id = key(rule.subjectType, rule.subjectKey, rule.moduleKey);
    if (!index.has(id)) index.set(id, rule);
  }
  return (type: ModuleAccessSubject, subject: string, module: string) => index.get(key(type, subject, module));
}

/** Cache ancestry independently from rules, including incomplete or cyclic hierarchies. */
export function indexDepartmentLineage(departments: DirectoryBootstrap["departments"]) {
  const byId = new Map(departments.map((item) => [item.id, item]));
  const cache = new Map<string, readonly string[]>();
  return (departmentId?: string): readonly string[] => {
    if (!departmentId) return [];
    const cached = cache.get(departmentId);
    if (cached) return cached;
    const lineage: string[] = [];
    const visited = new Set<string>();
    let current = byId.get(departmentId);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      lineage.unshift(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    cache.set(departmentId, lineage);
    return lineage;
  };
}
