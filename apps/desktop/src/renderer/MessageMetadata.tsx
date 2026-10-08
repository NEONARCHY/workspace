import type { ChatMessage } from "@yuksalish/contracts";

/** A persisted message is sent; only a server receipt can make it read. */
export function MessageMetadata({ message, own }: { readonly message: ChatMessage; readonly own: boolean }) {
  const read = message.readByRecipient === true;
  return <span className="message-meta">
    <time className="message-timestamp">{message.editedAt && !message.deletedAt ? "изменено · " : ""}{message.time}</time>
    {own && !message.deletedAt && <span className={`message-delivery${read ? " is-read" : ""}`} role="img"
      aria-label={read ? "Сообщение прочитано" : "Сообщение отправлено"} title={read ? "Прочитано" : "Отправлено"}>
      <svg width="18" height="14" viewBox="0 0 20 16" fill="none" aria-hidden="true">
        <path d="M2 8.5 6 12.5 14 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {read && <path d="m10 11.5 2 2 7-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    </span>}
  </span>;
}
