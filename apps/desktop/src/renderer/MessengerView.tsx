import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { scrollToLatest } from "./message-scroll";
import type {
  ChatMessage,
  ChatSummary,
  MessageReactionEmoji,
  PersonalPreferences,
  PersonalChatAction,
  MessageOptions,
  WorkspaceAttachment,
  WorkspacePerson,
  WorkspaceTask,
  WorkspaceTaskCreateInput,
} from "@yuksalish/contracts";
import {
  Avatar,
  Button,
  Checkbox,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Textarea,
  Tooltip,
  useRestoreFocusTarget,
} from "@fluentui/react-components";
import {
  Add24Regular,
  Attach24Regular,
  EmojiAdd24Regular,
  Mic24Regular,
  Pin24Regular,
  PinOff24Regular,
  Search24Regular,
  Send24Filled,
  TaskListSquareLtr24Regular,
} from "@fluentui/react-icons";
import { AttachmentChips } from "./AttachmentPanel";
import { ChatManagement, type ChatActions } from "./ChatManagement";
import { OrganizedChatList } from "./OrganizedChatList";
import { defaultPersonalPreferences } from "./personal-organization";
import { TaskComposer } from "./TaskComposer";
import { VoiceMessagePlayer, VoiceRecorder } from "./VoiceMessage";
import { workspacePlatform } from "./platform-adapter";

const reactionOptions: readonly { emoji: MessageReactionEmoji; label: string }[] = [
  { emoji: "👍", label: "Нравится" },
  { emoji: "❤️", label: "Сердце" },
  { emoji: "👏", label: "Аплодисменты" },
  { emoji: "🎉", label: "Праздник" },
  { emoji: "👀", label: "Смотрю" },
  { emoji: "✅", label: "Готово" },
];

interface MessengerViewProps {
  readonly personalPreferences?: PersonalPreferences;
  readonly onPersonalChat?: (id: string, action: PersonalChatAction) => Promise<void>;
  readonly onPinnedOrder?: (order: readonly string[]) => Promise<void>;
  readonly focusChatId?: string;
  readonly currentUserId: string;
  readonly chats: readonly ChatSummary[];
  readonly messages: readonly ChatMessage[];
  readonly tasks: readonly WorkspaceTask[];
  readonly attachments: readonly WorkspaceAttachment[];
  readonly people: readonly WorkspacePerson[];
  readonly chatActions: ChatActions;
  readonly onSendMessage: (
    chatId: string,
    body: string,
    files: readonly File[],
    options: MessageOptions,
  ) => ChatMessage | undefined | Promise<ChatMessage | undefined>;
  readonly onSendVoiceMessage: (
    chatId: string,
    file: File,
    durationMs: number,
    options: MessageOptions,
  ) => Promise<ChatMessage | undefined>;
  readonly onReactMessage: (message: ChatMessage, emoji: MessageReactionEmoji) => Promise<void>;
  readonly onPinMessage: (message: ChatMessage, pinned: boolean) => Promise<void>;
  readonly onEditMessage: (message: ChatMessage, body: string) => Promise<void>;
  readonly onDeleteMessage: (message: ChatMessage) => Promise<void>;
  readonly onCreateTaskFromMessage: (
    message: ChatMessage,
    payload: WorkspaceTaskCreateInput,
  ) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onDownloadAttachment: (
    attachment: WorkspaceAttachment,
  ) => void | Promise<void>;
  readonly onLoadAttachment: (attachment: WorkspaceAttachment) => Promise<Blob>;
  readonly onMarkRead: (chatId: string) => void | Promise<void>;
}

function Conversation({
  chat,
  messages,
  attachments,
  people,
  tasks,
  currentUserId,
  onSendMessage,
  onSendVoiceMessage,
  onReactMessage,
  onPinMessage,
  onEditMessage,
  onDeleteMessage,
  onCreateTaskFromMessage,
  onDownloadAttachment,
  onLoadAttachment,
  onManage,
  onBack,
  personalPreferences,
  onPersonalChat,
}: Omit<MessengerViewProps, "chats" | "chatActions" | "onMarkRead"> & {
  readonly chat: ChatSummary;
  readonly onManage: () => void;
  readonly onBack: () => void;
}) {
  const [draft, setDraft] = useState("");
  const draftKey = `chat:${currentUserId}:${chat.id}`;
  const draftEdited = useRef(false);
  const draftReady = useRef(false);
  const [reply, setReply] = useState<ChatMessage>();
  const [mentions, setMentions] = useState<readonly string[]>([]);
  const [mentionPicker, setMentionPicker] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<readonly File[]>([]);
  const [taskSource, setTaskSource] = useState<ChatMessage>();
  const [editing, setEditing] = useState<ChatMessage>();
  const [editBody, setEditBody] = useState("");
  const [deleting, setDeleting] = useState<ChatMessage>();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const wasEditing = useRef(false);
  const focusAfterSend = useRef(false);
  const restoreFocusTarget = useRestoreFocusTarget();
  const scrollRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const scrollInitialized = useRef(false);
  useEffect(() => {
    const bridge = workspacePlatform;
    let active = true;
    void bridge.loadDraft(draftKey).then((saved) => {
      if (active && !draftEdited.current && saved !== null) {
        setDraft(saved);
        void bridge.clearDraft(draftKey).catch(() => undefined);
      }
    }).catch(() => undefined).finally(() => { draftReady.current = true; });
    return () => { active = false; };
  }, [draftKey]);
  useEffect(() => {
    const bridge = workspacePlatform;
    if (!draftReady.current || !draftEdited.current) return;
    const save = () => {
      void (draft ? bridge.saveDraft(draftKey, draft) : bridge.clearDraft(draftKey))
        .catch(() => undefined);
    };
    const timer = window.setTimeout(() => {
      save();
    }, 350);
    window.addEventListener("yuksalish:prepare-web-update", save);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("yuksalish:prepare-web-update", save);
    };
  }, [draft, draftKey]);
  const canSend = chat.permissions.sendMessages;
  const personName = (id: string) =>
    people.find((person) => person.id === id)?.name ?? "Сотрудник";
  const activeMessages = messages.filter(
    (message) => message.chatId === chat.id,
  );
  const visibleMessages = activeMessages.filter(
    (message) =>
      message.id === editing?.id ||
      !query ||
      (!message.deletedAt &&
        message.body.toLowerCase().includes(query.toLowerCase())),
  );
  const activeMemberIds = new Set(chat.members.map((member) => member.userId));
  const latestMessage = activeMessages.at(-1);
  const pinnedMessages = activeMessages.filter((message) => message.isPinned && !message.deletedAt);
  const latestPinned = pinnedMessages.at(-1);
  const revealMessage = (messageId: string) => {
    setQuery("");
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };
  useLayoutEffect(() => {
    const pane = scrollRef.current;
    if (pane && (followLatest.current || latestMessage?.authorId === currentUserId)) {
      scrollToLatest(pane, scrollInitialized.current);
    }
    scrollInitialized.current = true;
  }, [latestMessage?.id, latestMessage?.authorId, currentUserId]);
  useEffect(() => {
    if (editing) {
      const input = editInputRef.current;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
      input?.scrollIntoView?.({ block: "nearest" });
    } else if (wasEditing.current) {
      composerInputRef.current?.focus();
    }
    wasEditing.current = Boolean(editing);
  }, [editing]);
  useEffect(() => {
    if (!busy && focusAfterSend.current) {
      focusAfterSend.current = false;
      composerInputRef.current?.focus();
    }
  }, [busy, draft]);
  const startEditing = (message: ChatMessage) => {
    if (busy || !canSend || message.authorId !== currentUserId || !message.canEdit || message.deletedAt) return;
    setEditing(message);
    setEditBody(message.body);
    setError("");
  };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось выполнить действие",
      );
    } finally {
      setBusy(false);
    }
  };
  const send = () => {
    if (!canSend || busy || (!draft.trim() && pendingFiles.length === 0)) return;
    focusAfterSend.current = true;
    void run(async () => {
      const message = await onSendMessage(chat.id, draft.trim() || "Файл", pendingFiles, {
        replyToMessageId: reply?.id,
        mentionUserIds: mentions.filter((id) => activeMemberIds.has(id)),
      });
      if (!message)
        throw new Error(
          "Сообщение не отправлено. Текст сохранён — попробуйте снова.",
        );
      setDraft("");
      draftEdited.current = true;
      void workspacePlatform.clearDraft(draftKey).catch(() => undefined);
      setReply(undefined);
      setMentions([]);
      setMentionPicker(false);
      setPendingFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  };
  return (
    <article className="conversation-pane">
      <header className="conversation-header">
        <Button className="compact-back" appearance="subtle" onClick={onBack}>К списку чатов</Button>
        <div className="conversation-identity">
          <Avatar name={chat.title} size={40} color="colorful" />
          <div>
          <h2>{chat.title}</h2>
          <p>
            {chat.kind === "direct"
              ? "Личный диалог"
              : `${chat.members.length} участников · ${chat.kind === "group" ? "Закрытая группа" : "Рабочий чат"}`}
          </p>
          </div>
        </div>
        <Button {...restoreFocusTarget} onClick={onManage}>
          {chat.kind === "group" ? "Участники и права" : "Участники"}
        </Button>
      </header>
      {personalPreferences?.archivedChatIds.includes(chat.id) && <div className="chat-archive-banner">
        <span>Этот чат в вашем архиве</span>
        <Button size="small" appearance="subtle" disabled={busy || !onPersonalChat} onClick={() => void run(() => onPersonalChat!(chat.id, "unarchive"))}>Вернуть из архива</Button>
      </div>}
      <div className="conversation-search">
        <Input
          aria-label="Поиск в переписке"
          placeholder="Найти сообщение в этом чате"
          contentBefore={<Search24Regular />}
          value={query}
          onChange={(_, data) => setQuery(data.value)}
        />
        {latestPinned ? (
          <Button
            className="pinned-message-trigger"
            appearance="subtle"
            icon={<Pin24Regular />}
            aria-expanded={pinnedOpen}
            onClick={() => setPinnedOpen((value) => !value)}
          >
            Закреплено: {pinnedMessages.length}
          </Button>
        ) : null}
      </div>
      {pinnedOpen && latestPinned ? (
        <div className="pinned-message-panel" role="region" aria-label="Закреплённые сообщения">
          <header>
            <strong>Закреплённые сообщения</strong>
            <Button size="small" appearance="subtle" onClick={() => setPinnedOpen(false)}>Скрыть</Button>
          </header>
          <div>
            {pinnedMessages.map((message) => (
              <button key={message.id} type="button" onClick={() => revealMessage(message.id)}>
                <span>{personName(message.authorId)}</span>
                <strong>{message.body.slice(0, 140)}</strong>
                <time>{message.time}</time>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="message-scroll" aria-label="Переписка" aria-live="polite" ref={scrollRef}
        onScroll={(event) => { const pane = event.currentTarget; followLatest.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80; }}>
        {!visibleMessages.length && (
          <div className="empty-compact">
            {query
              ? "Сообщения не найдены"
              : "Начните разговор — отправьте первое сообщение"}
          </div>
        )}
        {visibleMessages.map((message, index) => {
          const parent = activeMessages.find(
            (item) => item.id === message.replyToMessageId,
          );
          const date = message.createdAt
            ? new Date(message.createdAt).toLocaleDateString("ru-RU")
            : "История переписки";
          const previous = visibleMessages[index - 1]?.createdAt;
          const previousDate = previous
            ? new Date(previous).toLocaleDateString("ru-RU")
            : "История переписки";
          const own = message.authorId === currentUserId;
          const messageAttachments = attachments.filter(
            (attachment) => attachment.ownerType === "message" && attachment.ownerId === message.id,
          );
          const voiceAttachments = messageAttachments.filter((attachment) => attachment.mediaKind === "voice");
          const mayModify = own && message.canEdit && canSend && !message.deletedAt;
          const mayEdit = mayModify && voiceAttachments.length === 0;
          return (
            <div key={message.id}>
              {(index === 0 || date !== previousDate) && (
                <div className="date-separator">{date}</div>
              )}
              <div
                data-message-id={message.id}
                className={`message ${own ? "own" : ""} ${message.isPinned ? "message-pinned" : ""} ${message.mentionUserIds?.includes(currentUserId) ? "message-mentioned" : ""}`}
              >
                {!own && (
                  <Avatar
                    name={personName(message.authorId)}
                    size={32}
                    color="colorful"
                  />
                )}
                <div className="message-content">
                  <div className="message-body">
                    {!own && <strong>{personName(message.authorId)}</strong>}
                    {message.replyToMessageId && (
                      <blockquote className="message-quote">
                        <strong>
                          {parent
                            ? personName(parent.authorId)
                            : "Ответ на сообщение"}
                        </strong>
                        <span>
                          {parent?.deletedAt
                            ? "Сообщение удалено"
                            : (parent?.body ?? "Сообщение недоступно")}
                        </span>
                      </blockquote>
                    )}
                    {editing?.id === message.id ? (
                      <div className="message-edit-form">
                        <Textarea
                          textarea={{ ref: editInputRef }}
                          aria-label="Изменить текст сообщения"
                          value={editBody}
                          maxLength={20000}
                          disabled={busy}
                          onChange={(_, data) => setEditBody(data.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape" && !busy && !event.nativeEvent.isComposing) {
                              event.preventDefault();
                              setEditing(undefined);
                            }
                          }}
                        />
                        <div className="chat-dialog-actions">
                          <Button
                            size="small"
                            appearance="primary"
                            disabled={busy || !editBody.trim()}
                            onClick={() =>
                              void run(async () => {
                                await onEditMessage(editing, editBody.trim());
                                setEditing(undefined);
                              })
                            }
                          >
                            Сохранить сообщение
                          </Button>
                          <Button
                            size="small"
                            disabled={busy}
                            onClick={() => setEditing(undefined)}
                          >
                            Отмена
                          </Button>
                        </div>
                      </div>
                    ) : message.deletedAt || voiceAttachments.length === 0 ? (
                      <p
                        className={
                          message.deletedAt ? "message-deleted" : undefined
                        }
                      >
                        {message.deletedAt ? "Сообщение удалено" : message.body}
                      </p>
                    ) : null}
                    {!message.deletedAt && (
                      <>
                        {!!message.mentionUserIds?.length && (
                          <div className="message-mentions">
                            {message.mentionUserIds.map((id) => (
                              <span key={id}>@{personName(id)}</span>
                            ))}
                          </div>
                        )}
                        {voiceAttachments.map((attachment) => (
                          <VoiceMessagePlayer key={attachment.id} attachment={attachment} onLoad={onLoadAttachment} />
                        ))}
                        <AttachmentChips
                          attachments={messageAttachments.filter((attachment) => attachment.mediaKind !== "voice")}
                          onDownload={onDownloadAttachment}
                        />
                      </>
                    )}
                    <time>
                      {message.editedAt && !message.deletedAt
                        ? "изменено · "
                        : ""}
                      {message.time}
                    </time>
                  </div>
                  {!!message.reactions?.length && (
                    <div className="message-reactions" aria-label="Реакции на сообщение">
                      {message.reactions.map((reaction) => (
                        <Button
                          key={reaction.emoji}
                          size="small"
                          appearance={reaction.reactedByCurrentUser ? "primary" : "subtle"}
                          disabled={!canSend || busy}
                          aria-label={`${reactionOptions.find((item) => item.emoji === reaction.emoji)?.label ?? "Реакция"}: ${reaction.count}`}
                          onClick={() => void run(() => onReactMessage(message, reaction.emoji))}
                        >
                          {reaction.emoji} {reaction.count}
                        </Button>
                      ))}
                    </div>
                  )}
                  {!message.deletedAt && (
                    <div className="message-actions" role="group" aria-label="Действия с сообщением">
                      <Menu>
                        <MenuTrigger disableButtonEnhancement>
                          <Button
                            appearance="subtle"
                            size="small"
                            icon={<EmojiAdd24Regular />}
                            disabled={!canSend || busy}
                            aria-label="Добавить реакцию"
                          />
                        </MenuTrigger>
                        <MenuPopover>
                          <MenuList>
                            {reactionOptions.map((reaction) => (
                              <MenuItem
                                key={reaction.emoji}
                                onClick={() => void run(() => onReactMessage(message, reaction.emoji))}
                              >
                                {reaction.emoji} {reaction.label}
                              </MenuItem>
                            ))}
                          </MenuList>
                        </MenuPopover>
                      </Menu>
                      <Button
                        appearance="subtle"
                        size="small"
                        disabled={!canSend || busy}
                        aria-label={`Ответить: ${message.body.slice(0, 40)}`}
                        onClick={() => setReply(message)}
                      >
                        Ответить
                      </Button>
                      {message.canPin ? (
                        <Button
                          appearance="subtle"
                          size="small"
                          icon={message.isPinned ? <PinOff24Regular /> : <Pin24Regular />}
                          disabled={busy}
                          aria-label={message.isPinned ? "Открепить сообщение" : "Закрепить сообщение"}
                          onClick={() => void run(() => onPinMessage(message, !message.isPinned))}
                        >
                          {message.isPinned ? "Открепить" : "Закрепить"}
                        </Button>
                      ) : null}
                      <Button
                        className="message-task-action"
                        appearance="subtle"
                        size="small"
                        icon={<TaskListSquareLtr24Regular />}
                        aria-label={`Создать задачу из сообщения: ${message.body.slice(0, 40)}`}
                        onClick={() => setTaskSource(message)}
                      >
                        В задачу
                      </Button>
                      {mayModify && (
                        <>
                          {mayEdit ? (
                            <Button
                              appearance="subtle"
                              size="small"
                              disabled={busy}
                              aria-label={`Изменить сообщение: ${message.body.slice(0, 40)}`}
                              onClick={() => startEditing(message)}
                            >
                              Изменить
                            </Button>
                          ) : null}
                          <Button
                            appearance="subtle"
                            size="small"
                            disabled={busy}
                            aria-label={`Удалить сообщение: ${message.body.slice(0, 40)}`}
                            onClick={() => setDeleting(message)}
                          >
                            Удалить
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {error && (
        <div className="messenger-error" role="alert">
          {error}
        </div>
      )}
      {deleting && (
        <div className="chat-confirmation" role="alert">
          <p>
            Удалить сообщение из переписки? История изменений сохранится для
            аудита.
          </p>
          <Button
            disabled={busy}
            appearance="primary"
            onClick={() =>
              void run(async () => {
                await onDeleteMessage(deleting);
                if (reply?.id === deleting.id) setReply(undefined);
                setDeleting(undefined);
              })
            }
          >
            Удалить для всех
          </Button>
          <Button disabled={busy} onClick={() => setDeleting(undefined)}>
            Отмена
          </Button>
        </div>
      )}
      {taskSource ? <TaskComposer
        open
        people={people}
        tasks={tasks}
        currentUserId={currentUserId}
        initialTitle={taskSource.body.slice(0, 160)}
        initialDescription={taskSource.body}
        sourceLabel="Карточка сохранит ссылку на исходное сообщение."
        onClose={() => setTaskSource(undefined)}
        onSubmit={async (payload) => {
          const task = await onCreateTaskFromMessage(taskSource, payload);
          if (task !== undefined) setTaskSource(undefined);
          return task;
        }}
      /> : null}
      {!canSend ? (
        <div className="chat-read-only">
          Вам доступно только чтение. Право отправлять сообщения меняет владелец
          группы.
        </div>
      ) : (
        <>
          {reply && (
            <div className="composer-context">
              <div>
                <small>Ответ · {personName(reply.authorId)}</small>
                <p>
                  {activeMessages.find((item) => item.id === reply.id)
                    ?.deletedAt
                    ? "Сообщение удалено — выберите другой ответ"
                    : reply.body.slice(0, 200)}
                </p>
              </div>
              <Button
                appearance="subtle"
                aria-label="Отменить ответ"
                disabled={busy}
                onClick={() => setReply(undefined)}
              >
                ×
              </Button>
            </div>
          )}
          {mentionPicker && (
            <div
              className="mention-picker"
              role="region"
              aria-label="Упомянуть участников"
            >
              <small>Кому отправить уведомление об упоминании</small>
              {chat.members
                .filter((member) => member.userId !== currentUserId)
                .map((member) => (
                  <Checkbox
                    key={member.userId}
                    label={`@${personName(member.userId)}`}
                    checked={mentions.includes(member.userId)}
                    disabled={busy}
                    onChange={(_, data) =>
                      setMentions(
                        data.checked
                          ? [...mentions, member.userId]
                          : mentions.filter((id) => id !== member.userId),
                      )
                    }
                  />
                ))}
            </div>
          )}
          {voiceOpen ? (
            <VoiceRecorder
              disabled={busy}
              onClose={() => setVoiceOpen(false)}
              onSend={async (file, durationMs) => {
                const message = await onSendVoiceMessage(chat.id, file, durationMs, {
                  replyToMessageId: reply?.id,
                  mentionUserIds: mentions.filter((id) => activeMemberIds.has(id)),
                });
                if (!message) return false;
                setReply(undefined);
                setMentions([]);
                setMentionPicker(false);
                return true;
              }}
            />
          ) : <div className="composer">
            <input
              ref={fileInputRef}
              hidden
              type="file"
              multiple
              aria-label="Файлы сообщения"
              disabled={busy || !chat.permissions.uploadFiles}
              onChange={(event) =>
                setPendingFiles(Array.from(event.target.files ?? []))
              }
            />
            <Tooltip
              content={
                chat.permissions.uploadFiles
                  ? "Прикрепить файл"
                  : "Вложения запрещены владельцем группы"
              }
              relationship="label"
            >
              <Button
                appearance="subtle"
                icon={<Attach24Regular />}
                aria-label="Прикрепить файл"
                disabled={busy || !chat.permissions.uploadFiles}
                onClick={() => fileInputRef.current?.click()}
              />
            </Tooltip>
            <Button
              appearance="subtle"
              aria-label="Упомянуть участника"
              aria-expanded={mentionPicker}
              disabled={busy}
              onClick={() => setMentionPicker(!mentionPicker)}
            >
              @{mentions.length || ""}
            </Button>
            <Tooltip content="Записать голосовое сообщение · Opus" relationship="label">
              <Button
                appearance="subtle"
                icon={<Mic24Regular />}
                aria-label="Записать голосовое сообщение"
                disabled={busy || Boolean(draft.trim()) || pendingFiles.length > 0}
                onClick={() => setVoiceOpen(true)}
              />
            </Tooltip>
            <div className="composer-input">
              {!!pendingFiles.length && (
                <div className="pending-files">
                  {pendingFiles.map((file, index) => (
                    <Button
                      key={`${file.name}-${index}`}
                      size="small"
                      appearance="subtle"
                      disabled={busy}
                      aria-label={`Убрать файл ${file.name}`}
                      onClick={() =>
                        setPendingFiles(
                          pendingFiles.filter(
                            (_, fileIndex) => fileIndex !== index,
                          ),
                        )
                      }
                    >
                      {file.name} ×
                    </Button>
                  ))}
                </div>
              )}
              <Input
                input={{ ref: composerInputRef }}
                aria-label="Новое сообщение"
                aria-description="Стрелка вверх в пустом поле — изменить последнее своё сообщение"
                placeholder="Напишите сообщение · @ упомянуть"
                maxLength={20000}
                value={draft}
                disabled={busy}
                onChange={(_, data) => {
                  draftEdited.current = true;
                  setDraft(data.value);
                  if (data.value.endsWith("@")) setMentionPicker(true);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "ArrowUp" &&
                    !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    draft.length === 0 && !editing && !deleting && !taskSource && !busy
                  ) {
                    // Use the full conversation, not the search results. Do not skip
                    // a newer non-editable message in favour of an older one.
                    const lastOwn = activeMessages.filter(
                      (message) => message.authorId === currentUserId && !message.deletedAt,
                    ).at(-1);
                    const hasVoice = attachments.some(
                      (attachment) => attachment.ownerType === "message" && attachment.ownerId === lastOwn?.id && attachment.mediaKind === "voice",
                    );
                    if (lastOwn?.canEdit && canSend && !hasVoice) {
                      event.preventDefault();
                      startEditing(lastOwn);
                    }
                  }
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    send();
                  }
                }}
              />
            </div>
            <Button
              appearance="primary"
              icon={<Send24Filled />}
              aria-label="Отправить сообщение"
              disabled={busy || (!draft.trim() && pendingFiles.length === 0)}
              onClick={send}
            />
          </div>}
        </>
      )}
    </article>
  );
}

export function MessengerView(props: MessengerViewProps) {
  const restoreFocusTarget = useRestoreFocusTarget();
  const { chats, messages, focusChatId, onMarkRead } = props;
  const preferences = props.personalPreferences ?? defaultPersonalPreferences;
  const firstActive = chats.find((chat) => chat.id === preferences.pinnedChatIds[0]) ?? chats.find((chat) => !preferences.archivedChatIds.includes(chat.id));
  const [activeChatId, setActiveChatId] = useState(
    focusChatId ?? firstActive?.id ?? "",
  );
  const [listRevision, setListRevision] = useState(0);
  const [panel, setPanel] = useState<"create" | "manage">();
  const [conversationOpen, setConversationOpen] = useState(Boolean(focusChatId));
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? firstActive;
  useEffect(() => {
    if (activeChat?.unread) void onMarkRead(activeChat.id);
  }, [activeChat?.id, activeChat?.unread, onMarkRead]);
  return (
    <section className={`workspace-view messenger-view ${conversationOpen && activeChat ? "conversation-open" : ""}`} aria-label="Мессенджер">
      <aside className="list-pane">
        <div className="pane-heading messenger-pane-heading">
          <div>
            <span className="messenger-eyebrow">Рабочее пространство</span>
            <h1>Сообщения</h1>
            <p>Диалоги, группы и обсуждения задач</p>
          </div>
          <Tooltip content="Создать чат" relationship="label">
            <Button
              appearance="subtle"
              icon={<Add24Regular />}
              aria-label="Создать чат"
              {...restoreFocusTarget}
              onClick={() => setPanel("create")}
            />
          </Tooltip>
        </div>
        <OrganizedChatList key={listRevision} chats={chats} messages={messages} activeChatId={activeChat?.id} focusChatId={focusChatId}
          preferences={preferences} onChange={props.onPersonalChat} onReorder={props.onPinnedOrder}
          onSelect={(id) => { setActiveChatId(id); setConversationOpen(true); setPanel(undefined); }} />
      </aside>
      {activeChat ? (
        <Conversation
          key={`${props.currentUserId}:${activeChat.id}`}
          {...props}
          chat={activeChat}
          onManage={() => setPanel("manage")}
          onBack={() => setConversationOpen(false)}
        />
      ) : (
        <div className="empty-state">
          Выберите сотрудника или создайте группу
        </div>
      )}
      {(panel === "create" || (panel === "manage" && activeChat)) && (
        <ChatManagement
          key={panel === "create" ? "new" : activeChat?.id}
          chat={panel === "manage" ? activeChat : undefined}
          currentUserId={props.currentUserId}
          people={props.people}
          actions={props.chatActions}
          onClose={() => setPanel(undefined)}
          onCreated={(chat) => {
            setActiveChatId(chat.id);
            setConversationOpen(true);
            setListRevision((revision) => revision + 1);
            setPanel(undefined);
          }}
        />
      )}
    </section>
  );
}
