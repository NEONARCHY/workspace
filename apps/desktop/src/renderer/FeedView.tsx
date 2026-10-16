import { WorkspaceNotice } from "./WorkspaceNotice";
import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { useEffect, useRef, useState } from "react";

import type { AssistantActionDraft, FeedComment, FeedPost, GreetingLanguage, MessageReaction, WorkspacePerson } from "@yuksalish/contracts";
import { Button, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Textarea, useRestoreFocusTarget } from "@fluentui/react-components";
import {
  Comment24Regular,
  Pin24Filled,
  Pin24Regular,
  Delete24Regular,
  Send24Regular,
  Add24Regular,
  ArrowReply24Regular,
  ArrowForward24Regular,
  MoreHorizontal24Regular,
} from "@fluentui/react-icons";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { ProfileAvatar } from "./ProfileAvatar";
import { ReactionPicker } from "./ReactionPicker";
import { ReactionEmoji } from "./ReactionEmoji";
import { ReactionDetailsMenu, type ReactionDetailsTarget } from "./ReactionPeople";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { ForwardDialog, type ForwardContentAction } from "./ForwardDialog";
import type { ChatSummary } from "@yuksalish/contracts";
import { generateBirthdayGreeting } from "./workspace-api";

interface FeedViewProps {
  readonly chats?: readonly ChatSummary[];
  readonly onForwardContent?: ForwardContentAction;
  readonly focusPostId?: string;
  readonly canUseAssistant?: boolean;
  readonly assistantDraft?: AssistantActionDraft;
  readonly posts: readonly FeedPost[];
  readonly people: readonly WorkspacePerson[];
  readonly token: string;
  readonly currentUserId: string;
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

function commentThreadRootId(comment: FeedComment, comments: readonly FeedComment[]): string {
  const commentsById = new Map(comments.map((item) => [item.id, item]));
  const visited = new Set<string>();
  let rootId = comment.id;
  let parentId = comment.parentCommentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    rootId = parentId;
    parentId = commentsById.get(parentId)?.parentCommentId;
  }
  return rootId;
}

export function FeedReactions({ reactions, disabled, currentUserId, onToggle, people = [], token = "" }: { readonly reactions: readonly MessageReaction[]; readonly disabled: boolean; readonly currentUserId: string; readonly onToggle: (emoji: string, reacted: boolean) => void; readonly people?: readonly WorkspacePerson[]; readonly token?: string }) {
  const [details, setDetails] = useState<ReactionDetailsTarget>();
  return <div className="feed-reactions" aria-label="Реакции">
    {reactions.map((reaction) => <span className="feed-reaction-pair" key={reaction.emoji}><Button size="small" appearance={reaction.reactedByCurrentUser ? "primary" : "subtle"} disabled={disabled}
      aria-label={`${reaction.emoji} ${reaction.count}`} aria-haspopup="dialog" onContextMenu={(event) => {
        event.preventDefault(); event.stopPropagation();
        setDetails({ emoji: reaction.emoji, x: event.clientX, y: event.clientY, anchor: event.currentTarget });
      }} onKeyDown={(event) => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault(); event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        setDetails({ emoji: reaction.emoji, x: rect.left, y: rect.bottom, anchor: event.currentTarget });
      }} onClick={() => { setDetails(undefined); onToggle(reaction.emoji, !reaction.reactedByCurrentUser); }}><ReactionEmoji emoji={reaction.emoji} /> {reaction.count}</Button>
      <Button className="browser-feed-reaction-menu" size="small" appearance="subtle" icon={<MoreHorizontal24Regular />} aria-label={`Кто поставил реакцию ${reaction.emoji}`} aria-haspopup="dialog" onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setDetails({ emoji: reaction.emoji, x: rect.left, y: rect.bottom, anchor: event.currentTarget });
      }} /></span>)}
    <ReactionPicker userId={currentUserId} disabled={disabled} className="feed-reaction-trigger"
      active={reactions.filter((item) => item.reactedByCurrentUser).map((item) => item.emoji)}
      onSelect={(emoji) => onToggle(emoji, !reactions.some((item) => item.emoji === emoji && item.reactedByCurrentUser))} />
    {details && reactions.some((reaction) => reaction.emoji === details.emoji) ? <ReactionDetailsMenu target={details} reactions={reactions} people={people} token={token} onClose={() => setDetails(undefined)} /> : null}
  </div>;
}

export function FeedView({ posts, people, token, currentUserId, onCreate, onComment, onReact, onDeleteComment, onPin, onDelete, assistantDraft, canUseAssistant = false, chats = [], onForwardContent, focusPostId }: FeedViewProps) {
  const deleteFocusTarget = useRestoreFocusTarget();
  const [title, setTitle] = useState(assistantDraft?.kind === "feed" ? assistantDraft.fields.title ?? "" : "");
  const [body, setBody] = useState(assistantDraft?.kind === "feed" ? assistantDraft.fields.body ?? "" : "");
  const [actionError, setActionError] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [forwarding, setForwarding] = useState<FeedPost>();
  const focusedPost = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusPostId) return;
    focusedPost.current?.scrollIntoView?.({ block: "center", behavior: "instant" });
    focusedPost.current?.focus({ preventScroll: true });
  }, [focusPostId]);
  const [composerOpen, setComposerOpen] = useState(assistantDraft?.kind === "feed");
  const [replying, setReplying] = useState<Record<string, FeedComment | undefined>>({});
  const [pendingDelete, setPendingDelete] = useState<{ post: FeedPost; commentId?: string }>();
  const [greetingPostId, setGreetingPostId] = useState<string>();
  const [greetingLanguage, setGreetingLanguage] = useState<GreetingLanguage>("ru");
  const [greetingText, setGreetingText] = useState("");
  const [greetingError, setGreetingError] = useState("");
  const [greetingBusy, setGreetingBusy] = useState(false);
  const commentInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const person = (id: string | null) => id ? people.find((item) => item.id === id) : undefined;

  const createGreeting = async (postId: string) => {
    if (!canUseAssistant) return;
    setGreetingBusy(true);
    setGreetingError("");
    try {
      const result = await generateBirthdayGreeting(token, postId, greetingLanguage);
      setGreetingText(result.text);
    } catch (error) {
      setGreetingError(error instanceof Error ? error.message : "Не удалось создать поздравление.");
    } finally { setGreetingBusy(false); }
  };

  const publishGreeting = async (post: FeedPost) => {
    if (!greetingText.trim()) return;
    setGreetingBusy(true);
    try {
      if (await onComment(post, greetingText.trim())) {
        setGreetingPostId(undefined);
        setGreetingText("");
        setGreetingError("");
      }
    } catch (error) {
      setGreetingError(error instanceof Error ? error.message : "Не удалось опубликовать поздравление.");
    } finally { setGreetingBusy(false); }
  };

  const beginReply = (postId: string, commentItem: FeedComment) => {
    setReplying((current) => ({ ...current, [postId]: commentItem }));
    const input = commentInputs.current[postId];
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  };

  const create = async () => {
    if (busy || !title.trim() || !body.trim()) return;
    setBusy(true);
    setActionError("");
    try {
      if (await onCreate(title.trim(), body.trim())) {
        setTitle("");
        setBody("");
        setComposerOpen(false);
      } else setActionError("Объявление не опубликовано. Проверьте подключение и повторите.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Не удалось опубликовать объявление.");
    } finally {
      setBusy(false);
    }
  };

  const comment = async (post: FeedPost) => {
    const value = commentDrafts[post.id]?.trim();
    if (busy || !value) return;
    setBusy(true);
    setActionError("");
    try {
      if (await onComment(post, value, replying[post.id]?.id)) {
        setCommentDrafts((current) => ({ ...current, [post.id]: "" }));
        setReplying((current) => ({ ...current, [post.id]: undefined }));
      } else setActionError("Комментарий не отправлен. Черновик сохранён — попробуйте снова.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Не удалось отправить комментарий.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (post: FeedPost) => {
    if (!post.canDelete) return;
    setPendingDelete({ post });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      const deleted = pendingDelete.commentId
        ? await onDeleteComment(pendingDelete.post, pendingDelete.commentId)
        : await onDelete(pendingDelete.post);
      if (!deleted) throw new Error("Удаление не подтверждено. Попробуйте снова.");
      setPendingDelete(undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="workspace-view feed-view" aria-label="Лента">
        <WorkspaceSectionHeader motif="feed" className="section-heading">
          <div>
            <h1>Лента</h1>
            <p>Новости, решения и обсуждения компании</p>
          </div>
        </WorkspaceSectionHeader>
      <div className="feed-main">
        {actionError ? <WorkspaceNotice tone="error" className="feed-action-error" role="alert">{actionError}</WorkspaceNotice> : null}
        <div className="feed-list">
          {focusPostId && !posts.some(post => post.id === focusPostId) && <p className="feed-focus-notice" role="status">Объявление удалено или недоступно</p>}
          {posts.map((post) => {
            const author = person(post.authorUserId);
            return (
              <article className={`feed-card ${post.isPinned ? "pinned" : ""} ${post.systemKind === "birthday" ? "is-birthday" : ""} ${focusPostId === post.id ? "is-focused" : ""}`} key={post.id}
                ref={focusPostId === post.id ? focusedPost : undefined} tabIndex={focusPostId === post.id ? -1 : undefined} aria-label={post.title}>
                <header>
                  {post.systemKind === "birthday" ? <span className="feed-system-avatar" aria-hidden="true">Y</span> : null}
                  {author ? <EmployeeProfileLink userId={author.id} personName={author.name}><ProfileAvatar person={author} token={token} size={40} /></EmployeeProfileLink> : null}
                  <span>
                    {post.systemKind === "birthday" ? <strong>Команда Yuksalish</strong> : author ? <EmployeeProfileLink userId={author.id} personName={author.name}><strong>{author.name}</strong></EmployeeProfileLink> : <strong>Сотрудник</strong>}
                    <small>{dateLabel(post.createdAt)}</small>
                  </span>
                  {post.isPinned ? <span className="feed-pin">Закреплено</span> : null}
                  {post.canPin ? (
                    <Button
                      className="feed-post-icon-action"
                      appearance="subtle"
                      size="small"
                      icon={post.isPinned ? <Pin24Filled /> : <Pin24Regular />}
                      aria-label={post.isPinned ? "Открепить публикацию" : "Закрепить публикацию"}
                      onClick={() => { setActionError(""); void Promise.resolve(onPin(post, !post.isPinned)).catch(error => setActionError(error instanceof Error ? error.message : "Не удалось изменить закрепление.")); }}
                    />
                  ) : null}
                  {post.canDelete ? (
                    <Button
                      className="feed-post-icon-action feed-post-delete"
                      {...deleteFocusTarget}
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
                  {onForwardContent && <Button appearance="subtle" size="small" icon={<ArrowForward24Regular />} aria-label={`Переслать объявление: ${post.title}`}
                    onClick={() => setForwarding(post)}>Переслать</Button>}
                  <FeedReactions reactions={post.reactions ?? []} people={people} token={token} disabled={busy} currentUserId={currentUserId} onToggle={(emoji, reacted) => { setActionError(""); void Promise.resolve(onReact(post, emoji, reacted)).catch(error => setActionError(error instanceof Error ? error.message : "Не удалось изменить реакцию.")); }} />
                  <span><Comment24Regular /> {post.comments.length}</span>
                </div>
                {canUseAssistant && post.systemKind === "birthday" && post.birthdayUserId !== currentUserId && <div className="feed-birthday-greeting">
                  {greetingPostId !== post.id ? <Button appearance="primary" onClick={() => {
                    setGreetingPostId(post.id); setGreetingText(""); setGreetingError("");
                  }}>Сгенерировать поздравление для коллеги</Button> : <div className="feed-greeting-panel">
                    <label htmlFor={`greeting-language-${post.id}`}>Язык поздравления</label>
                    <WorkspaceSelect id={`greeting-language-${post.id}`} value={greetingLanguage}
                      disabled={greetingBusy} onChange={(event) => setGreetingLanguage(event.target.value as GreetingLanguage)}>
                      <option value="ru">Русский</option><option value="uz_latn">O‘zbekcha</option><option value="uz_cyrl">Ўзбекча</option>
                    </WorkspaceSelect>
                    <Button disabled={greetingBusy} onClick={() => void createGreeting(post.id)}>
                      {greetingBusy ? "Создаю…" : greetingText ? "Создать другой вариант" : "Создать текст"}
                    </Button>
                    {greetingText && <>
                      <textarea aria-label="Текст поздравления" value={greetingText}
                        onChange={(event) => setGreetingText(event.target.value)} maxLength={2000} />
                      <Button appearance="primary" disabled={greetingBusy || !greetingText.trim()}
                        onClick={() => void publishGreeting(post)}>Опубликовать поздравление</Button>
                    </>}
                    {greetingError && <WorkspaceNotice tone="error" role="alert">{greetingError}</WorkspaceNotice>}
                    <Button appearance="subtle" onClick={() => setGreetingPostId(undefined)}>Отмена</Button>
                  </div>}
                </div>}
                {post.comments.length > 0 ? (
                  <div className="feed-comments">
                    {post.comments.map((item, index) => {
                      const commentAuthor = person(item.authorUserId);
                      const depth = item.parentCommentId ? 1 : 0;
                      const threadRootId = commentThreadRootId(item, post.comments);
                      const nextComment = post.comments[index + 1];
                      const nextThreadRootId = nextComment ? commentThreadRootId(nextComment, post.comments) : undefined;
                      const hasReplies = !depth && nextThreadRootId === item.id;
                      const isLastReply = Boolean(depth) && nextThreadRootId !== threadRootId;
                      return (
                        <div className={`feed-comment ${depth ? "is-reply" : ""} ${hasReplies ? "has-replies" : ""} ${isLastReply ? "is-last-reply" : ""}`} key={item.id} data-parent-comment-id={item.parentCommentId ?? undefined}>
                          {commentAuthor ? <EmployeeProfileLink userId={commentAuthor.id} personName={commentAuthor.name}><ProfileAvatar person={commentAuthor} token={token} size={28} /></EmployeeProfileLink> : null}
                          <span>
                            {commentAuthor ? <EmployeeProfileLink userId={commentAuthor.id} personName={commentAuthor.name}><strong>{commentAuthor.name}</strong></EmployeeProfileLink> : <strong>Сотрудник</strong>}
                            <p>{item.body}</p>
                            <span className="feed-comment-meta">
                              <small>{dateLabel(item.createdAt)}</small>
                              <Button size="small" appearance="subtle" icon={<ArrowReply24Regular />} onClick={() => beginReply(post.id, item)}>Ответить</Button>
                              <FeedReactions reactions={item.reactions ?? []} people={people} token={token} disabled={busy} currentUserId={currentUserId} onToggle={(emoji, reacted) => { setActionError(""); void Promise.resolve(onReact(post, emoji, reacted, item.id)).catch(error => setActionError(error instanceof Error ? error.message : "Не удалось изменить реакцию.")); }} />
                              {item.canDelete ? <Button {...deleteFocusTarget} className="feed-comment-delete" size="small" appearance="subtle" icon={<Delete24Regular />} aria-label="Удалить комментарий" disabled={busy} onClick={() => setPendingDelete({ post, commentId: item.id })} /> : null}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <div className="feed-comment-composer">
                  {replying[post.id] ? <div className="feed-reply-context"><span>Ответ для <EmployeeProfileLink userId={replying[post.id]!.authorUserId} personName={person(replying[post.id]!.authorUserId)?.name ?? "сотрудника"}>{person(replying[post.id]!.authorUserId)?.name ?? "сотрудника"}</EmployeeProfileLink></span><Button size="small" appearance="subtle" aria-label="Отменить ответ" onClick={() => setReplying((current) => ({ ...current, [post.id]: undefined }))}>×</Button></div> : null}
                  <Input
                    input={{ ref: (node) => { commentInputs.current[post.id] = node; } }}
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
              {actionError ? <WorkspaceNotice tone="error" className="feed-action-error" role="alert">{actionError}</WorkspaceNotice> : null}
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
      <ConfirmActionDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete?.commentId ? "Удалить комментарий?" : "Удалить публикацию?"}
        message={pendingDelete?.commentId ? "Комментарий исчезнет из обсуждения. Это действие нельзя отменить." : `Публикация «${pendingDelete?.post.title ?? ""}» и её обсуждение будут удалены без возможности восстановления.`}
        busy={busy}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={confirmDelete}
      />
      {forwarding && onForwardContent && <ForwardDialog source={{ kind: "feed", id: forwarding.id }}
        preview={forwarding.title} chats={chats} onForward={onForwardContent} onClose={() => setForwarding(undefined)} />}
    </section>
  );
}
