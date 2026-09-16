import { useMemo, useState } from "react";

import type { WorkspaceDepartment } from "@yuksalish/contracts";
import { Button, Field, Input } from "@fluentui/react-components";
import { Add20Regular, Building20Regular } from "@fluentui/react-icons";
import { WorkspaceSelect as Select } from "./WorkspaceSelect";

import { createDepartment, updateDepartment } from "./workspace-api";

interface DepartmentManagementProps {
  readonly token: string;
  readonly departments: readonly WorkspaceDepartment[];
  readonly onChanged: (department: WorkspaceDepartment) => void;
}

function orderedDepartments(departments: readonly WorkspaceDepartment[]) {
  const children = new Map<string, WorkspaceDepartment[]>();
  for (const department of departments) {
    const key = department.parentId ?? "root";
    children.set(key, [...(children.get(key) ?? []), department]);
  }
  for (const values of children.values()) values.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const result: { department: WorkspaceDepartment; depth: number }[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string, depth: number) => {
    for (const department of children.get(parentId) ?? []) {
      if (visited.has(department.id)) continue;
      visited.add(department.id);
      result.push({ department, depth });
      visit(department.id, depth + 1);
    }
  };
  visit("root", 0);
  for (const department of departments) {
    if (!visited.has(department.id)) result.push({ department, depth: 0 });
  }
  return result;
}

export function DepartmentManagement({ token, departments, onChanged }: DepartmentManagementProps) {
  const ordered = useMemo(() => orderedDepartments(departments), [departments]);
  const [selectedId, setSelectedId] = useState(departments[0]?.id ?? "");
  const selected = departments.find((item) => item.id === selectedId);
  const invalidParentIds = useMemo(() => {
    const result = new Set<string>(selectedId ? [selectedId] : []);
    let changed = true;
    while (changed) {
      changed = false;
      for (const department of departments) {
        if (department.parentId && result.has(department.parentId) && !result.has(department.id)) {
          result.add(department.id);
          changed = true;
        }
      }
    }
    return result;
  }, [departments, selectedId]);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newParentId, setNewParentId] = useState("");
  const [name, setName] = useState(selected?.name ?? "");
  const [code, setCode] = useState(selected?.code ?? "");
  const [parentId, setParentId] = useState(selected?.parentId ?? "");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  const selectDepartment = (department: WorkspaceDepartment) => {
    setSelectedId(department.id);
    setName(department.name);
    setCode(department.code);
    setParentId(department.parentId ?? "");
    setFeedback("");
  };

  const add = async () => {
    if (!newName.trim() || !newCode.trim() || busy) return;
    setBusy(true);
    setFeedback("");
    try {
      const created = await createDepartment(token, {
        name: newName.trim(),
        code: newCode.trim(),
        parentId: newParentId || undefined,
      });
      onChanged(created);
      selectDepartment(created);
      setNewName("");
      setNewCode("");
      setNewParentId("");
      setFeedback("Подразделение создано.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось создать подразделение");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!selected || !name.trim() || !code.trim() || busy) return;
    setBusy(true);
    setFeedback("");
    try {
      const saved = await updateDepartment(token, selected.id, {
        name: name.trim(),
        code: code.trim(),
        parentId: parentId || null,
      });
      onChanged(saved);
      setFeedback("Подразделение обновлено. Изменение записано в аудит.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось обновить подразделение");
    } finally {
      setBusy(false);
    }
  };

  return <section className="department-management" aria-label="Структура подразделений">
    <header className="directory-subheading"><Building20Regular /><div><h2>Подразделения</h2><p>Иерархия компании и назначение сотрудников</p></div></header>
    {feedback ? <div className="directory-feedback" role="status">{feedback}</div> : null}
    <div className="department-create-grid">
      <Field label="Название"><Input aria-label="Название нового подразделения" value={newName} disabled={busy} onChange={(_, data) => setNewName(data.value)} /></Field>
      <Field label="Код"><Input aria-label="Код нового подразделения" value={newCode} disabled={busy} placeholder="finance" onChange={(_, data) => setNewCode(data.value)} /></Field>
      <Field label="В составе"><Select aria-label="Родитель нового подразделения" value={newParentId} disabled={busy} onChange={(event) => setNewParentId(event.target.value)}><option value="">Корневое подразделение</option>{ordered.map(({ department, depth }) => <option key={department.id} value={department.id}>{"— ".repeat(depth)}{department.name}</option>)}</Select></Field>
      <Button appearance="primary" icon={<Add20Regular />} disabled={busy || !newName.trim() || !newCode.trim()} onClick={() => void add()}>Добавить</Button>
    </div>
    <div className="department-workspace">
      <div className="department-tree" role="list" aria-label="Дерево подразделений">
        {ordered.map(({ department, depth }) => <button key={department.id} type="button" role="listitem" className={department.id === selectedId ? "selected" : ""} style={{ paddingInlineStart: `${14 + depth * 20}px` }} onClick={() => selectDepartment(department)}><strong>{department.name}</strong><small>{department.code} · {department.assignedUsersCount} сотрудников</small></button>)}
      </div>
      {selected ? <div className="department-editor">
        <Field label="Название"><Input aria-label="Название подразделения" value={name} disabled={busy} onChange={(_, data) => setName(data.value)} /></Field>
        <Field label="Код"><Input aria-label="Код подразделения" value={code} disabled={busy} onChange={(_, data) => setCode(data.value)} /></Field>
        <Field label="В составе"><Select aria-label="Родитель подразделения" value={parentId} disabled={busy} onChange={(event) => setParentId(event.target.value)}><option value="">Корневое подразделение</option>{ordered.filter(({ department }) => !invalidParentIds.has(department.id)).map(({ department, depth }) => <option key={department.id} value={department.id}>{"— ".repeat(depth)}{department.name}</option>)}</Select></Field>
        <p>Сотрудников непосредственно в подразделении: <strong>{selected.assignedUsersCount}</strong></p>
        <Button disabled={busy || !name.trim() || !code.trim()} onClick={() => void save()}>Сохранить подразделение</Button>
      </div> : <div className="directory-empty">Создайте первое подразделение.</div>}
    </div>
  </section>;
}
