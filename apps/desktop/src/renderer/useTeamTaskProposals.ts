import { useEffect, useState } from "react";
import type { TaskProposal } from "@yuksalish/contracts";
import { loadTaskProposals } from "./workspace-api";

export function useTeamTaskProposals(token: string, currentUserId: string, enabled: boolean) {
  const [revision, setRevision] = useState(0);
  const [resource, setResource] = useState<{
    key: string;
    proposals?: readonly TaskProposal[];
    error?: string;
  }>();
  const key = JSON.stringify([token, currentUserId, revision]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const proposals = await loadTaskProposals(token);
        if (active) setResource({ key, proposals: proposals.filter((item) => item.status === "pending" && item.authorUserId === currentUserId) });
      } catch (error: unknown) {
        if (active) setResource({ key, error: error instanceof Error ? error.message : "Не удалось загрузить запросы на постановку задач." });
      } finally {
        busy = false;
      }
    };
    void refresh();
    const refreshVisible = () => { if (document.visibilityState !== "hidden") void refresh(); };
    const timer = window.setInterval(refreshVisible, 15000);
    window.addEventListener("focus", refreshVisible);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refreshVisible); };
  }, [key, token, currentUserId, enabled]);
  const current = enabled && resource?.key === key ? resource : undefined;
  return {
    proposals: current?.proposals,
    error: current?.error,
    loading: enabled && !current,
    refresh: () => setRevision((value) => value + 1),
  };
}
