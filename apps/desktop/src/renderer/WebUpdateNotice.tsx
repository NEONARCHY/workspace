import { useEffect, useState } from "react";
import { Button } from "@fluentui/react-components";
import { ArrowClockwise24Regular, CheckmarkCircle24Filled } from "@fluentui/react-icons";

import { requestWebReload, workspacePlatform, type WebVersionManifest } from "./platform-adapter";
import { hasPendingMutation } from "./workspace-api";

export function WebUpdateNotice() {
  const [available, setAvailable] = useState<WebVersionManifest>();
  const [busy, setBusy] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);

  useEffect(() => {
    if (workspacePlatform.kind !== "web") return;
    let active = true;
    const check = () => {
      void workspacePlatform.checkWebVersion()
        .then((manifest) => {
          if (active && manifest && manifest.version !== workspacePlatform.version) setAvailable(manifest);
        })
        .catch(() => undefined);
    };
    check();
    const timer = window.setInterval(check, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!available) return;
    const check = () => setMutationPending(hasPendingMutation());
    const timer = window.setInterval(check, 250);
    return () => window.clearInterval(timer);
  }, [available]);

  if (!available) return null;
  const reload = () => {
    if (hasPendingMutation()) {
      setMutationPending(true);
      return;
    }
    setBusy(true);
    requestWebReload();
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
        <Button appearance="primary" icon={<ArrowClockwise24Regular />} disabled={busy || mutationPending} onClick={reload}>
          Обновить
        </Button>
      </footer>
    </div>
  </aside>;
}
