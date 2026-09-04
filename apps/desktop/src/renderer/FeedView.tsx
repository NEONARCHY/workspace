import { useState } from "react";

import type { FeedPost, WorkspacePerson } from "@yuksalish/contracts";
import { Avatar, Button, Input, Textarea } from "@fluentui/react-components";
import {
  Comment24Regular,
  Pin24Filled,
  Pin24Regular,
  Send24Regular,
  ThumbLike24Filled,
  ThumbLike24Regular,
} from "@fluentui/react-icons";

interface FeedViewProps {
  readonly posts: readonly FeedPost[];
  readonly people: readonly WorkspacePerson[];
  readonly onCreate: (title: string, body: string) => Promise<FeedPost | undefined>;
  readonly onComment: (post: FeedPost, body: string) => Promise<FeedPost | undefined>;
  readonly onLike: (post: FeedPost, liked: boolean) => Promise<FeedPost | undefined>;
  readonly onPin: (post: FeedPost, pinned: boolean) => Promise<FeedPost | undefined>;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function FeedView({ posts, people, onCreate, onComment, onLike, onPin }: FeedViewProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const person = (id: string) => people.find((item) => item.id === id);

  const create = async () => {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    try {
      if (await onCreate(title.trim(), body.trim())) {
        setTitle("");
        setBody("");
      }
    } finally {
      setBusy(false);
    }
  };

  const comment = async (post: FeedPost) => {
    const value = commentDrafts[post.id]?.trim();
    if (!value) return;
    setBusy(true);
    try {
      if (await onComment(post, value)) {
        setCommentDrafts((current) => ({ ...current, [post.id]: "" }));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="workspace-view feed-view" aria-label="Лента">
      <div className="feed-main">
        <header className="section-heading">
          <div>
            <h1>Лента</h1>
            <p>Новости, решения и обсуждения компании</p>
          </div>
        </header>
        <article className="feed-composer">
          <Input
            aria-label="Заголовок публикации"
            placeholder="Заголовок"
            value={title}
            onChange={(_event, data) => setTitle(data.value)}
          />
          <Textarea
            aria-label="Текст публикации"
            placeholder="Поделитесь новостью с командой"
            resize="vertical"
            value={body}
            onChange={(_event, data) => setBody(data.value)}
          />
          <Button
            appearance="primary"
            icon={<Send24Regular />}
            disabled={busy || !title.trim() || !body.trim()}
            onClick={() => void create()}
          >
            Опубликовать
          </Button>
        </article>

        <div className="feed-list">
          {posts.map((post) => {
            const author = person(post.authorUserId);
            return (
              <article className={`feed-card ${post.isPinned ? "pinned" : ""}`} key={post.id}>
                <header>
                  <Avatar name={author?.name ?? "Сотрудник"} size={40} color="colorful" />
                  <span>
                    <strong>{author?.name ?? "Сотрудник"}</strong>
                    <small>{dateLabel(post.createdAt)}</small>
                  </span>
                  {post.isPinned ? <span className="feed-pin"><Pin24Filled /> Закреплено</span> : null}
                  {post.canPin ? (
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={post.isPinned ? <Pin24Filled /> : <Pin24Regular />}
                      aria-label={post.isPinned ? "Открепить публикацию" : "Закрепить публикацию"}
                      onClick={() => void onPin(post, !post.isPinned)}
                    />
                  ) : null}
                </header>
                <h2>{post.title}</h2>
                <p className="feed-copy">{post.body}</p>
                <div className="feed-actions">
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={post.likedByCurrentUser ? <ThumbLike24Filled /> : <ThumbLike24Regular />}
                    onClick={() => void onLike(post, !post.likedByCurrentUser)}
                  >
                    Нравится{post.likeCount > 0 ? ` · ${post.likeCount}` : ""}
                  </Button>
                  <span><Comment24Regular /> {post.comments.length}</span>
                </div>
                {post.comments.length > 0 ? (
                  <div className="feed-comments">
                    {post.comments.map((item) => {
                      const commentAuthor = person(item.authorUserId);
                      return (
                        <div className="feed-comment" key={item.id}>
                          <Avatar name={commentAuthor?.name ?? "Сотрудник"} size={28} color="colorful" />
                          <span>
                            <strong>{commentAuthor?.name ?? "Сотрудник"}</strong>
                            <p>{item.body}</p>
                            <small>{dateLabel(item.createdAt)}</small>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <div className="feed-comment-composer">
                  <Input
                    aria-label={`Комментарий к публикации ${post.title}`}
                    placeholder="Написать комментарий"
                    value={commentDrafts[post.id] ?? ""}
                    onChange={(_event, data) =>
                      setCommentDrafts((current) => ({ ...current, [post.id]: data.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void comment(post);
                    }}
                  />
                  <Button
                    appearance="subtle"
                    icon={<Send24Regular />}
                    aria-label="Отправить комментарий"
                    disabled={busy || !commentDrafts[post.id]?.trim()}
                    onClick={() => void comment(post)}
                  />
                </div>
              </article>
            );
          })}
          {posts.length === 0 ? <div className="empty-state">Публикаций пока нет</div> : null}
        </div>
      </div>
      <aside className="feed-side">
        <strong>Корпоративная лента</strong>
        <p>Видна всем активным сотрудникам. Закреплять важные объявления могут руководители.</p>
        <span>{posts.length} публикаций</span>
      </aside>
    </section>
  );
}
