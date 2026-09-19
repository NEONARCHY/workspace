import {
  Button,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from "@fluentui/react-components";
import { CheckmarkCircle20Filled } from "@fluentui/react-icons";

import { WorkspaceDialog } from "./WorkspaceDialog";

export function ReleaseHistoryDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return <WorkspaceDialog open={open} onOpenChange={(_event, data) => onOpenChange(data.open)}>
    <DialogSurface className="release-history-dialog">
      <DialogBody>
        <DialogTitle>Ранние обновления</DialogTitle>
        <DialogContent className="release-history-content">
          {__YUKSALISH_RELEASE_HISTORY__.length ? __YUKSALISH_RELEASE_HISTORY__.map((release) => <section key={release.version}>
            <div className="release-history-heading">
              <h3>{release.title}</h3>
              <span>Версия {release.version}</span>
            </div>
            <ul>{release.items.map((item) => <li key={item}><CheckmarkCircle20Filled /><span>{item}</span></li>)}</ul>
          </section>) : <p>История обновлений пока пуста.</p>}
        </DialogContent>
        <DialogActions><Button appearance="primary" onClick={() => onOpenChange(false)}>Закрыть</Button></DialogActions>
      </DialogBody>
    </DialogSurface>
  </WorkspaceDialog>;
}
