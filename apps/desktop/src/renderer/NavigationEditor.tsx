import { SpatialSort, SpatialSortItem } from "./SpatialSort";
import { useState, type ReactNode } from "react";
import { navigationKeys, type NavigationKey } from "@yuksalish/contracts";
import { moveBefore, normalizeNavigation } from "./personal-organization";
import { Sparkle24Regular } from "@fluentui/react-icons";
import { groupAiNavigation, moveAiNavigationGroup } from "./AiModulesNavigation";

export function NavigationEditor({ order, revision, labels, hiddenKeys = [], icons, badges, onSave, onClose }: {
  readonly order: readonly NavigationKey[];
  readonly revision: number;
  readonly labels: Readonly<Record<NavigationKey, string>>;
  readonly hiddenKeys?: readonly NavigationKey[];
  readonly icons?: Readonly<Partial<Record<NavigationKey, ReactNode>>>;
  readonly badges?: Readonly<Partial<Record<NavigationKey, number>>>;
  readonly onSave: (order: readonly NavigationKey[], revision: number) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => normalizeNavigation(order).filter((key) => !hiddenKeys.includes(key)));
  const [baseRevision] = useState(revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const groups = groupAiNavigation(draft.map((key) => ({ key, label: labels[key], icon: icons?.[key] })));
  const move = (source: string, target: string) => {
    const keys = moveBefore(groups.map((item) => item.key), source, target);
    const next = moveAiNavigationGroup(draft, source, target);
    setDraft(next);
    setAnnouncement(`${groups.find((item) => item.key === source)?.label}: позиция ${keys.indexOf(source) + 1} из ${keys.length}`);
  };
  const save = () => {
    if (busy) return;
    setBusy(true); setError("");
    const positions = [...draft];
    const fullOrder = normalizeNavigation(order).map((key) => hiddenKeys.includes(key) ? key : positions.shift()!);
    void onSave(fullOrder, baseRevision).then(onClose).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Не удалось сохранить меню")).finally(() => setBusy(false));
  };
  return <form id="navigation-editor-form" className="navigation-editor" aria-label="Порядок главного меню" aria-busy={busy}
    onSubmit={(event) => { event.preventDefault(); save(); }}>
    <SpatialSort ids={groups.map((item) => item.key)} onMove={move}>
    <div role="list" aria-label="Разделы меню">
      {groups.map((item) => <SpatialSortItem id={item.key} label={item.label} disabled={busy} key={item.key} role="listitem" className="navigation-edit-row"
        data-navigation-key={item.key}>
        {item.key === "ai_modules" ? <span className="rail-icon"><Sparkle24Regular /></span> : item.icon ? <span className="rail-icon">{item.icon}</span> : null}
        <span className="rail-label">{item.label}</span>
        {item.key !== "ai_modules" && badges?.[item.key] ? <span className="rail-badge">{badges[item.key]! > 99 ? "99+" : badges[item.key]}</span> : null}
      </SpatialSortItem>)}
    </div>
    </SpatialSort>
    <span className="organization-live" role="status">{announcement}</span>
    {error && <div className="organization-error" role="alert">{error}</div>}
    <div className="navigation-edit-actions">
      <button type="button" className="navigation-reset" disabled={busy} onClick={() => { setDraft(navigationKeys.filter((key) => !hiddenKeys.includes(key))); setAnnouncement("Восстановлен стандартный порядок. Нажмите «Сохранить»."); }}>По умолчанию</button>
      <button type="button" className="navigation-cancel" disabled={busy} onClick={onClose}>Отмена</button>
      <button type="submit" className="navigation-save" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button>
    </div>
  </form>;
}
