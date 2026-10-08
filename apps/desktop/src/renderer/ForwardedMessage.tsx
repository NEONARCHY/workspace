import type { ChatMessage } from "@yuksalish/contracts";
import { ArrowForward20Regular, News20Regular } from "@fluentui/react-icons";
import { EmployeeProfileLink } from "./EmployeeProfileLink";

export function ForwardedMessage({ message, onOpenPost }: {
  readonly message: ChatMessage; readonly onOpenPost?: (id: string) => void | Promise<void>;
}) {
  const origin = message.forwarded;
  if (!origin) return null;
  return <section className={`message-forwarded message-forwarded-${origin.kind}`} aria-label={origin.kind === "feed" ? "Объявление из ленты" : "Пересланное сообщение"}>
    <div className="message-forwarded-heading"><ArrowForward20Regular aria-hidden="true" />
      <span>{origin.kind === "feed" ? "Объявление из ленты" : "Пересланное сообщение"}</span></div>
    <div className="message-forwarded-author">{origin.authorId
      ? <EmployeeProfileLink userId={origin.authorId} personName={origin.authorName}>{origin.authorName}</EmployeeProfileLink>
      : <span>{origin.authorName}</span>}</div>
    {origin.kind === "feed" ? <button type="button" className="message-feed-preview" disabled={!origin.available || !onOpenPost || !origin.postId}
      onClick={() => { if (origin.available && origin.postId) void onOpenPost?.(origin.postId); }}>
      <News20Regular aria-hidden="true" /><span><strong>{origin.available ? origin.title : "Оригинал недоступен"}</strong>
        {origin.available && <small>{message.body}</small>}<em>{origin.available ? "Открыть в ленте →" : "Объявление удалено или доступ ограничен"}</em></span>
    </button> : <p className="message-text">{message.body}</p>}
  </section>;
}
