import { useEffect, useState } from "react";
import type { DossierPermissions, WorkspacePerson } from "@yuksalish/contracts";
import { Button } from "@fluentui/react-components";
import { loadDossierPermissions } from "./workspace-api";
import { DossierDialog } from "./DossierDialog";

export function DossierProfileEntry({ token, userId, people }: {
  readonly token: string; readonly userId: string; readonly people: readonly WorkspacePerson[];
}) {
  const [permissions, setPermissions] = useState<DossierPermissions>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    loadDossierPermissions(token, userId).then((value) => { if (active) { setPermissions(value); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [token, userId, retry]);
  if (failed) return <Button size="small" appearance="subtle" onClick={() => setRetry((n) => n + 1)}>Повторить проверку доступа к объективке</Button>;
  if (!permissions?.canView) return null;
  return <><Button className="employee-profile-chat-action" size="small" onClick={() => setOpen(true)}>Объективка</Button>{open ? <DossierDialog token={token} userId={userId} people={people} onClose={() => setOpen(false)} /> : null}</>;
}
