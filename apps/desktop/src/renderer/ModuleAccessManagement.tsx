import { useMemo, useState } from "react";

import type { DirectoryBootstrap, ModuleAccessRule, ModuleAccessSubject, ModulePermissionSet } from "@yuksalish/contracts";
import { Button, Checkbox } from "@fluentui/react-components";
import { LockClosed20Regular } from "@fluentui/react-icons";
import { WorkspaceSelect as Select } from "./WorkspaceSelect";

import { deleteModuleAccessRule, setModuleAccessRule } from "./workspace-api";

const actionLabels: { key: keyof ModulePermissionSet; label: string }[] = [
  { key: "view", label: "Просмотр" },
  { key: "create", label: "Создание" },
  { key: "edit", label: "Изменение" },
  { key: "approve", label: "Согласование" },
  { key: "admin", label: "Настройка" },
];

function defaults(role = "employee", moduleKey = ""): ModulePermissionSet {
  const admin = role === "admin" || role === "superadmin";
  if (moduleKey === "team_overview" && !admin) {
    return { view: false, create: false, edit: false, approve: false, admin: false };
  }
  return { view: true, create: true, edit: true, approve: true, admin };
}

function matchingRule(
  directory: DirectoryBootstrap,
  subjectType: ModuleAccessSubject,
  subjectKey: string,
  moduleKey: string,
) {
  return directory.accessRules.find((rule) => rule.subjectType === subjectType && rule.subjectKey === subjectKey && rule.moduleKey === moduleKey);
}

function departmentLineage(directory: DirectoryBootstrap, departmentId?: string) {
  const byId = new Map(directory.departments.map((department) => [department.id, department]));
  const lineage: string[] = [];
  const visited = new Set<string>();
  let current = departmentId ? byId.get(departmentId) : undefined;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    lineage.unshift(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return lineage;
}

interface ModuleAccessManagementProps {
  readonly token: string;
  readonly directory: DirectoryBootstrap;
  readonly onRuleChanged: (rule: ModuleAccessRule) => void;
  readonly onRuleDeleted: (subjectType: ModuleAccessSubject, subjectKey: string, moduleKey: string) => void;
}

export function ModuleAccessManagement({ token, directory, onRuleChanged, onRuleDeleted }: ModuleAccessManagementProps) {
  const [subjectType, setSubjectType] = useState<ModuleAccessSubject>("role");
  const [subjectKey, setSubjectKey] = useState("employee");
  const [busyKey, setBusyKey] = useState("");
  const [feedback, setFeedback] = useState("");
  const subjects = useMemo(() => subjectType === "role"
    ? directory.roles.map((item) => ({ key: item.key, label: item.label }))
    : subjectType === "department"
      ? directory.departments.map((item) => ({ key: item.id, label: item.name }))
      : subjectType === "position"
        ? directory.positions.filter((item) => item.isActive).map((item) => ({ key: item.id, label: item.name }))
      : directory.employees.filter((item) => item.role !== "superadmin").map((item) => ({ key: item.id, label: item.name })), [directory, subjectType]);
  const selectedKey = subjects.some((item) => item.key === subjectKey) ? subjectKey : subjects[0]?.key ?? "";
  const selectedEmployee = directory.employees.find((item) => item.id === selectedKey);

  const selectType = (value: ModuleAccessSubject) => {
    setSubjectType(value);
    const next = value === "role" ? directory.roles[0]?.key
      : value === "department" ? directory.departments[0]?.id
      : value === "position" ? directory.positions.find((item) => item.isActive)?.id
      : directory.employees.find((item) => item.role !== "superadmin")?.id;
    setSubjectKey(next ?? "");
    setFeedback("");
  };

  const explicitRule = (moduleKey: string) => matchingRule(directory, subjectType, selectedKey, moduleKey);
  const inherited = (moduleKey: string) => {
    if (subjectType === "role") return defaults(selectedKey, moduleKey);
    const role = subjectType === "user" ? selectedEmployee?.role ?? "employee" : "employee";
    let permissions = defaults(role, moduleKey);
    const roleRule = matchingRule(directory, "role", role, moduleKey);
    if (roleRule) permissions = roleRule.permissions;
    const departmentId = subjectType === "department" ? selectedKey : selectedEmployee?.departmentId ?? undefined;
    const lineage = departmentLineage(directory, departmentId);
    const inheritedDepartments = subjectType === "department" ? lineage.filter((id) => id !== selectedKey) : lineage;
    for (const id of inheritedDepartments) {
      const rule = matchingRule(directory, "department", id, moduleKey);
      if (rule) permissions = rule.permissions;
    }
    if (subjectType === "user" && selectedEmployee?.positionId) {
      const positionRule = matchingRule(directory, "position", selectedEmployee.positionId, moduleKey);
      if (positionRule) permissions = positionRule.permissions;
    }
    return permissions;
  };

  const save = async (moduleKey: string, permissions: ModulePermissionSet) => {
    if (!selectedKey || busyKey) return;
    setBusyKey(moduleKey);
    setFeedback("");
    try {
      const saved = await setModuleAccessRule(token, subjectType, selectedKey, moduleKey, permissions);
      onRuleChanged(saved);
      setFeedback("Права сохранены и уже применяются сервером.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось сохранить права");
    } finally {
      setBusyKey("");
    }
  };

  const reset = async (moduleKey: string) => {
    if (!selectedKey || busyKey) return;
    setBusyKey(moduleKey);
    setFeedback("");
    try {
      await deleteModuleAccessRule(token, subjectType, selectedKey, moduleKey);
      onRuleDeleted(subjectType, selectedKey, moduleKey);
      setFeedback("Собственное правило удалено: снова действует наследование.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось вернуть наследование");
    } finally {
      setBusyKey("");
    }
  };

  return <section className="module-access-management" aria-label="Модульные разрешения">
    <header className="directory-subheading"><LockClosed20Regular /><div><h2>Права модулей</h2><p>Приоритет: роль → подразделение → персональное исключение</p></div></header>
    <div className="access-subject-controls">
      <label>Уровень<Select aria-label="Уровень правила доступа" value={subjectType} disabled={!!busyKey} onChange={(event) => selectType(event.target.value as ModuleAccessSubject)}><option value="role">Роль</option><option value="department">Подразделение</option><option value="position">Должность</option><option value="user">Сотрудник</option></Select></label>
      <label>Кому<Select aria-label="Получатель правила доступа" value={selectedKey} disabled={!!busyKey || !subjects.length} onChange={(event) => setSubjectKey(event.target.value)}>{subjects.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</Select></label>
    </div>
    {feedback ? <div className="directory-feedback" role="status">{feedback}</div> : null}
    {!subjects.length ? <div className="directory-empty">Для этого уровня пока нет записей.</div> : <div className="access-matrix" role="table" aria-label="Матрица разрешений">
      <div className="access-matrix-row access-matrix-head" role="row"><span>Модуль</span>{actionLabels.map((action) => <span key={action.key}>{action.label}</span>)}<span>Источник</span></div>
      {directory.modules.map((module) => {
        const rule = explicitRule(module.key);
        const permissions = rule?.permissions ?? inherited(module.key);
        return <div className="access-matrix-row" role="row" key={module.key}>
          <span><strong>{module.label}</strong><small>{module.status === "placeholder" ? "Пока не используется" : module.key}</small></span>
          {actionLabels.map((action) => <Checkbox key={action.key} aria-label={`${module.label}: ${action.label}`} checked={permissions[action.key]} disabled={busyKey === module.key} onChange={(_, data) => void save(module.key, { ...permissions, [action.key]: data.checked === true })} />)}
          <span className="access-rule-source">{rule ? <Button size="small" appearance="subtle" disabled={busyKey === module.key} onClick={() => void reset(module.key)}>Своё · сбросить</Button> : <Button size="small" appearance="subtle" disabled={busyKey === module.key} onClick={() => void save(module.key, permissions)}>Наследуется</Button>}</span>
        </div>;
      })}
    </div>}
    <p className="access-help">«Просмотр» скрывает страницу и блокирует её API. «Создание», «Изменение», «Согласование» и «Настройка» задают доступные действия; должность применяется после подразделения, а персональное правило остаётся самым приоритетным. Объектные ограничения — например, участие в задаче или назначение согласующим — продолжают действовать дополнительно.</p>
  </section>;
}
