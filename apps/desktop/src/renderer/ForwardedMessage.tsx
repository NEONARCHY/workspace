import type { ChatMessage } from "@yuksalish/contracts";
import { ArrowForward20Regular, News20Regular } from "@fluentui/react-icons";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { MessageTextAnimate } from "./MessageTextAnimate";

export function ForwardedMessage({ message, onOpenPost, animateText = false, motionDisabled = false, voice = false }: {
  readonly message: ChatMessage; readonly onOpenPost?: (id: string) => void | Promise<void>;
  readonly animateText?: boolean; readonly motionDisabled?: boolean;
  readonly voice?: boolean;
}) {
  const origin = message.forwarded;
  if (!origin) return null;
  if (voice && origin.kind === "message") return <section className="message-forwarded-voice" aria-label="Пересланное сообщение">
    <span>Переслано от </span>{origin.authorId
      ? <EmployeeProfileLink userId={origin.authorId} personName={origin.authorName}>{origin.authorName}</EmployeeProfileLink>
      : <span>{origin.authorName}</span>}
  </section>;
  return <section className={`message-forwarded message-forwarded-${origin.kind}`} aria-label={origin.kind === "feed" ? "Объявление из ленты" : "Пересланное сообщение"}>
    <div className="message-forwarded-heading"><ArrowForward20Regular aria-hidden="true" />
      <span>{origin.kind === "feed" ? "Объявление из ленты" : "Пересланное сообщение"}</span></div>
    <div className="message-forwarded-author">{origin.authorId
      ? <EmployeeProfileLink userId={origin.authorId} personName={origin.authorName}>{origin.authorName}</EmployeeProfileLink>
      : <span>{origin.authorName}</span>}</div>
    {origin.kind === "feed" ? <button type="button" className="message-feed-preview" disabled={!origin.available || !onOpenPost || !origin.postId}
      onClick={() => { if (origin.available && origin.postId) void onOpenPost?.(origin.postId); }}>
      <News20Regular aria-hidden="true" /><span><strong>{origin.available ? origin.title : "Оригинал недоступен"}</strong>
        {origin.available && <small><MessageTextAnimate key={`${message.id}:${animateText}`} enabled={animateText} disabled={motionDisabled}>{message.body}</MessageTextAnimate></small>}<em>{origin.available ? "Открыть в ленте →" : "Объявление удалено или доступ ограничен"}</em></span>
    </button> : <p className="message-text" data-message-text><MessageTextAnimate entities={message.entities} key={`${message.id}:${animateText}`} enabled={animateText} disabled={motionDisabled}>{message.body}</MessageTextAnimate></p>}
  </section>;
}
