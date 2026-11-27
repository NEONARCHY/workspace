import { formatRussianDateTime } from "./date-time-format";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Badge, useRestoreFocusTarget } from "@fluentui/react-components";
import type { GrantStatus, GrantSummary, WorkspacePerson } from "@yuksalish/contracts";
import { RecordCompactTools, RecordTablePager, SortHeading, tableCollator, useTablePage, type TableSort } from "./RecordTableTools";
import { GrantParticipant } from "./GrantParticipant";
import { TaskParticipantAvatar } from "./TaskParticipantAvatar";
import "./record-lists.css";

const columns = [["title", "Название"], ["author", "Постановщик и инициатор"], ["assignee", "Участники"], ["status", "Статус"], ["due", "Крайний срок"]] as const;

export function GrantRecords({ grants, people, token, selectedId, filterKey, statusLabels, onSelect, now, compact = false, compactToolsTarget }: {
  readonly grants: readonly GrantSummary[];
  readonly people: readonly WorkspacePerson[];
  readonly token: string;
  readonly selectedId?: string;
  readonly filterKey: string;
  readonly statusLabels: Readonly<Record<GrantStatus, string>>;
  readonly onSelect: (id: string) => void;
  readonly now: number;
  readonly compact?: boolean;
  readonly compactToolsTarget?: HTMLElement | null;
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
  const onSort = (key: string) => setSort({ key, descending: sort.key === key && !sort.descending });
  const compactTools = <RecordCompactTools columns={columns} sort={sort} onSort={onSort} label="гранты" iconOnly={compact && Boolean(compactToolsTarget)} />;
  return <div className="record-table-frame grant-records">
    {compact && compactToolsTarget ? createPortal(compactTools, compactToolsTarget) : compactTools}
    <div className="record-table-scroll" role="region" aria-label="Список грантов" tabIndex={0}>
      <table className="record-table grant-record-table" aria-label="Заявки на гранты"><thead><tr>
        {columns.map(([key, label]) => <SortHeading key={key} column={key} sort={sort} onSort={onSort}>{label}</SortHeading>)}
      </tr></thead><tbody>{sorted.slice(paging.start, paging.start + paging.size).map((grant) => {
        const overdue = !["completed", "launch_rejected"].includes(grant.status) && Date.parse(grant.dueAt) < now;
        return <tr key={grant.id} className={`record-row grant-row${selectedId === grant.id ? " selected" : ""}`} onClick={(event) => {
          if (!(event.target as HTMLElement).closest('button, [role="button"]')) {
            event.currentTarget.querySelector<HTMLButtonElement>(".record-open")?.focus(); onSelect(grant.id);
          }
        }}>
          <td className="record-title"><button {...focusTarget} className="record-open" type="button" aria-haspopup="dialog" onClick={() => onSelect(grant.id)}><strong>{grant.title}</strong></button>
            <div className="record-secondary">{!compact && <span>{statusLabels[grant.status]}</span>}{grant.checklist.length > 0 && <span>Чек-лист {grant.checklist.filter((item) => item.completed).length}/{grant.checklist.length}</span>}</div>
          </td>
          <td className="record-owners"><div className="grant-record-owners">{grant.authorUserId ? <GrantParticipant person={byId.get(grant.authorUserId)} label="Постановщик" token={token} size={28} /> : <span className="grants-owner">Постановщик — после разрешения запуска</span>}
            {!compact && <GrantParticipant person={byId.get(grant.initiatorUserId)} label="Инициатор" token={token} size={28} />}</div></td>
          <td className="record-participants"><div className="task-participant-group" aria-label="Участники гранта"><TaskParticipantAvatar person={byId.get(grant.assigneeId)} role="Исполнитель" token={token} />
            {(compact ? grant.coAssigneeIds.slice(0, 1) : grant.coAssigneeIds).map((id) => <TaskParticipantAvatar key={id} person={byId.get(id)} role="Соисполнитель" token={token} />)}
            {compact && grant.coAssigneeIds.length > 1 && <button className="record-participant-more" type="button" aria-label={`Ещё ${grant.coAssigneeIds.length - 1} участников гранта`} onClick={() => onSelect(grant.id)}>+{grant.coAssigneeIds.length - 1}</button>}</div></td>
          <td className="record-status"><Badge className="record-status-badge" data-status={grant.status} appearance="tint" color={grant.status === "completed" ? "success" : grant.status === "launch_rejected" ? "danger" : "brand"}>{statusLabels[grant.status]}</Badge>
            {grant.allowedActions.some((action) => ["approve", "approve_launch", "approve_deadline"].includes(action)) && <small className="grant-record-decision">Нужно ваше решение</small>}</td>
          <td className={`record-deadline${overdue ? " overdue" : ""}`}><time dateTime={grant.dueAt}>{formatRussianDateTime(new Date(grant.dueAt), {dateStyle: "short", timeStyle: "short"})}</time>{overdue && <small className="grants-overdue">Срок истёк</small>}{grant.pendingDeadlineRequest && <small className="grant-record-deadline-request">Запрошено продление</small>}</td>
        </tr>;
      })}</tbody></table>
      {!sorted.length && <div className="record-empty"><strong>Заявки не найдены</strong><span>Измените фильтр или создайте новую заявку на грант.</span></div>}
    </div><RecordTablePager total={sorted.length} paging={paging} label="гранты" />
  </div>;
}
