import { Button } from "@fluentui/react-components";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReleaseReadState } from "@yuksalish/contracts";
import { acknowledgeReleaseReads, loadReleaseReads } from "./workspace-api";
import { bundledReleaseEntries, latestReadReleaseVersion, unreadReleaseEntries, type ReleaseTimelineEntry } from "./release-history";
import { ReleaseHistoryDialog } from "./ReleaseHistoryDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";

function unionReads(current: ReleaseReadState | undefined, next: ReleaseReadState): ReleaseReadState {
  return { readEntryIds: [...new Set([...(current?.readEntryIds ?? []), ...next.readEntryIds])] };
}

/** Mount keyed by account and server. Viewing or dismissing never writes receipts. */
export function AccountReleaseUpdates({ token, entries: suppliedEntries }: {
  readonly token: string; readonly entries?: readonly ReleaseTimelineEntry[];
}) {
  const entries = useMemo(() => suppliedEntries ?? bundledReleaseEntries(), [suppliedEntries]);
  const [reads, setReads] = useState<ReleaseReadState>();
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [dismissed, setDismissed] = useState(false);
  const [reload, setReload] = useState(0);
  const [blocked, setBlocked] = useState(true);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || savingRef.current) return;
      try {
        const next = await loadReleaseReads(token);
        if (!active) return;
        if (!Array.isArray(next?.readEntryIds)) throw new Error("Invalid release receipts");
        // The server store is append-only: stale GETs cannot erase a successful acknowledgement.
        setReads(current => unionReads(current, next)); setLoadError("");
      } catch {
        if (active) setLoadError("Не удалось проверить просмотренные обновления. Отметки не изменены.");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false; window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [token, reload]);

  const unread = useMemo(() => reads ? unreadReleaseEntries(entries, reads.readEntryIds) : [], [entries, reads]);
  const candidate = !dismissed && unread.length > 0;
  useEffect(() => {
    if (!candidate) return;
    const check = () => setBlocked([...document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"]')]
      .some(dialog => !dialog.closest("[data-release-catchup]")));
    check();
    const timer = window.setInterval(check, 500);
    return () => window.clearInterval(timer);
  }, [candidate]);

  const acknowledge = async () => {
    if (savingRef.current || unread.length === 0) return;
    savingRef.current = true; setSaving(true); setSaveError("");
    const entryIds = unread.map(entry => entry.id);
    try {
      const next = await acknowledgeReleaseReads(token, { entryIds });
      if (!entryIds.every(id => next?.readEntryIds?.includes(id))) throw new Error("Incomplete release receipts");
      setReads(current => unionReads(current, next));
    } catch {
      setSaveError("Не удалось сохранить отметку в аккаунте. История остаётся непросмотренной — повторите попытку.");
    } finally { savingRef.current = false; setSaving(false); }
  };

  return <>
    {loadError && !dismissed && !candidate ? <aside className="release-read-check-error"><WorkspaceNotice tone="warning" role="status">
      {loadError}<Button size="small" onClick={() => setReload(value => value + 1)}>Повторить проверку</Button>
      <Button size="small" onClick={() => setDismissed(true)}>Позже</Button>
    </WorkspaceNotice></aside> : null}
    <ReleaseHistoryDialog open={candidate && !blocked} onOpenChange={open => { if (!open) setDismissed(true); }}
      entries={unread} currentVersion={entries[0]?.version}
      previousVersion={reads ? latestReadReleaseVersion(entries, reads.readEntryIds) : undefined}
      onAcknowledge={() => void acknowledge()} saving={saving} error={saveError || loadError} />
  </>;
}
