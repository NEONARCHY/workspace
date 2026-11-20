import { useRef, useState } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { ShieldCheckmark20Regular, Shield20Regular } from "@fluentui/react-icons";
import { setAdministratorMode } from "./workspace-api";
import { WorkspaceNotice } from "./WorkspaceNotice";
import "./admin-mode-toggle.css";

export function AdminModeToggle({ token, enabled, onChanged = () => window.location.reload() }: {
  readonly token: string;
  readonly enabled: boolean;
  readonly onChanged?: () => void;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const description = enabled
    ? "Включён: административные права. Нажмите для работы с правами своей должности."
    : "Выключен: права своей должности. Нажмите для включения административных прав.";
  return <div className="admin-mode-toggle-wrap">
    <Tooltip content={description} relationship="description">
      <Button className="admin-mode-toggle" role="switch" aria-label="Режим администратора"
        aria-checked={enabled} aria-busy={busy} disabled={busy} appearance="subtle"
        icon={enabled ? <ShieldCheckmark20Regular /> : <Shield20Regular />}
        onClick={async () => {
          if (pending.current) return;
          pending.current = true;
          setBusy(true); setError("");
          try {
            await setAdministratorMode(token, !enabled);
            // Restore the same refresh session with its effective role, while
            // discarding open dialogs, cached lists and outstanding old readers.
            onChanged();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Не удалось изменить режим.");
            pending.current = false; setBusy(false);
          }
        }} />
    </Tooltip>
    {error && <WorkspaceNotice tone="error" role="alert" className="admin-mode-error"
      actions={<Button appearance="subtle" onClick={() => setError("")}>Закрыть</Button>}>{error}</WorkspaceNotice>}
  </div>;
}
