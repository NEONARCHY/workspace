import type { ReactNode } from "react";
import { Button } from "@fluentui/react-components";
import type { WorkspaceNotification } from "@yuksalish/contracts";
import "./progressive-notifications.css";
import { PROGRESSIVE_BATCH_SIZE, useProgressiveList } from "./useProgressiveList";

export const NOTIFICATION_BATCH_SIZE = PROGRESSIVE_BATCH_SIZE;

/** Page-local cards only. Leaving the section releases the list and its observer. */
export function ProgressiveNotificationList({ items, children }: {
  readonly items: readonly WorkspaceNotification[];
  readonly children: (item: WorkspaceNotification) => ReactNode;
}) {
  const { stream, sentinel, shown, hasMore, loadMore } = useProgressiveList(items.length, "notifications", ".notification-open");

  return <div className="notification-stream" ref={stream}>
    {items.slice(0, shown).map(children)}
    {hasMore ? <div className="notification-load-more" ref={sentinel}>
      <span aria-live="polite">Показано {shown} из {items.length}</span>
      <Button onClick={() => loadMore(true)}>
        Показать ещё {Math.min(NOTIFICATION_BATCH_SIZE, items.length - shown)}
      </Button>
    </div> : null}
  </div>;
}
