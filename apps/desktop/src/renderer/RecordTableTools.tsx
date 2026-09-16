import { useState, type ReactNode } from "react";
import { ChevronLeft20Regular, ChevronRight20Regular } from "@fluentui/react-icons";
import { WorkspaceSelect } from "./WorkspaceSelect";

export type TableSort = { key: string; descending: boolean };
export const tableCollator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

export function SortHeading({ column, children, sort, onSort }: {
  column: string; children: ReactNode; sort: TableSort; onSort: (key: string) => void;
}) {
  const selected = sort.key === column;
  return <th scope="col" aria-sort={selected ? sort.descending ? "descending" : "ascending" : undefined}>
    <button type="button" onClick={() => onSort(column)}>{children}<span aria-hidden="true">{selected ? sort.descending ? "↓" : "↑" : "↕"}</span></button>
  </th>;
}

/** Clamp after removals and reset on changed filters without a state-setting effect. */
export function useTablePage(total: number, resetKey: string) {
  const [size, setSize] = useState(25);
  const [position, setPosition] = useState({ key: resetKey, page: 0 });
  const pages = Math.max(1, Math.ceil(total / size));
  const page = position.key === resetKey ? Math.min(position.page, pages - 1) : 0;
  // Remember the reset, so returning to a previous filter cannot resurrect its old page.
  if (position.key !== resetKey || position.page !== page) setPosition({ key: resetKey, page });
  return { size, page, pages, start: page * size,
    setPage: (next: number) => setPosition({ key: resetKey, page: Math.max(0, Math.min(next, pages - 1)) }),
    setSize: (next: number) => { setSize(next); setPosition({ key: resetKey, page: 0 }); },
  };
}

export function RecordTablePager({ total, paging, label }: {
  total: number; paging: ReturnType<typeof useTablePage>; label: string;
}) {
  return <footer className="record-table-footer">
    <span role="status">{total ? `${paging.start + 1}–${Math.min(total, paging.start + paging.size)} из ${total}` : "Найдено: 0"}</span>
    <div className="record-table-paging">
      <label>На странице<WorkspaceSelect aria-label={`Строк на странице: ${label}`} value={paging.size} onChange={event => paging.setSize(Number(event.target.value))}>
        {[10, 25, 50].map(value => <option key={value} value={value}>{value}</option>)}
      </WorkspaceSelect></label>
      <button type="button" aria-label={`Предыдущая страница: ${label}`} disabled={paging.page === 0} onClick={() => paging.setPage(paging.page - 1)}><ChevronLeft20Regular /></button>
      <span aria-label={`Страница ${paging.page + 1} из ${paging.pages}`}>{paging.page + 1} / {paging.pages}</span>
      <button type="button" aria-label={`Следующая страница: ${label}`} disabled={paging.page === paging.pages - 1} onClick={() => paging.setPage(paging.page + 1)}><ChevronRight20Regular /></button>
    </div>
  </footer>;
}
