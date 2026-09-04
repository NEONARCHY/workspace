import { useMemo, useState } from "react";
import { Avatar, Badge, useRestoreFocusTarget } from "@fluentui/react-components";
import type { DirectoryEmployee, WorkspaceRole } from "@yuksalish/contracts";
import { RecordTablePager, SortHeading, tableCollator, useTablePage, type TableSort } from "./RecordTableTools";

export const employeeRoleLabels: Record<WorkspaceRole, string> = { superadmin: "Суперадминистратор", admin: "Администратор", manager: "Руководитель", employee: "Сотрудник" };
export const employeeStatusLabel = (status: string) => ({ active: "Активен", pending: "Ожидает активации", invited: "Приглашён", disabled: "Отключён", blocked: "Заблокирован" })[status] ?? status;

export function EmployeeRecords({ employees, filterKey, onSelect }: {
  employees: readonly DirectoryEmployee[]; filterKey: string; onSelect: (employee: DirectoryEmployee) => void;
}) {
  const [sort, setSort] = useState<TableSort>({ key: "name", descending: false });
  const restoreFocusTarget = useRestoreFocusTarget();
  const sorted = useMemo(() => [...employees].sort((a, b) => {
    const value = (employee: DirectoryEmployee) => sort.key === "position" ? employee.jobTitle ?? ""
      : sort.key === "username" ? employee.username : sort.key === "role" ? employeeRoleLabels[employee.role]
      : sort.key === "status" ? employeeStatusLabel(employee.status) : employee.name;
    return tableCollator.compare(value(a), value(b)) * (sort.descending ? -1 : 1);
  }), [employees, sort]);
  const paging = useTablePage(sorted.length, `${filterKey}:${sort.key}:${sort.descending}`);
  const onSort = (key: string) => setSort({ key, descending: sort.key === key && !sort.descending });
  return <div className="record-table-frame employee-records">
    <div className="record-table-scroll" role="region" aria-label="Список сотрудников" tabIndex={0}>
      <table className="record-table employee-record-table" aria-label="Сотрудники">
        <thead><tr>{[["name", "Сотрудник"], ["position", "Должность"], ["username", "Логин"], ["role", "Роль"], ["status", "Состояние"]].map(([column, label]) => <SortHeading key={column} column={column!} sort={sort} onSort={onSort}>{label}</SortHeading>)}</tr></thead>
        <tbody>{sorted.slice(paging.start, paging.start + paging.size).map(employee => <tr className="record-row employee-row" key={employee.id} onClick={event => { if (!(event.target as HTMLElement).closest("button")) { event.currentTarget.querySelector("button")?.focus(); onSelect(employee); } }}>
          <td><span className="record-person employee-person"><Avatar name={employee.name} size={36} color="colorful" aria-hidden="true" /><span><button {...restoreFocusTarget} type="button" className="record-open" aria-haspopup="dialog" aria-label={`Открыть сотрудника: ${employee.name}`} onClick={() => onSelect(employee)}><strong>{employee.name}</strong></button><small>@{employee.username}</small></span></span></td>
          <td className="employee-position">{employee.jobTitle ?? "Не назначена"}</td><td className="record-username">@{employee.username}</td>
          <td><span className={`role-mark role-${employee.role}`}>{employeeRoleLabels[employee.role]}</span></td>
          <td><Badge appearance="tint" color={employee.status === "active" ? "success" : employee.status === "invited" ? "brand" : "warning"}>{employeeStatusLabel(employee.status)}</Badge></td>
        </tr>)}</tbody>
      </table>
      {!employees.length && <div className="record-table-empty"><strong>Сотрудники не найдены</strong><span>Измените поисковый запрос или фильтры.</span></div>}
    </div>
    <RecordTablePager total={sorted.length} paging={paging} label="сотрудники" />
  </div>;
}
