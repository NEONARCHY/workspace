import { useState } from "react";

import type { FeedComment, FeedPost, MessageReaction, WorkspacePerson } from "@yuksalish/contracts";
import { Button, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Textarea } from "@fluentui/react-components";
import {
  Comment24Regular,
  Pin24Filled,
  Pin24Regular,
  Delete24Regular,
  Send24Regular,
  Add24Regular,
  ArrowReply24Regular,
  EmojiAdd24Regular,
} from "@fluentui/react-icons";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { ProfileAvatar } from "./ProfileAvatar";

const feedReactionOptions = ["👍", "👎", "❤️", "👏", "🎉", "👀", "✅", "🔥", "😂", "😮", "😢", "🙏", "🤝", "💯", "❗", "🥰", "😍", "🤔", "🤩", "🥳", "😎", "🤯", "😡", "💩", "👌", "💪", "🙌", "🚀"] as const;

interface FeedViewProps {
  readonly posts: readonly FeedPost[];
  readonly people: readonly WorkspacePerson[];
  readonly token: string;
  readonly onCreate: (title: string, body: string) => Promise<FeedPost | undefined>;
  readonly onComment: (post: FeedPost, body: string, parentCommentId?: string) => Promise<FeedPost | undefined>;
  readonly onReact: (post: FeedPost, emoji: string, reacted: boolean, commentId?: string) => Promise<FeedPost | undefined>;
  readonly onDeleteComment: (post: FeedPost, commentId: string) => Promise<FeedPost | undefined>;
  readonly onPin: (post: FeedPost, pinned: boolean) => Promise<FeedPost | undefined>;
  readonly onDelete: (post: FeedPost) => Promise<boolean>;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function FeedReactions({ reactions, disabled, onToggle }: { readonly reactions: readonly MessageReaction[]; readonly disabled: boolean; readonly onToggle: (emoji: string, reacted: boolean) => void }) {
  return <div className="feed-reactions" aria-label="Реакции">
    {reactions.map((reaction) => <Button key={reaction.emoji} size="small" appearance={reaction.reactedByCurrentUser ? "primary" : "subtle"} disabled={disabled} onClick={() => onToggle(reaction.emoji, !reaction.reactedByCurrentUser)}>{reaction.emoji} {reaction.count}</Button>)}
    <Menu><MenuTrigger disableButtonEnhancement><Button className="feed-reaction-trigger" size="small" appearance="subtle" icon={<EmojiAdd24Regular />} aria-label="Добавить реакцию" disabled={disabled} /></MenuTrigger><MenuPopover className="feed-reaction-popover"><MenuList className="feed-reaction-grid">{feedReactionOptions.map((emoji) => {
      const active = reactions.some((item) => item.emoji === emoji && item.reactedByCurrentUser);
      return <MenuItem aria-label={emoji} key={emoji} onClick={() => onToggle(emoji, !active)}>{emoji}</MenuItem>;
    })}</MenuList></MenuPopover></Menu>
  </div>;
}

export function FeedView({ posts, people, token, onCreate, onComment, onReact, onDeleteComment, onPin, onDelete }: FeedViewProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [replying, setReplying] = useState<Record<string, FeedComment | undefined>>({});
  const person = (id: string) => people.find((item) => item.id === id);

  const create = async () => {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    try {
      if (await onCreate(title.trim(), body.trim())) {
        setTitle("");
        setBody("");
        setComposerOpen(false);
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
      if (await onComment(post, value, replying[post.id]?.id)) {
        setCommentDrafts((current) => ({ ...current, [post.id]: "" }));
        setReplying((current) => ({ ...current, [post.id]: undefined }));
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (post: FeedPost) => {
    if (!post.canDelete || !window.confirm(`Удалить публикацию «${post.title}»?`)) return;
    setBusy(true);
    try {
      await onDelete(post);
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
        <div className="feed-list">
          {posts.map((post) => {
            const author = person(post.authorUserId);
            return (
              <article className={`feed-card ${post.isPinned ? "pinned" : ""}`} key={post.id}>
                <header>
                  {author ? <ProfileAvatar person={author} token={token} size={40} /> : null}
                  <span>
                    <strong>{author?.name ?? "Сотрудник"}</strong>
                    <small>{dateLabel(post.createdAt)}</small>
                  </span>
                  {post.isPinned ? <span className="feed-pin">Закреплено</span> : null}
                  {post.canPin ? (
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={post.isPinned ? <Pin24Filled /> : <Pin24Regular />}
                      aria-label={post.isPinned ? "Открепить публикацию" : "Закрепить публикацию"}
                      onClick={() => void onPin(post, !post.isPinned)}
                    />
                  ) : null}
                  {post.canDelete ? (
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={<Delete24Regular />}
                      aria-label="Удалить публикацию"
                      disabled={busy}
                      onClick={() => void remove(post)}
                    />
                  ) : null}
                </header>
                <h2>{post.title}</h2>
                <p className="feed-copy">{post.body}</p>
                <div className="feed-actions">
                  <FeedReactions reactions={post.reactions ?? []} disabled={busy} onToggle={(emoji, reacted) => void onReact(post, emoji, reacted)} />
                  <span><Comment24Regular /> {post.comments.length}</span>
                </div>
                {post.comments.length > 0 ? (
                  <div className="feed-comments">
                    {post.comments.map((item) => {
                      const commentAuthor = person(item.authorUserId);
                      const depth = item.parentCommentId ? 1 : 0;
                      return (
                        <div className={`feed-comment ${depth ? "is-reply" : ""}`} key={item.id} data-parent-comment-id={item.parentCommentId ?? undefined}>
                          {commentAuthor ? <ProfileAvatar person={commentAuthor} token={token} size={28} /> : null}
                          <span>
                            <strong>{commentAuthor?.name ?? "Сотрудник"}</strong>
                            <p>{item.body}</p>
                            <span className="feed-comment-meta">
                              <small>{dateLabel(item.createdAt)}</small>
                              <Button size="small" appearance="subtle" icon={<ArrowReply24Regular />} onClick={() => setReplying((current) => ({ ...current, [post.id]: item }))}>Ответить</Button>
                              <FeedReactions reactions={item.reactions ?? []} disabled={busy} onToggle={(emoji, reacted) => void onReact(post, emoji, reacted, item.id)} />
                              {item.canDelete ? <Button size="small" appearance="subtle" icon={<Delete24Regular />} aria-label="Удалить комментарий" disabled={busy} onClick={() => {
                                if (window.confirm("Удалить этот комментарий?")) void onDeleteComment(post, item.id);
                              }} /> : null}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <div className="feed-comment-composer">
                  {replying[post.id] ? <div className="feed-reply-context"><span>Ответ для {person(replying[post.id]!.authorUserId)?.name ?? "сотрудника"}</span><Button size="small" appearance="subtle" aria-label="Отменить ответ" onClick={() => setReplying((current) => ({ ...current, [post.id]: undefined }))}>×</Button></div> : null}
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
      <aside className="feed-side" aria-label="Действия ленты">
        <Button className="feed-create-button" appearance="primary" icon={<Add24Regular />} onClick={() => setComposerOpen(true)}>
          Новое объявление
        </Button>
        <section className="feed-context-card">
          <strong>Корпоративная лента</strong>
          <p>Видна всем активным сотрудникам. Закреплять важные объявления могут руководители.</p>
          <span>{posts.length} публикаций</span>
        </section>
      </aside>
      <Dialog open={composerOpen} onOpenChange={(_, data) => !busy && setComposerOpen(data.open)}>
        <DialogSurface className="feed-composer-dialog" aria-label="Новое объявление">
          <DialogBody>
            <DialogTitle>Новое объявление</DialogTitle>
            <DialogContent className="feed-composer">
              <Input autoFocus aria-label="Заголовок публикации" placeholder="Заголовок" value={title} onChange={(_event, data) => setTitle(data.value)} />
              <Textarea aria-label="Текст публикации" placeholder="Поделитесь новостью с командой" resize="vertical" value={body} onChange={(_event, data) => setBody(data.value)} />
            </DialogContent>
            <DialogActions>
              <Button disabled={busy} onClick={() => setComposerOpen(false)}>Отмена</Button>
              <Button appearance="primary" icon={<Send24Regular />} disabled={busy || !title.trim() || !body.trim()} onClick={() => void create()}>Опубликовать</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
  );
}
