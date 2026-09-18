import { SpatialSort, SpatialSortItem } from "./SpatialSort";
import { useState, type ReactNode } from "react";
import { navigationKeys, type NavigationKey } from "@yuksalish/contracts";
import { moveBefore, normalizeNavigation } from "./personal-organization";

export function NavigationEditor({ order, revision, labels, icons, badges, onSave, onClose }: {
  readonly order: readonly NavigationKey[];
  readonly revision: number;
  readonly labels: Readonly<Record<NavigationKey, string>>;
  readonly icons?: Readonly<Partial<Record<NavigationKey, ReactNode>>>;
  readonly badges?: Readonly<Partial<Record<NavigationKey, number>>>;
  readonly onSave: (order: readonly NavigationKey[], revision: number) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => normalizeNavigation(order));
  const [baseRevision] = useState(revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const move = (source: NavigationKey, target: NavigationKey) => {
    const next = moveBefore(draft, source, target);
    setDraft(next);
    setAnnouncement(`${labels[source]}: позиция ${next.indexOf(source) + 1} из ${next.length}`);
  };
  return <section className="navigation-editor" aria-label="Порядок главного меню" aria-busy={busy}>
    <SpatialSort ids={draft} onMove={(source, target) => move(source as NavigationKey, target as NavigationKey)}>
    <div role="list" aria-label="Разделы меню">
      {draft.map((key) => <SpatialSortItem id={key} label={labels[key]} disabled={busy} key={key} role="listitem" className="navigation-edit-row"
        data-navigation-key={key}>
        {icons?.[key] ? <span className="rail-icon">{icons[key]}</span> : null}
        <span className="rail-label">{labels[key]}</span>
        {badges?.[key] ? <span className="rail-badge">{badges[key]! > 99 ? "99+" : badges[key]}</span> : null}
      </SpatialSortItem>)}
    </div>
    </SpatialSort>
    <span className="organization-live" role="status">{announcement}</span>
    {error && <div className="organization-error" role="alert">{error}</div>}
    <div className="navigation-edit-actions">
      <button type="button" disabled={busy} onClick={() => { setDraft([...navigationKeys]); setAnnouncement("Восстановлен стандартный порядок. Нажмите «Сохранить»."); }}>По умолчанию</button>
      <button type="button" disabled={busy} onClick={onClose}>Отмена</button>
      <button type="button" className="navigation-save" disabled={busy} onClick={() => {
        setBusy(true); setError("");
        void onSave(draft, baseRevision).then(onClose).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Не удалось сохранить меню")).finally(() => setBusy(false));
      }}>{busy ? "Сохраняем…" : "Сохранить"}</button>
    </div>
  </section>;
}
