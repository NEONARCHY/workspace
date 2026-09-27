import {
  Button,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from "@fluentui/react-components";
import { CheckmarkCircle20Filled } from "@fluentui/react-icons";
import { useMemo, useState } from "react";

import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { compareReleaseVersions } from "./release-versions.mts";

export function ReleaseHistoryDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const entries = useMemo(() => [
    ...__YUKSALISH_RELEASE_PREVIEW__.map((preview) => ({
      key: `preview:${preview.id}`,
      label: preview.label,
      title: "Тестовое изменение",
      detail: new Date(`${preview.date}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }),
      items: preview.items,
      preview: true,
    })),
    ...[...__YUKSALISH_RELEASE_HISTORY__]
      .sort((left, right) => compareReleaseVersions(right.version, left.version))
      .map((release) => ({
        key: `release:${release.version}`,
        label: `Версия ${release.version}`,
        title: release.title,
        detail: `Версия ${release.version}`,
        items: release.items,
        preview: false,
      })),
  ], []);
  const [selectedKey, setSelectedKey] = useState(entries[0]?.key ?? "");
  const selectedEntry = entries.find((entry) => entry.key === selectedKey) ?? entries[0];

  return <WorkspaceDialog open={open} onOpenChange={(_event, data) => onOpenChange(data.open)}>
    <DialogSurface className="release-history-dialog">
      <DialogBody>
        <DialogTitle>Ранние обновления</DialogTitle>
        <DialogContent className="release-history-content">
          {selectedEntry ? <>
            <label className="release-version-picker">
              <span>Обновление</span>
              <WorkspaceSelect aria-label="Обновление" value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>
                {entries.map((entry) => <option value={entry.key} key={entry.key}>{entry.label}</option>)}
              </WorkspaceSelect>
            </label>
            {selectedEntry.preview ? <p className="release-preview-note">Тестовые изменения показаны по отдельности. Новая официальная версия появится после публикации.</p> : null}
            <section key={selectedEntry.key}>
            <div className="release-history-heading">
              <h3>{selectedEntry.title}</h3>
              <span>{selectedEntry.detail}</span>
            </div>
            <ul>{selectedEntry.items.map((item) => <li key={item}><CheckmarkCircle20Filled /><span>{item}</span></li>)}</ul>
            </section>
          </> : <p>История обновлений пока пуста.</p>}
        </DialogContent>
        <DialogActions><Button appearance="primary" onClick={() => onOpenChange(false)}>Закрыть</Button></DialogActions>
      </DialogBody>
    </DialogSurface>
  </WorkspaceDialog>;
}
