import { Tooltip } from "@fluentui/react-components";
import { Alert24Regular } from "@fluentui/react-icons";

export function NotificationBell({ unreadCount, active, onOpen }: {
  readonly unreadCount: number;
  readonly active: boolean;
  readonly onOpen: () => void;
}) {
  const unread = unreadCount > 0;
  const label = unread ? `Уведомления: непрочитанных ${unreadCount}` : "Уведомления";
  return <div className="notification-bell-wrap">
    <Tooltip content={label} relationship="description">
      <button type="button" className="notification-bell" aria-label={label} aria-pressed={active}
        data-unread={unread ? "true" : undefined} onClick={onOpen}>
        <span className="notification-bell-icon" aria-hidden="true"><Alert24Regular /></span>
        {unread && <span className="notification-bell-dot" aria-hidden="true" />}
      </button>
    </Tooltip>
  </div>;
}
