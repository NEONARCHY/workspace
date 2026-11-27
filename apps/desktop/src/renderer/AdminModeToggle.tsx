import { useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { ShieldCheckmark20Regular, Shield20Regular } from "@fluentui/react-icons";
import { setAdministratorMode } from "./workspace-api";
import { WorkspaceNotice } from "./WorkspaceNotice";
import "./admin-mode-toggle.css";

const reloadSession = () => window.location.reload();

export function useAdministratorMode(token: string, enabled: boolean, onChanged = reloadSession) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const change = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError("");
    try {
      await setAdministratorMode(token, !enabled);
      // Refresh the effective session and discard data loaded with old permissions.
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось изменить режим.");
      pending.current = false; setBusy(false);
    }
  };
  return { busy, error, change, clearError: () => setError("") };
}

export function AdminModeControl({ enabled, state }: { readonly enabled: boolean; readonly state: ReturnType<typeof useAdministratorMode> }) {
  const { busy, error, change, clearError } = state;
  const button = useRef<HTMLButtonElement>(null);
  const wasBusy = useRef(busy);
  useEffect(() => {
    // Native disabled buttons lose focus. Restore it after failure so Escape
    // and keyboard retry still operate inside the profile popover.
    if (wasBusy.current && !busy && error && document.activeElement === document.body) button.current?.focus({ preventScroll: true });
    wasBusy.current = busy;
  }, [busy, error]);
  const description = enabled
    ? "Включён: административные права. Нажмите для работы с правами своей должности."
    : "Выключен: права своей должности. Нажмите для включения административных прав.";
  return <div className="admin-mode-toggle-wrap">
      <Button className="admin-mode-toggle" role="switch" aria-label="Режим администратора"
        ref={button}
        aria-description={description}
        aria-checked={enabled} aria-busy={busy} disabled={busy} appearance="subtle"
        icon={enabled ? <ShieldCheckmark20Regular /> : <Shield20Regular />}
        onClick={() => void change()}>
        <span className="admin-mode-copy"><span>Режим администратора</span><small>{enabled ? "Выключить права администратора" : "Вернуть права администратора"}</small></span>
      </Button>
    {error && <WorkspaceNotice tone="error" role="alert" className="admin-mode-error"
      actions={<Button appearance="subtle" onClick={clearError}>Закрыть</Button>}>{error}</WorkspaceNotice>}
  </div>;
}

export function AdminModeToggle({ token, enabled, onChanged }: { readonly token: string; readonly enabled: boolean; readonly onChanged?: () => void }) {
  const state = useAdministratorMode(token, enabled, onChanged);
  return <AdminModeControl enabled={enabled} state={state} />;
}
