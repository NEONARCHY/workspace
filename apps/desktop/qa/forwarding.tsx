// Development-only, in-memory fixture. No publication or message is sent to an API.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, Button } from "@fluentui/react-components";
import type { ChatMessage, FeedPost, NotificationPreferences, WorkspaceAttachment } from "@yuksalish/contracts";
import { FeedView } from "../src/renderer/FeedView";
import { ForwardedMessage } from "../src/renderer/ForwardedMessage";
import { MessageMetadata } from "../src/renderer/MessageMetadata";
import { VoiceMessagePlayer } from "../src/renderer/VoiceMessage";
import notificationClip from "../src/renderer/assets/workspace-notification.mp3";
import { EmployeeProfileProvider } from "../src/renderer/EmployeeProfileLink";
import { NotificationCenter } from "../src/renderer/NotificationCenter";
import { initialChats, people } from "../src/renderer/test-fixtures/demo-data";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/design-system.css";
import "../src/renderer/message-layout.css";
import "../src/renderer/forwarding.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workspace-2-interactions.css";
import "../src/renderer/workspace-2-messenger.css";
import "../src/renderer/workspace-2-notifications.css";
import "../src/renderer/workspace-2-focus.css";
import "../src/renderer/scrollbars.css";
import "../src/renderer/accent-surfaces.css";
import "../src/renderer/section-headers.css";
import "../src/renderer/page-canvas.css";

const post: FeedPost = { id: "qa-post", authorUserId: "aziza", title: "Материалы для встречи готовы",
  body: "Обновлённый план проекта и ближайшие сроки собраны в одном месте. Пожалуйста, просмотрите материалы перед общей встречей.",
  isPinned: false, likedByCurrentUser: false, likeCount: 0, reactions: [], canEdit: false,
  canPin: false, comments: [], createdAt: "2026-10-08T09:00:00+05:00", updatedAt: "2026-10-08T09:00:00+05:00" };
const message: ChatMessage = { id: "qa-copy", chatId: "finance", authorId: "dilshod", own: false, body: "Подтверждаем встречу на завтра. Материалы уже собраны в ленте.", time: "14:09",
  forwarded: { kind: "message", authorId: "aziza", authorName: "Азиза Каримова", available: true } };
const audio: WorkspaceAttachment = { id: "qa-audio", ownerType: "message", ownerId: "qa-voice", fileName: "workspace-notification.mp3",
  contentType: "audio/mpeg", byteSize: 50990, sha256: "a".repeat(64), uploadedByUserId: "dilshod", documentRole: "general",
  mediaKind: "voice", mediaDurationMs: 7000, createdAt: "2026-10-08T09:00:00+05:00" };
function Demo() {
  const [view, setView] = useState("cards"), [profile, setProfile] = useState(""), [focused, setFocused] = useState<string>();
  const [prefs, setPrefs] = useState<NotificationPreferences>({ desktopEnabled: false, feedEnabled: true, soundEnabled: true, soundVolume: 20,
    messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true, tripsEnabled: true, calendarEnabled: true, absencesEnabled: true, zoomEnabled: true, remindersEnabled: true });
  return <FluentProvider theme={workspaceTheme} className="app-provider" style={{ minHeight: "100dvh", overflow: "auto" }}>
    <nav style={{ padding: 20, display: "flex", gap: 12, flexWrap: "wrap" }} aria-label="Проверочные состояния">
      <Button onClick={() => setView("cards")}>Пересланные сообщения</Button><Button onClick={() => setView("feed")}>Объявление в ленте</Button><Button onClick={() => setView("notices")}>Настройки уведомлений</Button>
    </nav>
    <EmployeeProfileProvider onOpenProfile={id => setProfile(`Запрошен профиль: ${id}`)}>
      {view === "cards" ? <main className="messenger-view" style={{ padding: 20, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 20, maxWidth: 580, background: "transparent" }}>
        <h1>Пересылка в чате</h1>
        <h2>Короткие сообщения: отправлено и прочитано</h2>
        <div>
          {[false, true].map((read, index) => {
            const short = { ...message, id: `qa-short-${index}`, body: "а", time: "15:47", forwarded: null, readByRecipient: read };
            return <div className={`message-row ${index === 0 ? "is-group-first" : "is-group-last"}`} key={short.id}>
              <div className="message own"><div className="message-content"><div className="message-body">
                <p className="message-text">{short.body}</p><MessageMetadata message={short} own />
              </div></div></div>
            </div>;
          })}
        </div>
        {[message, { ...message, id: "qa-feed", body: post.body, forwarded: { ...message.forwarded!, kind: "feed" as const, postId: post.id, title: post.title } },
          { ...message, id: "qa-unavailable", forwarded: { kind: "feed" as const, authorId: null, authorName: "Объявление недоступно", available: false, postId: "deleted" } }]
          .map(item => <div className="message own" key={item.id}><div className="message-content"><div className="message-body has-rich-content"><ForwardedMessage message={item} onOpenPost={id => { setFocused(id); setView("feed"); }} /><MessageMetadata message={item} own /></div></div></div>)}
        <h2>Аудиосообщение</h2>
        <p>Проверочный плеер использует присланный звук уведомления.</p>
        <div className="message own"><div className="message-content"><div className="message-body has-rich-content">
          <VoiceMessagePlayer attachment={audio} onLoad={async () => (await fetch(notificationClip)).blob()} />
          <MessageMetadata message={{ ...message, time: "14:15" }} own />
        </div></div></div>
        {profile && <p role="status">{profile}</p>}
      </main> : <main className="app-content" style={{ height: "calc(100dvh - 75px)" }}>
        {view === "feed" ? <FeedView posts={[post]} people={people} token="" currentUserId="aziza" chats={initialChats} focusPostId={focused}
          onCreate={async () => post} onComment={async () => post} onReact={async () => post} onDeleteComment={async () => post} onPin={async () => post} onDelete={async () => true}
          onForwardContent={async () => message} /> : <NotificationCenter notifications={[]} preferences={prefs} onOpen={() => undefined} onMarkRead={() => undefined} onMarkAllRead={() => undefined} onUpdatePreferences={async next => setPrefs(next)} />}
      </main>}
    </EmployeeProfileProvider>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Demo />);
