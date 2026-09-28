import { describe, expect, it } from "vitest";
import { employeeScope } from "./employee-scope";
import type { WorkspaceDepartment } from "@yuksalish/contracts";

const departments: WorkspaceDepartment[] = [
  { id: "central", code: "central", name: "ЦА", scope: "central", assignedUsersCount: 1 },
  { id: "regional", code: "regional", name: "Регион", scope: "regional", assignedUsersCount: 1 },
  { id: "regional-child", code: "child", name: "Подотдел", scope: "central", parentId: "regional", assignedUsersCount: 1 },
];

describe("employee scope", () => {
  it("keeps central and regional employees in exclusive groups", () => {
    expect(employeeScope("central", departments)).toBe("central");
    expect(employeeScope("regional", departments)).toBe("regional");
    expect(employeeScope("regional-child", departments)).toBe("regional");
  });
  it("keeps an unassigned employee visible in the central directory", () => {
    expect(employeeScope(null, departments)).toBe("central");
  });
});
