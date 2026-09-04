import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatMessage,
  ChatSummary,
  MessageOptions,
  WorkspaceAttachment,
  WorkspacePerson,
  WorkspaceTask,
} from "@yuksalish/contracts";
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Input,
  Textarea,
  Tooltip,
  useRestoreFocusTarget,
} from "@fluentui/react-components";
import {
  Add24Regular,
  Attach24Regular,
  Search24Regular,
  Send24Filled,
  TaskListSquareLtr24Regular,
} from "@fluentui/react-icons";
import { AttachmentChips } from "./AttachmentPanel";
import { ChatManagement, type ChatActions } from "./ChatManagement";

interface MessengerViewProps {
  readonly focusChatId?: string;
  readonly currentUserId: string;
  readonly chats: readonly ChatSummary[];
  readonly messages: readonly ChatMessage[];
  readonly attachments: readonly WorkspaceAttachment[];
  readonly people: readonly WorkspacePerson[];
  readonly chatActions: ChatActions;
  readonly onSendMessage: (
    chatId: string,
    body: string,
    files: readonly File[],
    options: MessageOptions,
  ) => ChatMessage | undefined | Promise<ChatMessage | undefined>;
  readonly onEditMessage: (message: ChatMessage, body: string) => Promise<void>;
  readonly onDeleteMessage: (message: ChatMessage) => Promise<void>;
  readonly onCreateTaskFromMessage: (
    message: ChatMessage,
    title: string,
  ) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onDownloadAttachment: (
    attachment: WorkspaceAttachment,
  ) => void | Promise<void>;
  readonly onMarkRead: (chatId: string) => void | Promise<void>;
}

function Conversation({
  chat,
  messages,
  attachments,
  people,
  currentUserId,
  onSendMessage,
  onEditMessage,
  onDeleteMessage,
  onCreateTaskFromMessage,
  onDownloadAttachment,
  onManage,
}: Omit<MessengerViewProps, "chats" | "chatActions" | "onMarkRead"> & {
  readonly chat: ChatSummary;
  readonly onManage: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState<ChatMessage>();
  const [mentions, setMentions] = useState<readonly string[]>([]);
  const [mentionPicker, setMentionPicker] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<readonly File[]>([]);
  const [taskSource, setTaskSource] = useState<ChatMessage>();
  const [taskTitle, setTaskTitle] = useState("");
  const [editing, setEditing] = useState<ChatMessage>();
  const [editBody, setEditBody] = useState("");
  const [deleting, setDeleting] = useState<ChatMessage>();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreFocusTarget = useRestoreFocusTarget();
  const scrollRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const canSend = chat.permissions.sendMessages;
  const personName = (id: string) =>
    people.find((person) => person.id === id)?.name ?? "Сотрудник";
  const activeMessages = messages.filter(
    (message) => message.chatId === chat.id,
  );
  const visibleMessages = activeMessages.filter(
    (message) =>
      !query ||
      (!message.deletedAt &&
        message.body.toLowerCase().includes(query.toLowerCase())),
  );
  const activeMemberIds = new Set(chat.members.map((member) => member.userId));
  const latestMessage = activeMessages.at(-1);
  useEffect(() => {
    const pane = scrollRef.current;
    if (pane && (followLatest.current || latestMessage?.authorId === currentUserId)) {
      pane.scrollTop = pane.scrollHeight;
    }
  }, [latestMessage?.id, latestMessage?.authorId, currentUserId]);
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
    if (!canSend || busy || !draft.trim()) return;
    void run(async () => {
      const message = await onSendMessage(chat.id, draft.trim(), pendingFiles, {
        replyToMessageId: reply?.id,
        mentionUserIds: mentions.filter((id) => activeMemberIds.has(id)),
      });
      if (!message)
        throw new Error(
          "Сообщение не отправлено. Текст сохранён — попробуйте снова.",
        );
      setDraft("");
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
        <div>
          <h2>{chat.title}</h2>
          <p>
            {chat.kind === "direct"
              ? "Личный диалог"
              : `${chat.members.length} участников · ${chat.kind === "group" ? "Закрытая группа" : "Рабочий чат"}`}
          </p>
        </div>
        <Button {...restoreFocusTarget} onClick={onManage}>
          {chat.kind === "group" ? "Участники и права" : "Участники"}
        </Button>
      </header>
      <div className="conversation-search">
        <Input
          aria-label="Поиск в переписке"
          placeholder="Найти сообщение в этом чате"
          contentBefore={<Search24Regular />}
          value={query}
          onChange={(_, data) => setQuery(data.value)}
        />
      </div>
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
          const mayEdit = message.canEdit && canSend && !message.deletedAt;
          return (
            <div key={message.id}>
              {(index === 0 || date !== previousDate) && (
                <div className="date-separator">{date}</div>
              )}
              <div
                className={`message ${own ? "own" : ""} ${message.mentionUserIds?.includes(currentUserId) ? "message-mentioned" : ""}`}
              >
                {!own && (
                  <Avatar
                    name={personName(message.authorId)}
                    size={32}
                    color="colorful"
                  />
                )}
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
                        aria-label="Изменить текст сообщения"
                        value={editBody}
                        maxLength={20000}
                        disabled={busy}
                        onChange={(_, data) => setEditBody(data.value)}
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
                  ) : (
                    <p
                      className={
                        message.deletedAt ? "message-deleted" : undefined
                      }
                    >
                      {message.deletedAt ? "Сообщение удалено" : message.body}
                    </p>
                  )}
                  {!message.deletedAt && (
                    <>
                      {!!message.mentionUserIds?.length && (
                        <div className="message-mentions">
                          {message.mentionUserIds.map((id) => (
                            <span key={id}>@{personName(id)}</span>
                          ))}
                        </div>
                      )}
                      <AttachmentChips
                        attachments={attachments.filter(
                          (attachment) =>
                            attachment.ownerType === "message" &&
                            attachment.ownerId === message.id,
                        )}
                        onDownload={onDownloadAttachment}
                      />
                      <div className="message-actions">
                        <Button
                          appearance="subtle"
                          size="small"
                          disabled={!canSend || busy}
                          aria-label={`Ответить: ${message.body.slice(0, 40)}`}
                          onClick={() => setReply(message)}
                        >
                          Ответить
                        </Button>
                        <Button
                          className="message-task-action"
                          appearance="subtle"
                          size="small"
                          icon={<TaskListSquareLtr24Regular />}
                          aria-label={`Создать задачу из сообщения: ${message.body.slice(0, 40)}`}
                          onClick={() => {
                            setTaskSource(message);
                            setTaskTitle(message.body.slice(0, 160));
                          }}
                        >
                          В задачу
                        </Button>
                        {mayEdit && (
                          <>
                            <Button
                              appearance="subtle"
                              size="small"
                              disabled={busy}
                              aria-label={`Изменить сообщение: ${message.body.slice(0, 40)}`}
                              onClick={() => {
                                setEditing(message);
                                setEditBody(message.body);
                              }}
                            >
                              Изменить
                            </Button>
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
                    </>
                  )}
                  <time>
                    {message.editedAt && !message.deletedAt
                      ? "изменено · "
                      : ""}
                    {message.time}
                  </time>
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
      {taskSource && (
        <div
          className="linked-create-panel"
          role="region"
          aria-label="Задача из сообщения"
        >
          <TaskListSquareLtr24Regular />
          <Input
            autoFocus
            aria-label="Название задачи из сообщения"
            value={taskTitle}
            onChange={(_, data) => setTaskTitle(data.value)}
          />
          <Button
            appearance="primary"
            disabled={busy || !taskTitle.trim()}
            onClick={() =>
              void run(async () => {
                if (await onCreateTaskFromMessage(taskSource, taskTitle.trim()))
                  setTaskSource(undefined);
              })
            }
          >
            Создать задачу
          </Button>
          <Button appearance="subtle" onClick={() => setTaskSource(undefined)}>
            Отмена
          </Button>
        </div>
      )}
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
          <div className="composer">
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
                aria-label="Новое сообщение"
                placeholder="Напишите сообщение · @ упомянуть"
                maxLength={20000}
                value={draft}
                disabled={busy}
                onChange={(_, data) => {
                  setDraft(data.value);
                  if (data.value.endsWith("@")) setMentionPicker(true);
                }}
                onKeyDown={(event) => {
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
              disabled={busy || !draft.trim()}
              onClick={send}
            />
          </div>
        </>
      )}
    </article>
  );
}

export function MessengerView(props: MessengerViewProps) {
  const restoreFocusTarget = useRestoreFocusTarget();
  const { chats, messages, focusChatId, onMarkRead } = props;
  const [activeChatId, setActiveChatId] = useState(
    focusChatId ?? chats[0]?.id ?? "",
  );
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<"create" | "manage">();
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? chats[0];
  const visibleChats = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return chats;
    const matching = new Set(
      messages
        .filter(
          (message) =>
            !message.deletedAt &&
            message.body.toLowerCase().includes(normalized),
        )
        .map((message) => message.chatId),
    );
    return chats.filter(
      (chat) =>
        chat.title.toLowerCase().includes(normalized) || matching.has(chat.id),
    );
  }, [chats, messages, query]);
  useEffect(() => {
    if (activeChat?.unread) void onMarkRead(activeChat.id);
  }, [activeChat?.id, activeChat?.unread, onMarkRead]);
  return (
    <section className="workspace-view messenger-view" aria-label="Мессенджер">
      <aside className="list-pane">
        <div className="pane-heading">
          <div>
            <h1>Сообщения</h1>
            <p>Все рабочие разговоры</p>
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
        <Input
          aria-label="Поиск чатов и сообщений"
          className="pane-search"
          contentBefore={<Search24Regular />}
          placeholder="Поиск по чатам и сообщениям"
          value={query}
          onChange={(_, data) => setQuery(data.value)}
        />
        <div className="chat-list" role="list">
          {visibleChats.map((chat) => (
            <button
              className={`chat-row ${chat.id === activeChat?.id ? "selected" : ""}`}
              key={chat.id}
              type="button"
              onClick={() => {
                setActiveChatId(chat.id);
                setPanel(undefined);
              }}
            >
              <Avatar name={chat.title} size={40} color="colorful" />
              <span className="chat-row-copy">
                <span className="chat-row-line">
                  <strong>{chat.title}</strong>
                  <time>{chat.time}</time>
                </span>
                <span className="chat-row-line preview-line">
                  <span>{chat.preview}</span>
                  {chat.unread > 0 && (
                    <Badge appearance="filled" color="brand" size="small">
                      {chat.unread}
                    </Badge>
                  )}
                </span>
              </span>
            </button>
          ))}
          {!visibleChats.length && (
            <div className="empty-compact">
              {chats.length
                ? "Чаты не найдены"
                : "Создайте первый разговор кнопкой +"}
            </div>
          )}
        </div>
      </aside>
      {activeChat ? (
        <Conversation
          key={`${props.currentUserId}:${activeChat.id}`}
          {...props}
          chat={activeChat}
          onManage={() => setPanel("manage")}
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
            setQuery("");
            setPanel(undefined);
          }}
        />
      )}
    </section>
  );
}
