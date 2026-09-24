import { useMemo, useState } from "react";
import { Avatar, Badge, useRestoreFocusTarget } from "@fluentui/react-components";
import type { TaskStatus, WorkspacePerson, WorkspaceTask } from "@yuksalish/contracts";
import { RecordTablePager, SortHeading, tableCollator, useTablePage, type TableSort } from "./RecordTableTools";
import { EmployeeProfileLink } from "./EmployeeProfileLink";

const statuses: Record<TaskStatus, string> = { new: "Новая", in_progress: "В работе", awaiting_review: "На проверке", completed: "Завершена", overdue: "Просрочена", cancelled: "Отменена" };

export function TaskRecords({ tasks, people, selectedId, filterKey, onSelect }: {
  tasks: readonly WorkspaceTask[]; people: readonly WorkspacePerson[]; selectedId?: string;
  filterKey: string; onSelect: (id: string) => void;
}) {
  const [sort, setSort] = useState<TableSort>({ key: "", descending: false });
  const restoreFocusTarget = useRestoreFocusTarget();
  const peopleById = useMemo(() => new Map(people.map(person => [person.id, person])), [people]);
  const names = useMemo(() => new Map(people.map(person => [person.id, person.name])), [people]);
  const sorted = useMemo(() => {
    const text = (task: WorkspaceTask) => sort.key === "author" ? names.get(task.authorId) ?? ""
      : sort.key === "assignee" ? names.get(task.assigneeId) ?? ""
      : sort.key === "project" ? task.project : sort.key === "status" ? statuses[task.status] : task.title;
    if (!sort.key) return tasks;
    return [...tasks].sort((a, b) => {
      if (sort.key === "due") {
        const left = a.dueAt ? Date.parse(a.dueAt) : NaN, right = b.dueAt ? Date.parse(b.dueAt) : NaN;
        // Missing dates always last, including descending sort.
        if (!Number.isFinite(left) || !Number.isFinite(right)) return Number(!Number.isFinite(left)) - Number(!Number.isFinite(right));
        return (left - right) * (sort.descending ? -1 : 1);
      }
      return tableCollator.compare(text(a), text(b)) * (sort.descending ? -1 : 1);
    });
  }, [tasks, sort, names]);
  const paging = useTablePage(sorted.length, `${filterKey}:${sort.key}:${sort.descending}`);
  const onSort = (key: string) => setSort({ key, descending: sort.key === key && !sort.descending });
  const person = (id: string) => {
    const value = peopleById.get(id);
    const name = value?.name ?? "Сотрудник";
    return <EmployeeProfileLink userId={value?.id} personName={name} className={`record-person${value?.status && value.status !== "active" ? " workspace-person-inactive" : ""}`}><Avatar name={name} size={28} color="colorful" aria-hidden="true" /><span>{name}</span></EmployeeProfileLink>;
  };
  return <div className="record-table-frame task-records">
    <div className="record-table-scroll" role="region" aria-label="Список задач" tabIndex={0}>
      <table className="record-table task-record-table" aria-label="Задачи">
        <thead><tr>{[["title", "Название"], ["status", "Статус"], ["due", "Крайний срок"], ["author", "Постановщик"], ["assignee", "Исполнитель"], ["project", "Проект"]].map(([column, label]) => <SortHeading key={column} column={column!} sort={sort} onSort={onSort}>{label}</SortHeading>)}</tr></thead>
        <tbody>{sorted.slice(paging.start, paging.start + paging.size).map(task => <tr key={task.id} className={`task-row record-row ${selectedId === task.id ? "selected" : ""}`} onClick={event => { if (!(event.target as HTMLElement).closest("button")) { event.currentTarget.querySelector("button")?.focus(); onSelect(task.id); } }}>
          <td className="record-title"><span className={`task-record-signal priority-${task.priority}`} aria-hidden="true" /><button {...restoreFocusTarget} className="record-open" type="button" aria-haspopup="dialog" aria-label={`Открыть задачу: ${task.title}`} onClick={() => onSelect(task.id)}><strong>{task.title}</strong></button>
            <div className="record-secondary">{task.checklistTotal > 0 && <span>План {task.checklistDone}/{task.checklistTotal}</span>}{task.comments.length > 0 && <span>Обсуждение · {task.comments.length}</span>}{task.cycle && <span>Повторяется</span>}</div>
            {task.checklistTotal > 0 ? <span className="task-record-progress" aria-hidden="true"><i style={{ width: `${Math.round(task.checklistDone / task.checklistTotal * 100)}%` }} /></span> : null}
          </td>
          <td><Badge appearance="tint" color={task.status === "overdue" ? "danger" : task.status === "completed" ? "success" : task.status === "awaiting_review" ? "warning" : "brand"}>{statuses[task.status]}</Badge>{["high", "urgent"].includes(task.priority) && <small className="record-priority">{task.priority === "urgent" ? "Срочный приоритет" : "Высокий приоритет"}</small>}</td>
          <td className={task.status === "overdue" ? "record-deadline overdue" : "record-deadline"}>{task.dueLabel}</td>
          <td>{person(task.authorId)}</td><td>{person(task.assigneeId)}</td><td className="record-project">{task.project || "Без проекта"}</td>
        </tr>)}</tbody>
      </table>
      {!tasks.length && <div className="record-table-empty"><strong>В этом разделе задач нет</strong><span>Измените поиск, переключите фильтр или создайте задачу.</span></div>}
    </div>
    <RecordTablePager total={sorted.length} paging={paging} label="задачи" />
  </div>;
}
