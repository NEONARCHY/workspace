import { useState, type ReactNode } from "react";
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from "@fluentui/react-components";
import { ChevronDown16Regular, ChevronLeft20Regular, ChevronRight20Regular } from "@fluentui/react-icons";

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
  const safeSize = Number.isFinite(size) && size > 0 ? size : 25;
  const pages = Math.max(1, Math.ceil(total / safeSize));
  const page = position.key === resetKey ? Math.min(position.page, pages - 1) : 0;
  // Remember the reset, so returning to a previous filter cannot resurrect its old page.
  if (position.key !== resetKey || position.page !== page) setPosition({ key: resetKey, page });
  return { size: safeSize, page, pages, start: page * safeSize,
    setPage: (next: number) => setPosition({ key: resetKey, page: Math.max(0, Math.min(next, pages - 1)) }),
    setSize: (next: number) => { setSize(Number.isFinite(next) && next > 0 ? next : 25); setPosition({ key: resetKey, page: 0 }); },
  };
}

export function RecordTablePager({ total, paging, label }: {
  total: number; paging: ReturnType<typeof useTablePage>; label: string;
}) {
  return <footer className="record-table-footer">
    <span role="status">{total ? `${paging.start + 1}–${Math.min(total, paging.start + paging.size)} из ${total}` : "Найдено: 0"}</span>
    <div className="record-table-paging">
      <span className="record-page-size">Показывать по<Menu positioning="above-end">
        <MenuTrigger disableButtonEnhancement>
          <button type="button" className="record-page-size-trigger" aria-label={`Количество строк на странице: ${label}`} aria-haspopup="menu">
            {paging.size}<ChevronDown16Regular aria-hidden="true" />
          </button>
        </MenuTrigger>
        <MenuPopover className="record-page-size-popover">
          <MenuList>{[10, 25, 50].map(value => <MenuItem key={value} aria-current={paging.size === value ? "true" : undefined} onClick={() => paging.setSize(value)}>{value}</MenuItem>)}</MenuList>
        </MenuPopover>
      </Menu></span>
      {paging.pages > 1 ? <>
        <button type="button" aria-label={`Предыдущая страница: ${label}`} disabled={paging.page === 0} onClick={() => paging.setPage(paging.page - 1)}><ChevronLeft20Regular /></button>
        <span className="record-page-position" aria-label={`Страница ${paging.page + 1} из ${paging.pages}`}>Страница {paging.page + 1} из {paging.pages}</span>
        <button type="button" aria-label={`Следующая страница: ${label}`} disabled={paging.page === paging.pages - 1} onClick={() => paging.setPage(paging.page + 1)}><ChevronRight20Regular /></button>
      </> : null}
    </div>
  </footer>;
}
