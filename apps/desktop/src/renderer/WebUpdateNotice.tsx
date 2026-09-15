import { useEffect, useState } from "react";
import { Button } from "@fluentui/react-components";

import { requestWebReload, workspacePlatform } from "./platform-adapter";
import { hasPendingMutation } from "./workspace-api";

export function WebUpdateNotice() {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);

  useEffect(() => {
    if (workspacePlatform.kind !== "web") return;
    let active = true;
    const check = () => {
      void workspacePlatform.checkWebVersion()
        .then((manifest) => {
          if (active && manifest && manifest.buildId !== workspacePlatform.buildId) setAvailable(true);
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
  return <aside className="web-update-notice" role="status" aria-live="polite">
    <span>Доступна новая версия Workspace.</span>
    <Button size="small" appearance="primary" disabled={busy || mutationPending} onClick={reload}>
      {mutationPending ? "Дождитесь завершения операции" : "Обновить"}
    </Button>
    <Button size="small" appearance="subtle" onClick={() => setAvailable(false)}>Позже</Button>
  </aside>;
}
