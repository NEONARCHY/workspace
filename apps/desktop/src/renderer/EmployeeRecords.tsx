import { useMemo, useState } from "react";
import { Avatar, Badge, Checkbox, useRestoreFocusTarget } from "@fluentui/react-components";
import type { DirectoryEmployee, WorkspaceDepartment, WorkspaceRole } from "@yuksalish/contracts";
import { RecordTablePager, SortHeading, tableCollator, useTablePage, type TableSort } from "./RecordTableTools";

export const employeeRoleLabels: Record<WorkspaceRole, string> = { superadmin: "Суперадминистратор", admin: "Администратор", manager: "Руководитель", employee: "Сотрудник" };
export const employeeStatusLabel = (status: string) => ({ active: "Активен", pending: "Ожидает активации", invited: "Приглашён", disabled: "Отключён", blocked: "Заблокирован", archived: "В архиве" })[status] ?? status;

export function EmployeeRecords({ employees, departments, filterKey, selectedIds, onOpen, onToggle, onTogglePage }: {
  employees: readonly DirectoryEmployee[];
  departments: readonly WorkspaceDepartment[];
  filterKey: string;
  selectedIds: ReadonlySet<string>;
  onOpen: (employee: DirectoryEmployee) => void;
  onToggle: (employeeId: string, selected: boolean) => void;
  onTogglePage: (employeeIds: readonly string[], selected: boolean) => void;
}) {
  const [sort, setSort] = useState<TableSort>({ key: "name", descending: false });
  const restoreFocusTarget = useRestoreFocusTarget();
  const departmentNames = useMemo(() => new Map(departments.map((department) => [department.id, department.name])), [departments]);
  const sorted = useMemo(() => [...employees].sort((a, b) => {
    const value = (employee: DirectoryEmployee) => sort.key === "position" ? employee.jobTitle ?? ""
      : sort.key === "department" ? departmentNames.get(employee.departmentId ?? "") ?? ""
      : sort.key === "username" ? employee.username : sort.key === "role" ? employeeRoleLabels[employee.role]
      : sort.key === "status" ? employeeStatusLabel(employee.status) : employee.name;
    return tableCollator.compare(value(a), value(b)) * (sort.descending ? -1 : 1);
  }), [departmentNames, employees, sort]);
  const paging = useTablePage(sorted.length, `${filterKey}:${sort.key}:${sort.descending}`);
  const onSort = (key: string) => setSort({ key, descending: sort.key === key && !sort.descending });
  const pageEmployees = sorted.slice(paging.start, paging.start + paging.size);
  const selectedOnPage = pageEmployees.filter((employee) => selectedIds.has(employee.id)).length;
  const pageSelection = selectedOnPage === 0 ? false : selectedOnPage === pageEmployees.length ? true : "mixed";
  return <div className="record-table-frame employee-records">
    <div className="record-table-scroll" role="region" aria-label="Список сотрудников" tabIndex={0}>
      <table className="record-table employee-record-table" aria-label="Сотрудники">
        <thead><tr>
          <th className="record-selection-heading" scope="col">
            <Checkbox
              aria-label="Выбрать сотрудников на странице"
              checked={pageSelection}
              disabled={!pageEmployees.length}
              onChange={(_, data) => onTogglePage(pageEmployees.map((employee) => employee.id), data.checked === true)}
            />
          </th>
          {[["name", "Сотрудник"], ["position", "Должность"], ["department", "Подразделение"], ["username", "Логин"], ["role", "Роль"], ["status", "Состояние"]].map(([column, label]) => <SortHeading key={column} column={column!} sort={sort} onSort={onSort}>{label}</SortHeading>)}
        </tr></thead>
        <tbody>{pageEmployees.map(employee => <tr
          className={`record-row employee-row${selectedIds.has(employee.id) ? " selected" : ""}`}
          aria-selected={selectedIds.has(employee.id)}
          key={employee.id}
          onClick={event => {
            if ((event.target as HTMLElement).closest("button, input, select, a")) return;
            onToggle(employee.id, !selectedIds.has(employee.id));
          }}
        >
          <td className="record-selection-cell"><Checkbox aria-label={`Выбрать сотрудника: ${employee.name}`} checked={selectedIds.has(employee.id)} onChange={(_, data) => onToggle(employee.id, data.checked === true)} /></td>
          <td><span className="record-person employee-person"><Avatar name={employee.name} size={36} color="colorful" aria-hidden="true" /><span><button {...restoreFocusTarget} type="button" className="record-open" aria-haspopup="dialog" aria-label={`Открыть сотрудника: ${employee.name}`} onClick={() => onOpen(employee)}><strong>{employee.name}</strong></button><small>@{employee.username}</small></span></span></td>
          <td className="employee-position">{employee.jobTitle ?? "Не назначена"}</td>
          <td className="employee-department">{departmentNames.get(employee.departmentId ?? "") ?? "Не назначено"}</td>
          <td className="record-username">@{employee.username}</td>
          <td><span className={`role-mark role-${employee.role}`}>{employeeRoleLabels[employee.role]}</span></td>
          <td><Badge appearance="tint" color={employee.status === "active" ? "success" : employee.status === "invited" ? "brand" : employee.status === "archived" ? "subtle" : "warning"}>{employeeStatusLabel(employee.status)}</Badge></td>
        </tr>)}</tbody>
      </table>
      {!employees.length && <div className="record-table-empty"><strong>Сотрудники не найдены</strong><span>Измените поисковый запрос или фильтры.</span></div>}
    </div>
    <RecordTablePager total={sorted.length} paging={paging} label="сотрудники" />
  </div>;
}
