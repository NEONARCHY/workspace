import { useCallback, useEffect, useState } from "react";
import { Button } from "@fluentui/react-components";
import { ArrowClockwise24Regular, CheckmarkCircle24Filled } from "@fluentui/react-icons";

import { requestWebReload, workspacePlatform, type WebVersionManifest } from "./platform-adapter";
import { hasPendingMutation } from "./workspace-api";

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

  useEffect(() => {
    if (workspacePlatform.kind !== "web") return;
    let active = true;
    const check = () => {
      void workspacePlatform.checkWebVersion()
        .then((manifest) => {
          if (!active) return;
          const next = manifest && manifest.version !== workspacePlatform.version ? manifest : undefined;
          setAvailable(next);
          onAvailabilityChange?.(Boolean(next));
          setVisible(Boolean(next && (mandatory || (readSnooze(next.version)?.until ?? 0) <= Date.now())));
        })
        .catch(() => undefined);
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
    const timer = window.setInterval(check, 250);
    return () => window.clearInterval(timer);
  }, [available]);

  if (!available || !visible) return null;
  const reload = () => {
    if (hasPendingMutation()) {
      setMutationPending(true);
      return;
    }
    setBusy(true);
    requestWebReload();
  };
  const remindLater = () => {
    const previous = readSnooze(available.version);
    const count = (previous?.count ?? 0) + 1;
    const delayMinutes = count * 30;
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify({ version: available.version, count, until: Date.now() + delayMinutes * 60_000 })); }
    catch { /* storage may be unavailable */ }
    setVisible(false);
  };
  return <aside className="web-update-notice">
    <div className="web-update-dialog" role="dialog" aria-modal="true" aria-live="polite" aria-labelledby="web-update-title">
      <div className="web-update-scroll">
        <div className="web-update-mark" aria-hidden="true"><ArrowClockwise24Regular /></div>
        <span className="web-update-kicker">Обновление Workspace</span>
        <h2 id="web-update-title">{available.title || "Доступна новая версия"}</h2>
        <p className="web-update-version"><span>Версия {workspacePlatform.version}</span><b>→</b><strong>{available.version}</strong></p>
        {available.notes?.length ? <ul>{available.notes.map((note) => <li key={note}><CheckmarkCircle24Filled /> <span>{note}</span></li>)}</ul> : <p className="web-update-summary">В новой версии улучшены стабильность и удобство работы.</p>}
        {mutationPending ? <p className="web-update-warning" role="alert">Сначала дождитесь завершения текущей операции — введённые данные не потеряются.</p> : null}
      </div>
      <footer>
        {!mandatory ? <Button appearance="subtle" disabled={busy} onClick={remindLater}>Напомнить позже</Button> : null}
        <Button appearance="primary" icon={<ArrowClockwise24Regular />} disabled={busy || mutationPending} onClick={reload}>
          Обновить
        </Button>
      </footer>
    </div>
  </aside>;
}
