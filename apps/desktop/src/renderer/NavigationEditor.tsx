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
  const [dragged, setDragged] = useState<NavigationKey>();
  const [over, setOver] = useState<NavigationKey>();
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
    <div role="list" aria-label="Разделы меню">
      {draft.map((key, index) => <div key={key} role="listitem" className={`navigation-edit-row ${over === key ? "drop-target" : ""}`}
        data-navigation-key={key} draggable={!busy}
        onDragStart={(event) => { if (busy) { event.preventDefault(); return; } setDragged(key); event.dataTransfer.setData("application/x-yuksalish-navigation", key); event.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(event) => { if (!busy && dragged && dragged !== key) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(key); } }}
        onDrop={(event) => { if (!busy && dragged && event.dataTransfer.getData("application/x-yuksalish-navigation") === dragged) { event.preventDefault(); move(dragged, key); } setDragged(undefined); setOver(undefined); }}
        onDragEnd={() => { setDragged(undefined); setOver(undefined); }}>
        <ReOrderDotsVertical16Regular aria-hidden="true" />
        <span>{labels[key]}</span>
        <button type="button" aria-label={`${labels[key]}: выше`} disabled={busy || index === 0} onClick={() => move(key, draft[index - 1]!)}><ArrowUp16Regular /></button>
        <button type="button" aria-label={`${labels[key]}: ниже`} disabled={busy || index === draft.length - 1} onClick={() => move(key, draft[index + 1]!)}><ArrowDown16Regular /></button>
      </div>)}
    </div>
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
