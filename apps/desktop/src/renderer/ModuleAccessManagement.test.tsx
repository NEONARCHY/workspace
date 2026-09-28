import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryBootstrap } from "@yuksalish/contracts";
import { ModuleAccessManagement } from "./ModuleAccessManagement";
import { workspaceTheme } from "./workspace-theme";
import { setModuleAccessRule, setRegionalAssistantAccess } from "./workspace-api";

vi.mock("./workspace-api", () => ({
  setModuleAccessRule: vi.fn(),
  deleteModuleAccessRule: vi.fn(),
  setRegionalAssistantAccess: vi.fn(),
}));

const directory: DirectoryBootstrap = {
  roles: [{ key: "employee", label: "Сотрудник", description: "" }],
  departments: [
    { id: "central", code: "ca", name: "ЦА", scope: "central", assignedUsersCount: 1 },
    { id: "region", code: "navoi", name: "Навои", scope: "regional", assignedUsersCount: 2 },
  ],
  positions: [], employees: [{
    id: "staff-1", username: "staff", name: "Сотрудник ЦА", role: "employee",
    departmentId: "central", status: "active",
  }],
  modules: [{ key: "assistant", label: "ИИ-ассистент", status: "available" }],
  accessRules: [],
};

describe("regional assistant access", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);

  it("changes all verified regions through one server operation", async () => {
    const changed = vi.fn();
    vi.mocked(setRegionalAssistantAccess).mockResolvedValue([{
      id: "rule-1", subjectType: "department", subjectKey: "region",
      moduleKey: "assistant",
      permissions: { view: false, create: false, edit: false, approve: false, admin: false },
    }]);
    render(<FluentProvider theme={workspaceTheme}><ModuleAccessManagement
      token="test-token" directory={directory} onRuleChanged={changed} onRuleDeleted={vi.fn()}
    /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Отключить всем регионам" }));
    await waitFor(() => expect(setRegionalAssistantAccess).toHaveBeenCalledWith("test-token", false));
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ subjectKey: "region" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 региональных подразделений");
  });

  it("does not offer bulk control before department classification", () => {
    render(<FluentProvider theme={workspaceTheme}><ModuleAccessManagement
      token="test-token" directory={{ ...directory, departments: directory.departments.map((item) => ({ ...item, scope: undefined })) }}
      onRuleChanged={vi.fn()} onRuleDeleted={vi.fn()}
    /></FluentProvider>);
    expect(screen.getByRole("button", { name: "Разрешить всем регионам" })).toBeDisabled();
  });

  it("disables every assistant permission for the selected employee", async () => {
    vi.mocked(setModuleAccessRule).mockResolvedValue({
      id: "rule-staff", subjectType: "user", subjectKey: "staff-1", moduleKey: "assistant",
      permissions: { view: false, create: false, edit: false, approve: false, admin: false },
    });
    render(<FluentProvider theme={workspaceTheme}><ModuleAccessManagement
      token="test-token" directory={directory} onRuleChanged={vi.fn()} onRuleDeleted={vi.fn()}
    /></FluentProvider>);
    fireEvent.change(screen.getByRole("combobox", { name: "Уровень правила доступа" }), {
      target: { value: "user" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отключить сотруднику" }));
    await waitFor(() => expect(setModuleAccessRule).toHaveBeenCalledWith(
      "test-token", "user", "staff-1", "assistant",
      { view: false, create: false, edit: false, approve: false, admin: false },
    ));
  });
});
