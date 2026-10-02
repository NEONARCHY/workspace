// Development-only visual fixture: no API calls or persistent user data.
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import type { FeedPost } from "@yuksalish/contracts";
import { FeedView } from "../src/renderer/FeedView";
import { people } from "../src/renderer/test-fixtures/demo-data";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/design-system.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workspace-2-interactions.css";

const post: FeedPost = {
  id: "feed-qa", authorUserId: "aziza", title: "Обновление по проекту", isPinned: false,
  body: "Подготовили обновлённый план проекта. Спасибо всем, кто помог проверить детали и сроки.",
  likedByCurrentUser: false, likeCount: 0, reactions: [], canEdit: false, canPin: false,
  createdAt: "2026-10-03T09:00:00+05:00", updatedAt: "2026-10-03T09:00:00+05:00",
  comments: [
    { id: "first", authorUserId: "baxtiyor", body: "Отличная работа! Новый план стал намного понятнее.", createdAt: "2026-10-03T09:20:00+05:00" },
    { id: "reply-one", parentCommentId: "first", authorUserId: "dilshod", body: "Согласен. Отдельно понравилось, как обозначены ближайшие шаги.", createdAt: "2026-10-03T09:28:00+05:00" },
    { id: "reply-two", parentCommentId: "reply-one", authorUserId: "aziza", body: "Спасибо! Продолжим сверять сроки здесь, чтобы всем было удобно следить за обсуждением.", createdAt: "2026-10-03T09:34:00+05:00" },
    { id: "second", authorUserId: "dilshod", body: "Материалы для встречи тоже готовы.", createdAt: "2026-10-03T09:40:00+05:00" },
  ],
};

createRoot(document.getElementById("root")!).render(
  <FluentProvider theme={workspaceTheme} className="app-provider" style={{ height: "100dvh" }}>
    <main className="app-content" style={{ height: "100%" }}>
      <FeedView posts={[post]} people={people} token="" currentUserId="aziza"
        onCreate={async () => post} onComment={async () => post} onReact={async () => post}
        onDeleteComment={async () => post} onPin={async () => post} onDelete={async () => true} />
    </main>
  </FluentProvider>,
);

if (new URLSearchParams(window.location.search).has("expanded")) {
  window.setTimeout(() => document.querySelector<HTMLButtonElement>(".feed-thread-toggle")?.click(), 400);
}
