import type { CSSProperties, ReactNode } from "react";
import "./loading-skeleton.css";

export type SkeletonLayout = "custom" | "lines" | "rows" | "table" | "cards" | "metrics" | "form" | "profile" | "calendar" | "board" | "map";

export function SkeletonBlock({ width, height, circle = false }: { readonly width?: string; readonly height?: string; readonly circle?: boolean }) {
  return <span className={`ws-skeleton-block${circle ? " is-circle" : ""}`} style={{ "--skeleton-width": width, "--skeleton-height": height } as CSSProperties} />;
}

export function LoadingSkeleton({ layout = "rows", rows = 4, label = "Загрузка данных", className = "", children, delayed = true }: {
  readonly layout?: SkeletonLayout; readonly rows?: number; readonly label?: string; readonly className?: string;
  readonly children?: ReactNode; readonly delayed?: boolean;
}) {
  const count = Math.max(1, Math.min(12, rows));
  return <div className={`ws-loading-skeleton is-${layout} ${className}`} data-skeleton-deferred={delayed || undefined} role="status" aria-label={label} aria-busy="true" style={layout === "metrics" ? { "--skeleton-columns": Math.min(count, 4) } as CSSProperties : undefined}>
    <span className="sr-only">{label}</span>
    <div className="ws-skeleton-layout" aria-hidden="true">
      {layout === "custom" ? children : <>
      {layout === "profile" ? <div className="ws-skeleton-profile"><SkeletonBlock width="140px" height="140px" circle /><div><SkeletonBlock width="36%" /><SkeletonBlock width="65%" height="28px" /><SkeletonBlock width="85%" /><SkeletonBlock width="72%" /></div></div> : null}
      {layout === "map" ? <SkeletonBlock height="min(60vh, 560px)" /> : layout === "calendar" ? Array.from({ length: 35 }, (_, index) => <div className="ws-skeleton-day" key={index}><SkeletonBlock width="20px" /><SkeletonBlock height="24px" /></div>)
        : layout === "board" ? Array.from({ length: 5 }, (_, index) => <div className="ws-skeleton-column" key={index}><SkeletonBlock width="65%" height="20px" /><LoadingSkeleton layout="cards" rows={2} /></div>)
        : Array.from({ length: count }, (_, index) => <div className="ws-skeleton-item" key={index}>
          {layout === "rows" ? <SkeletonBlock width="36px" height="36px" circle /> : null}
          <div className="ws-skeleton-copy"><SkeletonBlock width={layout === "lines" ? `${92 - index % 3 * 15}%` : "72%"} height={layout === "cards" || layout === "metrics" ? "22px" : undefined} />{layout !== "lines" ? <SkeletonBlock width="48%" /> : null}</div>
          {layout === "table" ? <><SkeletonBlock width="60%" /><SkeletonBlock width="65%" /><SkeletonBlock width="45%" /></> : null}
          {layout === "form" ? <SkeletonBlock height="40px" /> : null}
        </div>)}
      </>}
    </div>
  </div>;
}

/** Lives inside the real table, inheriting its columns, padding and responsive rules. */
export function SkeletonTableRows({ columns, rows = 6, label = "Загрузка данных", rowClassName, personColumn, selectionColumn }: {
  readonly columns: number; readonly rows?: number; readonly label?: string; readonly rowClassName?: string;
  readonly personColumn?: number; readonly selectionColumn?: number;
}) {
  return <tbody className="ws-skeleton-table-body" data-skeleton-deferred aria-busy="true" aria-label={label}>
    {Array.from({ length: Math.max(1, Math.min(12, rows)) }, (_, row) => <tr className={rowClassName} key={row} aria-hidden="true">
      {Array.from({ length: columns }, (_, column) => <td key={column} className={column === selectionColumn ? "record-selection-cell" : undefined}>
        {column === selectionColumn ? <SkeletonBlock width="18px" height="18px" /> : <div className="ws-skeleton-item">
          {column === personColumn ? <SkeletonBlock width="36px" height="36px" circle /> : null}
          <div className="ws-skeleton-copy"><SkeletonBlock width={column === 0 ? "72%" : "62%"} /><SkeletonBlock width="45%" /></div>
        </div>}
      </td>)}
    </tr>)}
  </tbody>;
}
