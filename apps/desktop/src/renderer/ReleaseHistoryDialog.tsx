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

function formatUpdateDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatLongDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

export function ReleaseHistoryDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const entries = useMemo(() => [
    ...__YUKSALISH_UPDATE_ENTRIES__.map((update) => ({
      key: `update:${update.id}`,
      label: `${formatUpdateDate(update.date)} · ${update.version}`,
      title: `Обновление ${update.version}`,
      detail: formatLongDate(update.date),
      items: update.items,
    })),
    ...[...__YUKSALISH_RELEASE_HISTORY__]
      .sort((left, right) => compareReleaseVersions(right.version, left.version))
      .map((release) => ({
        key: `release:${release.version}`,
        label: `${formatUpdateDate(release.date)} · ${release.version}`,
        title: `Обновление ${release.version}`,
        detail: formatLongDate(release.date),
        items: release.items,
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
              <WorkspaceSelect aria-label="Обновление" listboxClassName="release-history-options" value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>
                {entries.map((entry) => <option value={entry.key} key={entry.key}>{entry.label}</option>)}
              </WorkspaceSelect>
            </label>
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
