import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ChatMessage,
  ChatSummary,
  WorkspaceAttachment,
  WorkspacePerson,
  WorkspaceTask,
} from "@yuksalish/contracts";
import {
  Avatar,
  Badge,
  Button,
  Input,
  Tooltip,
} from "@fluentui/react-components";
import {
  Add24Regular,
  Attach24Regular,
  MoreHorizontal24Regular,
  Search24Regular,
  Send24Filled,
  TaskListSquareLtr24Regular,
} from "@fluentui/react-icons";

import { AttachmentChips } from "./AttachmentPanel";

interface MessengerViewProps {
  readonly chats: readonly ChatSummary[];
  readonly messages: readonly ChatMessage[];
  readonly attachments: readonly WorkspaceAttachment[];
  readonly people: readonly WorkspacePerson[];
  readonly onSendMessage: (
    chatId: string,
    body: string,
    files: readonly File[],
  ) => ChatMessage | undefined | Promise<ChatMessage | undefined>;
  readonly onCreateTaskFromMessage: (
    message: ChatMessage,
    title: string,
  ) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onDownloadAttachment: (attachment: WorkspaceAttachment) => void | Promise<void>;
  readonly onMarkRead: (chatId: string) => void | Promise<void>;
}

export function MessengerView({
  chats,
  messages,
  attachments,
  people,
  onSendMessage,
  onCreateTaskFromMessage,
  onDownloadAttachment,
  onMarkRead,
}: MessengerViewProps) {
  const [activeChatId, setActiveChatId] = useState(chats[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [pendingFiles, setPendingFiles] = useState<readonly File[]>([]);
  const [taskSource, setTaskSource] = useState<ChatMessage>();
  const [taskTitle, setTaskTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? chats[0];
  const activeChatKey = activeChat?.id ?? "";
  const activeMessages = messages.filter((message) => message.chatId === activeChatKey);
  const visibleChats = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return chats;
    const matchingChatIds = new Set(
      messages
        .filter((message) => message.body.toLowerCase().includes(normalized))
        .map((message) => message.chatId),
    );
    return chats.filter(
      (chat) => chat.title.toLowerCase().includes(normalized) || matchingChatIds.has(chat.id),
    );
  }, [chats, messages, query]);

  useEffect(() => {
    if (activeChat?.unread) void onMarkRead(activeChat.id);
  }, [activeChat?.id, activeChat?.unread, onMarkRead]);

  const sendMessage = async () => {
    const body = draft.trim();
    if (body.length === 0) return;
    if (activeChat === undefined) return;
    setBusy(true);
    try {
      const message = await onSendMessage(activeChat.id, body, pendingFiles);
      if (message !== undefined) {
        setDraft("");
        setPendingFiles([]);
        if (fileInputRef.current !== null) fileInputRef.current.value = "";
      }
    } finally {
      setBusy(false);
    }
  };

  const startTask = (message: ChatMessage) => {
    setTaskSource(message);
    setTaskTitle(message.body.slice(0, 160));
  };

  const createTask = async () => {
    if (taskSource === undefined || !taskTitle.trim()) return;
    setBusy(true);
    try {
      const task = await onCreateTaskFromMessage(taskSource, taskTitle.trim());
      if (task !== undefined) setTaskSource(undefined);
    } finally {
      setBusy(false);
    }
  };

  const personById = (id: string) => people.find((person) => person.id === id) ?? people[0];

  if (activeChat === undefined) {
    return <section className="workspace-view empty-state">Доступных чатов пока нет</section>;
  }

  return (
    <section className="workspace-view messenger-view" aria-label="Мессенджер">
      <aside className="list-pane">
        <div className="pane-heading">
          <div>
            <h1>Сообщения</h1>
            <p>Все рабочие разговоры</p>
          </div>
          <Tooltip content="Создать чат" relationship="label">
            <Button appearance="subtle" icon={<Add24Regular />} aria-label="Создать чат" />
          </Tooltip>
        </div>
        <Input
          aria-label="Поиск чатов и сообщений"
          className="pane-search"
          contentBefore={<Search24Regular />}
          placeholder="Поиск по чатам и сообщениям"
          value={query}
          onChange={(_event, data) => setQuery(data.value)}
        />
        <div className="chat-list" role="list">
          {visibleChats.map((chat) => (
            <button
              className={`chat-row ${chat.id === activeChatKey ? "selected" : ""}`}
              key={chat.id}
              onClick={() => setActiveChatId(chat.id)}
              type="button"
            >
              <Avatar name={chat.title} size={40} color="colorful" />
              <span className="chat-row-copy">
                <span className="chat-row-line">
                  <strong>{chat.title}</strong>
                  <time>{chat.time}</time>
                </span>
                <span className="chat-row-line preview-line">
                  <span>{chat.preview}</span>
                  {chat.unread > 0 ? (
                    <Badge appearance="filled" color="brand" size="small">
                      {chat.unread}
                    </Badge>
                  ) : null}
                </span>
              </span>
            </button>
          ))}
          {visibleChats.length === 0 ? (
            <div className="empty-compact">Чаты не найдены</div>
          ) : null}
        </div>
      </aside>

      <article className="conversation-pane">
        <header className="conversation-header">
          <div>
            <h2>{activeChat.title}</h2>
            <p>{activeChat.kind === "group" ? "8 участников" : "Рабочий чат"}</p>
          </div>
          <div className="header-actions">
            <Tooltip content="Поиск в переписке" relationship="label">
              <Button appearance="subtle" icon={<Search24Regular />} aria-label="Поиск в переписке" />
            </Tooltip>
            <Tooltip content="Дополнительные действия" relationship="label">
              <Button
                appearance="subtle"
                icon={<MoreHorizontal24Regular />}
                aria-label="Дополнительные действия"
              />
            </Tooltip>
          </div>
        </header>

        <div className="message-scroll" aria-live="polite">
          <div className="date-separator">Сегодня</div>
          {activeMessages.map((message) => {
            const author = personById(message.authorId);
            return (
              <div className={`message ${message.own ? "own" : ""}`} key={message.id}>
                {!message.own ? (
                  <Avatar name={author?.name ?? "Сотрудник"} size={32} color="colorful" />
                ) : null}
                <div className="message-body">
                  {!message.own ? <strong>{author?.name ?? "Сотрудник"}</strong> : null}
                  <p>{message.body}</p>
                  <AttachmentChips
                    attachments={attachments.filter(
                      (attachment) => attachment.ownerType === "message" && attachment.ownerId === message.id,
                    )}
                    onDownload={onDownloadAttachment}
                  />
                  <Button
                    className="message-task-action"
                    appearance="subtle"
                    size="small"
                    icon={<TaskListSquareLtr24Regular />}
                    aria-label={`Создать задачу из сообщения: ${message.body.slice(0, 40)}`}
                    onClick={() => startTask(message)}
                  >
                    В задачу
                  </Button>
                  <time>{message.time}</time>
                </div>
              </div>
            );
          })}
        </div>

        {taskSource !== undefined ? (
          <div className="linked-create-panel" role="region" aria-label="Задача из сообщения">
            <TaskListSquareLtr24Regular />
            <Input
              autoFocus
              aria-label="Название задачи из сообщения"
              value={taskTitle}
              onChange={(_event, data) => setTaskTitle(data.value)}
            />
            <Button appearance="primary" disabled={busy || !taskTitle.trim()} onClick={() => void createTask()}>
              Создать задачу
            </Button>
            <Button appearance="subtle" onClick={() => setTaskSource(undefined)}>Отмена</Button>
          </div>
        ) : null}

        <div className="composer">
          <input
            ref={fileInputRef}
            hidden
            type="file"
            multiple
            aria-label="Файлы сообщения"
            onChange={(event) => setPendingFiles(Array.from(event.target.files ?? []))}
          />
          <Tooltip content="Прикрепить файл" relationship="label">
            <Button
              appearance="subtle"
              icon={<Attach24Regular />}
              aria-label="Прикрепить файл"
              onClick={() => fileInputRef.current?.click()}
            />
          </Tooltip>
          <div className="composer-input">
            {pendingFiles.length > 0 ? (
              <span className="pending-files">{pendingFiles.map((file) => file.name).join(", ")}</span>
            ) : null}
            <Input
            aria-label="Новое сообщение"
            placeholder="Напишите сообщение"
            value={draft}
            onChange={(_event, data) => setDraft(data.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />
          </div>
          <Button
            appearance="primary"
            icon={<Send24Filled />}
            aria-label="Отправить сообщение"
            disabled={busy || draft.trim().length === 0}
            onClick={() => void sendMessage()}
          />
        </div>
      </article>
    </section>
  );
}
