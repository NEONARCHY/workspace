import { Button, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { ArrowRight20Regular, BookOpen24Regular } from "@fluentui/react-icons";
import { useMemo } from "react";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { ReleaseTimeline } from "./ReleaseTimeline";
import { bundledReleaseEntries, type ReleaseTimelineEntry } from "./release-history";
import "./release-history.css";

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly entries?: readonly ReleaseTimelineEntry[];
  readonly previousVersion?: string;
  readonly currentVersion?: string;
  readonly onAcknowledge?: () => void;
  readonly saving?: boolean;
  readonly error?: string;
}

export function ReleaseHistoryDialog({ open, onOpenChange, entries: suppliedEntries, previousVersion,
  currentVersion, onAcknowledge, saving = false, error }: Props) {
  const bundled = useMemo(() => bundledReleaseEntries(), []);
  const entries = suppliedEntries ?? bundled;
  const catchUp = Boolean(onAcknowledge);
  const current = currentVersion ?? entries[0]?.version;
  const changes = entries.reduce((count, entry) => count + entry.items.length, 0);
  return <WorkspaceDialog open={open} onOpenChange={(_event, data) => { if (!saving) onOpenChange(data.open); }}>
    <DialogSurface className="release-history-dialog release-timeline-dialog" data-release-catchup={catchUp || undefined}>
      <DialogBody>
        <DialogTitle>{catchUp ? "Что изменилось в Workspace" : "Ранние обновления"}</DialogTitle>
        <div className="release-history-intro">
          <span className="release-history-symbol" aria-hidden="true"><BookOpen24Regular /></span>
          <div>{catchUp ? <p>{previousVersion ? "Все изменения после последнего ознакомления — в одной истории."
            : "Отметки в аккаунте ещё нет. Здесь собрана история этой сборки."}</p>
            : <p>Полная история этой сборки — по версиям, без сокращения списка.</p>}
            {current ? <div className="release-history-range"><span>{previousVersion ?? (catchUp ? "Первое ознакомление" : "История Workspace")}</span>
              <ArrowRight20Regular aria-hidden="true" /><strong>{current}</strong></div> : null}
          </div>
        </div>
        <div className="release-history-counts"><span>Версий: <b>{entries.length}</b></span><span>Изменений: <b>{changes}</b></span>
          {catchUp ? <span>Отметка сохраняется в аккаунте</span> : null}</div>
        <DialogContent className="release-history-content release-timeline-scroll" tabIndex={0} aria-label="Полная история изменений">
          {entries.length ? <ReleaseTimeline entries={entries} /> : <p>Новых изменений нет.</p>}
        </DialogContent>
        {error ? <WorkspaceNotice tone="error" role="alert">{error}</WorkspaceNotice> : null}
        <DialogActions className="release-history-actions">
          <Button appearance={catchUp ? "secondary" : "primary"} disabled={saving} onClick={() => onOpenChange(false)}>
            {catchUp ? "Позже" : "Закрыть"}</Button>
          {catchUp ? <Button appearance="primary" disabled={saving || entries.length === 0} onClick={onAcknowledge}>
            {saving ? "Сохраняем отметку…" : "Понятно, продолжить"}</Button> : null}
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </WorkspaceDialog>;
}
