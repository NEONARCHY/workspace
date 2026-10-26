import { WorkspaceNotice } from "./WorkspaceNotice";
import { useCallback, useEffect, useState } from "react";
import { Button, DialogSurface } from "@fluentui/react-components";
import { ArrowClockwise24Regular } from "@fluentui/react-icons";

import { requestWebReload, workspacePlatform, type WebVersionManifest } from "./platform-adapter";
import { hasPendingMutation } from "./workspace-api";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { compareReleaseVersions } from "./release-versions.mts";
import "./release-history.css";

const SNOOZE_KEY = "yuksalish:web:update-snooze";

interface UpdateSnooze {
  readonly version: string;
  readonly count: number;
  readonly until: number;
}

function readSnooze(version: string): UpdateSnooze | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? "null") as Partial<UpdateSnooze> | null;
    return value?.version === version && typeof value.count === "number" && typeof value.until === "number"
      ? value as UpdateSnooze : undefined;
  } catch { return undefined; }
}

export function WebUpdateNotice({ mandatory = false, onAvailabilityChange }: {
  readonly mandatory?: boolean;
  readonly onAvailabilityChange?: (available: boolean) => void;
}) {
  const [available, setAvailable] = useState<WebVersionManifest>();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const [reloadError, setReloadError] = useState(false);

  useEffect(() => {
    if (workspacePlatform.kind !== "web") return;
    let active = true;
    let checked = false;
    const check = () => {
      void workspacePlatform.checkWebVersion()
        .then((manifest) => {
          if (!active) return;
          checked = true;
          const next = manifest && compareReleaseVersions(manifest.version, workspacePlatform.version) > 0 ? manifest : undefined;
          setAvailable(next);
          onAvailabilityChange?.(Boolean(next));
          setVisible(Boolean(next && (mandatory || (readSnooze(next.version)?.until ?? 0) <= Date.now())));
        })
        .catch(() => {
          // A failed initial check must not hide installed history indefinitely.
          // A later network error must not erase a known pending update.
          if (active && !checked) onAvailabilityChange?.(false);
        });
    };
    check();
    const timer = window.setInterval(check, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [mandatory, onAvailabilityChange]);

  const showUpdate = useCallback(() => {
    if (available) setVisible(true);
  }, [available]);
  useEffect(() => {
    window.addEventListener("yuksalish:show-web-update", showUpdate);
    return () => window.removeEventListener("yuksalish:show-web-update", showUpdate);
  }, [showUpdate]);

  useEffect(() => {
    if (!available) return;
    const check = () => setMutationPending(hasPendingMutation());
    check();
    const timer = window.setInterval(check, 250);
    return () => window.clearInterval(timer);
  }, [available]);

  useEffect(() => {
    if (!busy) return;
    // Successful navigation unmounts this tree. If it was cancelled, allow retry.
    const timer = window.setTimeout(() => { setBusy(false); setReloadError(true); }, 15_000);
    return () => window.clearTimeout(timer);
  }, [busy]);

  if (!available || !visible) return null;
  const reload = () => {
    if (hasPendingMutation()) {
      setMutationPending(true);
      return;
    }
    setBusy(true);
    setReloadError(false);
    try { requestWebReload(); }
    catch { setBusy(false); setReloadError(true); }
  };
  const remindLater = () => {
    const previous = readSnooze(available.version);
    const count = (previous?.count ?? 0) + 1;
    const delayMinutes = count * 30;
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify({ version: available.version, count, until: Date.now() + delayMinutes * 60_000 })); }
    catch { /* storage may be unavailable */ }
    setVisible(false);
  };
  const content = <>
      <div className="web-update-scroll">
        <div className="web-update-mark" aria-hidden="true"><ArrowClockwise24Regular /></div>
        <span className="web-update-kicker">Обновление Workspace</span>
        <h2 id="web-update-title">Доступна новая версия</h2>
        <p className="web-update-version"><span>Версия {workspacePlatform.version}</span><b>→</b><strong>{available.version}</strong></p>
        <p className="web-update-summary">{mandatory ? "Требуется обновление. " : ""}После обновления покажем все пропущенные изменения в одном окне.</p>
        {reloadError ? <WorkspaceNotice tone="error" role="alert">Не удалось запустить обновление. Повторите попытку — отметки об ознакомлении не изменены.</WorkspaceNotice> : null}
        {mutationPending ? <WorkspaceNotice tone="warning" className="web-update-warning" role="alert">Сначала дождитесь завершения текущей операции — введённые данные не потеряются.</WorkspaceNotice> : null}
      </div>
      <footer>
        {!mandatory ? <Button appearance="subtle" disabled={busy} onClick={remindLater}>Напомнить позже</Button> : null}
        <Button appearance="primary" icon={<ArrowClockwise24Regular />} disabled={busy || mutationPending} onClick={reload}>
          Обновить
        </Button>
      </footer>
  </>;
  if (mandatory) return <WorkspaceDialog open modalType="alert">
    <DialogSurface className="web-update-dialog" aria-labelledby="web-update-title">{content}</DialogSurface>
  </WorkspaceDialog>;
  return <aside className="web-update-notice" aria-label="Обновление Workspace">
    <div className="web-update-dialog" role="region" aria-live="polite" aria-labelledby="web-update-title">{content}</div>
  </aside>;
}
