import { describe, expect, it } from "vitest";
import { indexAccessRules, indexDepartmentLineage } from "./module-access-index";
import type { ModuleAccessRule } from "@yuksalish/contracts";

describe("access snapshot indices", () => {
  it("keeps subject types separate and preserves first-match semantics", () => {
    const rule: ModuleAccessRule = { id: "one", subjectType: "role", subjectKey: "employee", moduleKey: "tasks", permissions: { view: true, create: false, edit: false, approve: false, admin: false } };
    const lookup = indexAccessRules([rule, { ...rule, id: "duplicate", permissions: { ...rule.permissions, view: false } }, { ...rule, id: "position", subjectType: "position" }]);
    expect(lookup("role", "employee", "tasks")).toBe(rule);
    expect(lookup("position", "employee", "tasks")?.id).toBe("position");
    expect(lookup("user", "employee", "tasks")).toBeUndefined();
  });
  it("returns root-to-leaf ancestry, tolerating cycles and missing parents", () => {
    const base = { code: "qa", name: "QA", assignedUsersCount: 0 };
    const lineage = indexDepartmentLineage([{ ...base, id: "root" }, { ...base, id: "leaf", parentId: "root" }, { ...base, id: "a", parentId: "b" }, { ...base, id: "b", parentId: "a" }, { ...base, id: "orphan", parentId: "missing" }]);
    expect(lineage("leaf")).toEqual(["root", "leaf"]);
    expect(lineage("a")).toEqual(["b", "a"]);
    expect(lineage("orphan")).toEqual(["orphan"]);
    expect(lineage("missing")).toEqual([]);
    expect(lineage()).toEqual([]);
  });
});
