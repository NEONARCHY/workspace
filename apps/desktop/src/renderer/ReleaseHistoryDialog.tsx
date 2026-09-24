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
  const releases = useMemo(() => [{
    version: __YUKSALISH_APP_VERSION__,
    title: __YUKSALISH_RELEASE_NOTES__.title,
    items: __YUKSALISH_RELEASE_NOTES__.items,
  }, ...__YUKSALISH_RELEASE_HISTORY__.filter((release) => release.version !== __YUKSALISH_APP_VERSION__)]
    .sort((left, right) => compareReleaseVersions(right.version, left.version)), []);
  const [selectedVersion, setSelectedVersion] = useState(releases[0]?.version ?? "");
  const selectedRelease = releases.find((release) => release.version === selectedVersion) ?? releases[0];

  return <WorkspaceDialog open={open} onOpenChange={(_event, data) => onOpenChange(data.open)}>
    <DialogSurface className="release-history-dialog">
      <DialogBody>
        <DialogTitle>Ранние обновления</DialogTitle>
        <DialogContent className="release-history-content">
          {selectedRelease ? <>
            <label className="release-version-picker">
              <span>Версия обновления</span>
              <WorkspaceSelect aria-label="Версия обновления" value={selectedVersion} onChange={(event) => setSelectedVersion(event.target.value)}>
                {releases.map((release) => <option value={release.version} key={release.version}>Версия {release.version}</option>)}
              </WorkspaceSelect>
            </label>
            <section key={selectedRelease.version}>
            <div className="release-history-heading">
              <h3>{selectedRelease.title}</h3>
              <span>Версия {selectedRelease.version}</span>
            </div>
            <ul>{selectedRelease.items.map((item) => <li key={item}><CheckmarkCircle20Filled /><span>{item}</span></li>)}</ul>
            </section>
          </> : <p>История обновлений пока пуста.</p>}
        </DialogContent>
        <DialogActions><Button appearance="primary" onClick={() => onOpenChange(false)}>Закрыть</Button></DialogActions>
      </DialogBody>
    </DialogSurface>
  </WorkspaceDialog>;
}
