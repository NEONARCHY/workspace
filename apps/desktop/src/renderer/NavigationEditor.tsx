import { SpatialSort, SpatialSortItem } from "./SpatialSort";
import { useState } from "react";
import { navigationKeys, type NavigationKey } from "@yuksalish/contracts";
import { ArrowDown16Regular, ArrowUp16Regular, ReOrderDotsVertical16Regular } from "@fluentui/react-icons";
import { moveBefore, normalizeNavigation } from "./personal-organization";

export function NavigationEditor({ order, revision, labels, onSave, onClose }: {
  readonly order: readonly NavigationKey[];
  readonly revision: number;
  readonly labels: Readonly<Record<NavigationKey, string>>;
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
    <p>Перетащите раздел или используйте стрелки. Это ваше личное меню.</p>
    <SpatialSort ids={draft} onMove={(source, target) => move(source as NavigationKey, target as NavigationKey)}>
    <div role="list" aria-label="Разделы меню">
      {draft.map((key, index) => <SpatialSortItem id={key} label={labels[key]} disabled={busy} key={key} role="listitem" className="navigation-edit-row"
        data-navigation-key={key}>
        <ReOrderDotsVertical16Regular aria-hidden="true" />
        <span>{labels[key]}</span>
        <button type="button" aria-label={`${labels[key]}: выше`} disabled={busy || index === 0} onClick={() => move(key, draft[index - 1]!)}><ArrowUp16Regular /></button>
        <button type="button" aria-label={`${labels[key]}: ниже`} disabled={busy || index === draft.length - 1} onClick={() => move(key, draft[index + 1]!)}><ArrowDown16Regular /></button>
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
