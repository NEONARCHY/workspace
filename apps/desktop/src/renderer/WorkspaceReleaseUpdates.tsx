import { useCallback, useState } from "react";
import { AccountReleaseUpdates } from "./AccountReleaseUpdates";
import { WebUpdateNotice } from "./WebUpdateNotice";
import { workspacePlatform } from "./platform-adapter";

/** Mount keyed by account and server. Never acknowledge notes for a future build. */
export function WorkspaceReleaseUpdates({ token, mandatory, onAvailabilityChange }: {
  readonly token: string;
  readonly mandatory?: boolean;
  readonly onAvailabilityChange?: (available: boolean) => void;
}) {
  const [available, setAvailable] = useState<boolean>();
  const reportAvailability = useCallback((next: boolean) => {
    setAvailable(next);
    onAvailabilityChange?.(next);
  }, [onAvailabilityChange]);
  return <>
    <WebUpdateNotice mandatory={mandatory} onAvailabilityChange={reportAvailability} />
    <AccountReleaseUpdates token={token}
      deferred={workspacePlatform.kind === "web" && available !== false} />
  </>;
}
