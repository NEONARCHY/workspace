import { useEffect, useState } from "react";
import type { GrantSummary } from "@yuksalish/contracts";
import { loadGrants } from "./workspace-api";

export function useTeamGrantInbox(token: string, currentUserId: string, enabled: boolean) {
  const [revision, setRevision] = useState(0);
  const [resource, setResource] = useState<{
    key: string;
    grants?: readonly GrantSummary[];
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
        const grants = await loadGrants(token);
        if (active) setResource({ key, grants });
      } catch (error: unknown) {
        if (active) setResource({ key, error: error instanceof Error ? error.message : "Не удалось загрузить гранты." });
      } finally { busy = false; }
    };
    void refresh();
    const refreshVisible = () => { if (document.visibilityState !== "hidden") void refresh(); };
    const timer = window.setInterval(refreshVisible, 15_000);
    window.addEventListener("focus", refreshVisible);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refreshVisible); };
  }, [key, token, currentUserId, enabled]);
  const current = enabled && resource?.key === key ? resource : undefined;
  return {
    launches: current?.grants?.filter((grant) => grant.chairUserId === currentUserId && grant.allowedActions.includes("approve_launch")),
    reviews: current?.grants?.filter((grant) => grant.allowedActions.includes("approve")),
    error: current?.error,
    loading: enabled && !current,
    refresh: () => setRevision((value) => value + 1),
  };
}
