import { useMemo, useState } from "react";
import { Badge, useRestoreFocusTarget } from "@fluentui/react-components";
import type { GrantStatus, GrantSummary, WorkspacePerson } from "@yuksalish/contracts";
import { RecordTablePager, SortHeading, tableCollator, useTablePage, type TableSort } from "./RecordTableTools";
import { GrantParticipant } from "./GrantParticipant";
import { TaskParticipantAvatar } from "./TaskParticipantAvatar";
import "./record-lists.css";

export function GrantRecords({ grants, people, token, selectedId, filterKey, statusLabels, onSelect, now }: {
  readonly grants: readonly GrantSummary[];
  readonly people: readonly WorkspacePerson[];
  readonly token: string;
  readonly selectedId?: string;
  readonly filterKey: string;
  readonly statusLabels: Readonly<Record<GrantStatus, string>>;
  readonly onSelect: (id: string) => void;
  readonly now: number;
}) {
  const [sort, setSort] = useState<TableSort>({ key: "", descending: false });
  const focusTarget = useRestoreFocusTarget();
  const byId = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const sorted = useMemo(() => {
    if (!sort.key) return grants;
    const text = (grant: GrantSummary) => sort.key === "author" ? byId.get(grant.authorUserId ?? "")?.name ?? ""
      : sort.key === "assignee" ? byId.get(grant.assigneeId)?.name ?? ""
      : sort.key === "status" ? statusLabels[grant.status] : grant.title;
    return [...grants].sort((a, b) => (sort.key === "due" ? Date.parse(a.dueAt) - Date.parse(b.dueAt)
      : tableCollator.compare(text(a), text(b))) * (sort.descending ? -1 : 1));
  }, [grants, sort, byId, statusLabels]);
  const paging = useTablePage(sorted.length, `${filterKey}:${sort.key}:${sort.descending}`);
  return <div className="record-table-frame grant-records">
    <div className="record-table-scroll" role="region" aria-label="Список грантов" tabIndex={0}>
      <table className="record-table grant-record-table" aria-label="Заявки на гранты"><thead><tr>
        {[["title", "Название"], ["author", "Постановщик и инициатор"], ["assignee", "Участники"], ["status", "Статус"], ["due", "Крайний срок"]].map(([key, label]) =>
          <SortHeading key={key} column={key!} sort={sort} onSort={(column) => setSort({key: column, descending: sort.key === column && !sort.descending})}>{label}</SortHeading>)}
      </tr></thead><tbody>{sorted.slice(paging.start, paging.start + paging.size).map((grant) => {
        const overdue = !["completed", "launch_rejected"].includes(grant.status) && Date.parse(grant.dueAt) < now;
        return <tr key={grant.id} className={`record-row grant-row${selectedId === grant.id ? " selected" : ""}`} onClick={(event) => {
          if (!(event.target as HTMLElement).closest('button, [role="button"]')) {
            event.currentTarget.querySelector<HTMLButtonElement>(".record-open")?.focus(); onSelect(grant.id);
          }
        }}>
          <td className="record-title"><button {...focusTarget} className="record-open" type="button" aria-haspopup="dialog" onClick={() => onSelect(grant.id)}><strong>{grant.title}</strong></button>
            <div className="record-secondary"><span>{statusLabels[grant.status]}</span>{grant.checklist.length > 0 && <span>Чек-лист {grant.checklist.filter((item) => item.completed).length}/{grant.checklist.length}</span>}</div>
          </td>
          <td><div className="grant-record-owners">{grant.authorUserId ? <GrantParticipant person={byId.get(grant.authorUserId)} label="Постановщик" token={token} size={28} /> : <span className="grants-owner">Постановщик — после разрешения запуска</span>}
            <GrantParticipant person={byId.get(grant.initiatorUserId)} label="Инициатор" token={token} size={28} /></div></td>
          <td><div className="task-participant-group" aria-label="Участники гранта"><TaskParticipantAvatar person={byId.get(grant.assigneeId)} role="Исполнитель" token={token} />
            {grant.coAssigneeIds.map((id) => <TaskParticipantAvatar key={id} person={byId.get(id)} role="Соисполнитель" token={token} />)}</div></td>
          <td><Badge className="record-status-badge" data-status={grant.status} appearance="tint" color={grant.status === "completed" ? "success" : grant.status === "launch_rejected" ? "danger" : "brand"}>{statusLabels[grant.status]}</Badge>
            {grant.allowedActions.some((action) => ["approve", "approve_launch"].includes(action)) && <small className="grant-record-decision">Нужно ваше решение</small>}</td>
          <td className={`record-deadline${overdue ? " overdue" : ""}`}><time dateTime={grant.dueAt}>{new Date(grant.dueAt).toLocaleString("ru-RU", {dateStyle: "short", timeStyle: "short"})}</time>{overdue && <small className="grants-overdue">Срок истёк</small>}</td>
        </tr>;
      })}</tbody></table>
      {!sorted.length && <div className="record-empty"><strong>Заявки не найдены</strong><span>Измените фильтр или создайте новую заявку на грант.</span></div>}
    </div><RecordTablePager total={sorted.length} paging={paging} label="гранты" />
  </div>;
}
