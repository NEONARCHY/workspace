import { useMemo, useState } from "react";
import type { DirectoryEmployee, WorkspaceDepartment } from "@yuksalish/contracts";
import { Avatar, Button, Checkbox, Field, Input } from "@fluentui/react-components";
import { Add20Regular, Building20Regular, PeopleTeam20Regular, Search20Regular } from "@fluentui/react-icons";
import { WorkspaceSelect as Select } from "./WorkspaceSelect";
import { createDepartment, updateDepartment, updateDepartmentMembers } from "./workspace-api";
import { EmployeeProfileLink } from "./EmployeeProfileLink";

interface Props { readonly token: string; readonly departments: readonly WorkspaceDepartment[]; readonly employees: readonly DirectoryEmployee[]; readonly onChanged: (value: WorkspaceDepartment) => void }

export function normalizeDepartmentCode(value: string): string {
  return value.toLocaleLowerCase("en-US")
    .replace(/\s+/gu, "-")
    .replace(/[^a-z0-9_-]/gu, "")
    .replace(/^[^a-z0-9]+/u, "")
    .slice(0, 64);
}

function orderedDepartments(departments: readonly WorkspaceDepartment[]) {
  const children = new Map<string, WorkspaceDepartment[]>();
  for (const item of departments) { const key = item.parentId ?? "root"; children.set(key, [...(children.get(key) ?? []), item]); }
  for (const values of children.values()) values.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const result: { department: WorkspaceDepartment; depth: number }[] = []; const visited = new Set<string>();
  const visit = (parentId: string, depth: number) => { for (const item of children.get(parentId) ?? []) { if (visited.has(item.id)) continue; visited.add(item.id); result.push({ department: item, depth }); visit(item.id, depth + 1); } };
  visit("root", 0); for (const item of departments) if (!visited.has(item.id)) result.push({ department: item, depth: 0 }); return result;
}

export function DepartmentManagement({ token, departments, employees, onChanged }: Props) {
  const ordered = useMemo(() => orderedDepartments(departments), [departments]);
  const [selectedId, setSelectedId] = useState(departments[0]?.id ?? ""); const selected = departments.find((item) => item.id === selectedId);
  const [newName, setNewName] = useState(""); const [newCode, setNewCode] = useState(""); const [newParentId, setNewParentId] = useState("");
  const [name, setName] = useState(selected?.name ?? ""); const [code, setCode] = useState(selected?.code ?? ""); const [parentId, setParentId] = useState(selected?.parentId ?? "");
  const [memberIds, setMemberIds] = useState<ReadonlySet<string>>(new Set(selected?.memberIds ?? [])); const [memberQuery, setMemberQuery] = useState("");
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState("");
  const invalidParentIds = useMemo(() => { const result = new Set<string>(selectedId ? [selectedId] : []); let changed = true; while (changed) { changed = false; for (const item of departments) if (item.parentId && result.has(item.parentId) && !result.has(item.id)) { result.add(item.id); changed = true; } } return result; }, [departments, selectedId]);
  const visibleEmployees = employees.filter((employee) => employee.status === "active" && (!memberQuery.trim() || `${employee.name} ${employee.jobTitle ?? ""}`.toLocaleLowerCase("ru").includes(memberQuery.trim().toLocaleLowerCase("ru"))));
  const selectDepartment = (item: WorkspaceDepartment) => { setSelectedId(item.id); setName(item.name); setCode(item.code); setParentId(item.parentId ?? ""); setMemberIds(new Set(item.memberIds ?? [])); setMemberQuery(""); setFeedback(""); };
  const add = async () => { const normalizedCode = normalizeDepartmentCode(newCode); if (!newName.trim() || !normalizedCode || busy) return; setBusy(true); setFeedback(""); try { const created = await createDepartment(token, { name: newName.trim(), code: normalizedCode, parentId: newParentId || undefined }); onChanged(created); selectDepartment(created); setNewName(""); setNewCode(""); setNewParentId(""); setFeedback("Отдел создан. Служебная группа уже готова."); } catch (error) { setFeedback(error instanceof Error ? error.message : "Не удалось создать отдел"); } finally { setBusy(false); } };
  const save = async () => { const normalizedCode = normalizeDepartmentCode(code); if (!selected || !name.trim() || !normalizedCode || busy) return; setBusy(true); setFeedback(""); try { const saved = await updateDepartment(token, selected.id, { name: name.trim(), code: normalizedCode, parentId: parentId || null }); onChanged(saved); setCode(normalizedCode); setFeedback("Сведения об отделе сохранены."); } catch (error) { setFeedback(error instanceof Error ? error.message : "Не удалось сохранить отдел"); } finally { setBusy(false); } };
  const saveMembers = async () => { if (!selected || busy) return; setBusy(true); setFeedback(""); try { const saved = await updateDepartmentMembers(token, selected.id, [...memberIds]); onChanged(saved); setFeedback("Состав отдела и служебной группы обновлён."); } catch (error) { setFeedback(error instanceof Error ? error.message : "Не удалось обновить состав отдела"); } finally { setBusy(false); } };
  return <section className="department-management" aria-label="Отделы и подразделения">
    <header className="directory-subheading"><Building20Regular /><div><h2>Отделы и подразделения</h2><p>Создавайте команды, назначайте сотрудников и используйте их в задачах</p></div></header>
    {feedback ? <div className="directory-feedback" role="status">{feedback}</div> : null}
    <div className="department-create-grid"><Field label="Название"><Input aria-label="Название нового отдела" value={newName} disabled={busy} onChange={(_, data) => setNewName(data.value)} /></Field><Field label="Короткий код" hint="Латиницей, без пробелов. Например: test-otdel"><Input aria-label="Код нового отдела" value={newCode} disabled={busy} onChange={(_, data) => setNewCode(normalizeDepartmentCode(data.value))} /></Field><Field label="Расположение" hint="Самостоятельно или в составе другого подразделения."><Select aria-label="Расположение нового отдела" value={newParentId} disabled={busy} onChange={(event) => setNewParentId(event.target.value)}><option value="">Самостоятельный отдел</option>{ordered.map(({ department, depth }) => <option key={department.id} value={department.id}>{"— ".repeat(depth)}В составе: {department.name}</option>)}</Select></Field><Button appearance="primary" icon={<Add20Regular />} disabled={busy || !newName.trim() || !newCode.trim()} onClick={() => void add()}>Создать отдел</Button></div>
    <div className="department-workspace"><div className="department-tree" role="list" aria-label="Список отделов">{ordered.map(({ department, depth }) => <button key={department.id} type="button" role="listitem" className={department.id === selectedId ? "selected" : ""} style={{ paddingInlineStart: `${14 + depth * 20}px` }} onClick={() => selectDepartment(department)}><strong>{department.name}</strong><small>{department.assignedUsersCount} сотрудников · служебная группа</small></button>)}</div>
      {selected ? <div className="department-editor"><Field label="Название"><Input aria-label="Название отдела" value={name} disabled={busy} onChange={(_, data) => setName(data.value)} /></Field><Field label="Короткий код" hint="Латиницей, без пробелов"><Input aria-label="Код отдела" value={code} disabled={busy} onChange={(_, data) => setCode(normalizeDepartmentCode(data.value))} /></Field><Field label="Расположение"><Select aria-label="Расположение отдела" value={parentId} disabled={busy} onChange={(event) => setParentId(event.target.value)}><option value="">Самостоятельный отдел</option>{ordered.filter(({ department }) => !invalidParentIds.has(department.id)).map(({ department, depth }) => <option key={department.id} value={department.id}>{"— ".repeat(depth)}В составе: {department.name}</option>)}</Select></Field><Button disabled={busy || !name.trim() || !code.trim()} onClick={() => void save()}>Сохранить сведения</Button>
        <div className="department-members-heading"><div><PeopleTeam20Regular /><span><strong>Сотрудники отдела</strong><small>{memberIds.size} выбрано</small></span></div><p>Служебная группа автоматически получает тот же состав.</p></div><Input contentBefore={<Search20Regular />} aria-label="Поиск сотрудников для отдела" placeholder="Найти сотрудника" value={memberQuery} onChange={(_, data) => setMemberQuery(data.value)} /><div className="department-member-list" role="group" aria-label={`Сотрудники отдела ${selected.name}`}>{visibleEmployees.map((employee) => <label key={employee.id} className="department-member-row"><Checkbox checked={memberIds.has(employee.id)} disabled={busy} onChange={(_, data) => setMemberIds((current) => { const next = new Set(current); if (data.checked === true) next.add(employee.id); else next.delete(employee.id); return next; })} /><EmployeeProfileLink userId={employee.id} personName={employee.name}><Avatar name={employee.name} size={32} color="colorful" /><span><strong>{employee.name}</strong><small>{employee.jobTitle ?? "Должность не указана"}</small></span></EmployeeProfileLink></label>)}</div><Button appearance="primary" disabled={busy} onClick={() => void saveMembers()}>Сохранить состав отдела</Button>
      </div> : <div className="directory-empty">Создайте первый отдел.</div>}</div>
  </section>;
}
