// Isolated real-component fixture. The runner intercepts all API traffic.
import "./admin-iteration-14-styles.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Button, DialogSurface } from "@fluentui/react-components";
import { Dismiss20Regular } from "@fluentui/react-icons";
import type { DirectoryBootstrap, ModuleAccessRule, WorkspaceDepartment } from "@yuksalish/contracts";
import { FluentProvider } from "@fluentui/react-components";
import { workspaceDarkTheme, workspaceTheme } from "../src/renderer/workspace-theme";
import { WorkspaceDialog } from "../src/renderer/WorkspaceDialog";
import { EmployeeProfileProvider } from "../src/renderer/EmployeeProfileLink";
import { WorkspacePeopleProvider } from "../src/renderer/WorkspaceSelect";
import { ModuleAccessManagement } from "../src/renderer/ModuleAccessManagement";
import { DepartmentManagement } from "../src/renderer/DepartmentManagement";
import { SidebarVisibilityManagement } from "../src/renderer/SidebarVisibilityManagement";
import { fallbackModules } from "../src/renderer/module-catalog";

const parameters = new URLSearchParams(location.search);
const dark = parameters.get("theme") !== "light";
document.documentElement.dataset.colorTheme = dark ? "dark" : "light";
document.documentElement.classList.add("web-platform");
const departments: WorkspaceDepartment[] = [
  { id: "qa-central", code: "central", name: "Центральный аппарат", scope: "central", assignedUsersCount: 120, memberIds: ["qa-staff-0", "qa-staff-1"], leadUserId: "qa-staff-0", iconKey: "building" },
  { id: "qa-programs", code: "programs", name: "Управление региональных программ и общественных инициатив", parentId: "qa-central", scope: "central", assignedUsersCount: 24, memberIds: [], iconKey: "building" },
  { id: "qa-finance", code: "finance", name: "Финансовый отдел", parentId: "qa-central", scope: "central", assignedUsersCount: 8, memberIds: [], iconKey: "building" },
  ...Array.from({ length: 12 }, (_, i) => ({ id: `qa-region-${i}`, code: `region-${i}`, name: ["Самаркандское региональное подразделение", "Бухарское региональное подразделение", "Навоийское региональное подразделение"][i % 3]! + ` ${i + 1}`, scope: "regional" as const, assignedUsersCount: 5, memberIds: [], iconKey: "building" as const })),
];
const directory: DirectoryBootstrap = {
  roles: [{ key: "employee", label: "Сотрудник", description: "" }, { key: "manager", label: "Руководитель", description: "" }, { key: "admin", label: "Администратор", description: "" }],
  departments,
  positions: Array.from({ length: 18 }, (_, i) => ({ id: `qa-position-${i}`, name: ["Руководитель отдела региональных программ", "Главный специалист", "Координатор проектов"][i % 3]! + ` ${i + 1}`, isActive: true, assignedUsersCount: 10 })),
  employees: Array.from({ length: 180 }, (_, i) => ({ id: `qa-staff-${i}`, username: `qa.staff.${i}`, name: ["Азиза Каримова", "Бахтиёр Самадов", "Малика Нурова", "Дилшод Рахимов"][i % 4]! + ` ${i + 1}`, role: "employee", status: "active", departmentId: i < 120 ? "qa-central" : `qa-region-${i % 12}`, positionId: `qa-position-${i % 18}`, jobTitle: i % 3 ? "Главный специалист" : "Координатор региональных программ", avatarVersion: null })),
  modules: fallbackModules.map(module => ({ key: module.key, label: module.label.ru, status: module.status })),
  accessRules: [{ id: "qa-rule-tasks", subjectType: "role", subjectKey: "employee", moduleKey: "tasks", permissions: { view: true, create: true, edit: true, approve: false, admin: false } }],
};
Object.assign(window, { adminIteration14Data: directory });

function Fixture() {
  const [data, setData] = useState(directory);
  const [open, setOpen] = useState(true);
  const section = parameters.get("section") || "access";
  const onChanged = (department: WorkspaceDepartment) => setData(current => ({ ...current,
    departments: current.departments.some(item => item.id === department.id) ? current.departments.map(item => item.id === department.id ? department : item) : [...current.departments, department],
  }));
  const ruleChanged = (rule: ModuleAccessRule) => setData(current => ({ ...current,
    accessRules: [...current.accessRules.filter(item => !(item.subjectType === rule.subjectType && item.subjectKey === rule.subjectKey && item.moduleKey === rule.moduleKey)), rule],
  }));
  return <FluentProvider className="app-provider" theme={dark ? workspaceDarkTheme : workspaceTheme} style={{ minHeight: "100dvh", background: "var(--ws-muted-surface)", padding: 12 }}>
    <EmployeeProfileProvider onOpenProfile={() => undefined}><WorkspacePeopleProvider people={[]}>
      {!open && <Button onClick={() => setOpen(true)}>Открыть</Button>}
      {section === "sidebar" ? open && <SidebarVisibilityManagement token="qa-synthetic-only" directory={data} currentUser={{ id: "qa-admin", name: "Администратор", role: "admin", initials: "А", color: "brand" }} onClose={() => setOpen(false)} /> :
        <WorkspaceDialog open={open} onOpenChange={(_, state) => setOpen(state.open)}><DialogSurface className={`directory-management-dialog${section === "access" ? " access-dialog" : ""}`} aria-label={section === "access" ? "Права модулей" : "Подразделения"}>
          <div className="record-dialog-close"><Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть окно" onClick={() => setOpen(false)} /></div>
          {section === "access" ? <ModuleAccessManagement token="qa-synthetic-only" directory={data} onRuleChanged={ruleChanged} onRuleDeleted={(type, key, module) => setData(current => ({ ...current, accessRules: current.accessRules.filter(item => !(item.subjectType === type && item.subjectKey === key && item.moduleKey === module)) }))} /> :
            <DepartmentManagement token="qa-synthetic-only" departments={data.departments} employees={data.employees} onChanged={onChanged} onDeleted={id => setData(current => ({ ...current, departments: current.departments.filter(item => item.id !== id) }))} />}
        </DialogSurface></WorkspaceDialog>}
    </WorkspacePeopleProvider></EmployeeProfileProvider>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
