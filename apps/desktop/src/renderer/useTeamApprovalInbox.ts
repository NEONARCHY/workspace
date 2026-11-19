import { useEffect, useState } from "react";
import type { TeamApprovalInbox, TeamApprovalInboxKind } from "@yuksalish/contracts";
import { loadTeamApprovalInbox } from "./workspace-api";

export function useTeamApprovalInbox(token: string, userId: string, kind: TeamApprovalInboxKind, enabled: boolean, refreshRevision = 0) {
  const [revision, setRevision] = useState(0);
  const [resource, setResource] = useState<{
    key: string;
    actorKey: string;
    inbox?: TeamApprovalInbox;
    error?: string;
  }>();
  const actorKey = JSON.stringify([token, userId, kind]);
  const key = JSON.stringify([token, userId, kind, revision, refreshRevision]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const inbox = await loadTeamApprovalInbox(token, kind, controller.signal);
        if (!controller.signal.aborted) setResource({ key, actorKey, inbox });
      } catch (error: unknown) {
        if (!controller.signal.aborted) setResource({ key, actorKey, error: error instanceof Error ? error.message : "Не удалось загрузить согласования." });
      } finally { busy = false; }
    };
    const refreshVisible = () => { if (document.visibilityState !== "hidden") void refresh(); };
    void refresh();
    const timer = window.setInterval(refreshVisible, 15_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [key, actorKey, token, kind, enabled]);
  const current = enabled && resource?.key === key ? resource : undefined;
  return {
    // Module access alone does not imply a personal approval role.
    // Unknown eligibility must not flash a card that the response will hide.
    visible: enabled && ((resource?.actorKey === actorKey && resource.inbox?.enabled === true)
      || Boolean(current?.error)),
    items: current?.inbox?.items,
    loading: enabled && !current,
    error: current?.error,
    refresh: () => setRevision((value) => value + 1),
  };
}
