import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { ProfileAvatar } from "./ProfileAvatar";

const reactionOptions: readonly { emoji: MessageReactionEmoji; label: string }[] = [
  { emoji: "👍", label: "Нравится" },
  { emoji: "👎", label: "Не нравится" },
  { emoji: "❤️", label: "Сердце" },
  { emoji: "👏", label: "Аплодисменты" },
  { emoji: "🎉", label: "Праздник" },
  { emoji: "👀", label: "Смотрю" },
  { emoji: "✅", label: "Готово" },
  { emoji: "🔥", label: "Огонь" },
  { emoji: "😂", label: "Смешно" },
  { emoji: "😮", label: "Удивление" },
  { emoji: "😢", label: "Грустно" },
  { emoji: "🙏", label: "Спасибо" },
  { emoji: "🤝", label: "Договорились" },
  { emoji: "💯", label: "Сто процентов" },
  { emoji: "❗", label: "Важно" },
  { emoji: "🥰", label: "Мило" },
  { emoji: "😍", label: "В восторге" },
  { emoji: "🤔", label: "Думаю" },
  { emoji: "🤩", label: "Впечатляет" },
  { emoji: "🥳", label: "Поздравляю" },
  { emoji: "😎", label: "Круто" },
  { emoji: "🤯", label: "Невероятно" },
  { emoji: "😡", label: "Злюсь" },
  { emoji: "💩", label: "Плохо" },
  { emoji: "👌", label: "Хорошо" },
  { emoji: "💪", label: "Сила" },
  { emoji: "🙌", label: "Ура" },
  { emoji: "🚀", label: "Вперёд" },
];

interface MessengerViewProps {
  readonly token: string;
  readonly personalPreferences?: PersonalPreferences;
  readonly onPersonalChat?: (id: string, action: PersonalChatAction) => Promise<void>;
  readonly onPinnedOrder?: (order: readonly string[]) => Promise<void>;
  readonly focusChatId?: string;
  readonly currentUserId: string;
  readonly currentUserRole: string;
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

function MessageContextMenu({
  x,
  y,
  children,
  onPointerDown,
}: {
  readonly x: number;
  readonly y: number;
  readonly children: React.ReactNode;
  readonly onPointerDown: React.PointerEventHandler<HTMLDivElement>;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin)),
    });
  }, [x, y]);

  return createPortal(
    <div
      ref={menuRef}
      className="message-context-menu"
      role="menu"
      style={{ left: position.x, top: position.y }}
      onPointerDown={onPointerDown}
    >
      {children}
    </div>,
    document.body,
  );
}

function Conversation({
  token,
  chat,
  availableChats,
  messages,
  attachments,
  people,
  tasks,
  currentUserId,
  currentUserRole,
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
  readonly availableChats: readonly ChatSummary[];
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
  const [forwarding, setForwarding] = useState<ChatMessage>();
  const [editing, setEditing] = useState<ChatMessage>();
  const [editBody, setEditBody] = useState("");
  const [deleting, setDeleting] = useState<ChatMessage>();
  const [pendingDeletion, setPendingDeletion] = useState<{ message: ChatMessage; deadline: number }>();
  const [deleteSeconds, setDeleteSeconds] = useState(6);
  const [contextMenu, setContextMenu] = useState<{ message: ChatMessage; x: number; y: number }>();
  const [reactionTargetId, setReactionTargetId] = useState<string>();
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
  const reactionTimer = useRef(0);
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
  const mentionMatch = draft.match(/(?:^|\s)@([^\s@]*)$/u);
  const mentionQuery = (mentionMatch?.[1] ?? "").toLocaleLowerCase("ru");
  const mentionCandidates = chat.members.filter((member) => {
    if (member.userId === currentUserId) return false;
    const person = people.find((item) => item.id === member.userId);
    return !mentionQuery || `${person?.name ?? ""} ${person?.username ?? ""}`.toLocaleLowerCase("ru").includes(mentionQuery);
  });
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
  useEffect(() => {
    if (!pendingDeletion) return;
    const tick = () => setDeleteSeconds(Math.max(0, Math.ceil((pendingDeletion.deadline - Date.now()) / 1_000)));
    tick();
    const interval = window.setInterval(tick, 200);
    const timeout = window.setTimeout(() => {
      setBusy(true);
      setError("");
      void onDeleteMessage(pendingDeletion.message)
        .then(() => {
          if (reply?.id === pendingDeletion.message.id) setReply(undefined);
          setPendingDeletion(undefined);
        })
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Не удалось удалить сообщение"))
        .finally(() => setBusy(false));
    }, Math.max(0, pendingDeletion.deadline - Date.now()));
    return () => { window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [onDeleteMessage, pendingDeletion, reply?.id]);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(undefined);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); };
  }, [contextMenu]);
  useEffect(() => () => window.clearTimeout(reactionTimer.current), []);
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
        <div className="conversation-header-actions">
          <Button {...restoreFocusTarget} onClick={onManage}>
            {chat.kind === "group" ? "Участники и права" : "Участники"}
          </Button>
        </div>
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
          return (
            <div key={message.id}>
              {(index === 0 || date !== previousDate) && (
                <div className="date-separator">{date}</div>
              )}
              <div
                data-message-id={message.id}
                className={`message ${own ? "own" : ""} ${message.isPinned ? "message-pinned" : ""} ${message.mentionUserIds?.includes(currentUserId) ? "message-mentioned" : ""} ${pendingDeletion?.message.id === message.id ? "is-pending-delete" : ""}`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ message, x: event.clientX, y: event.clientY });
                }}
                onKeyDown={(event) => {
                  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setContextMenu({ message, x: rect.left + 28, y: rect.top + 28 });
                  }
                }}
                tabIndex={0}
                onPointerEnter={() => {
                  window.clearTimeout(reactionTimer.current);
                  setReactionTargetId(undefined);
                  reactionTimer.current = window.setTimeout(() => setReactionTargetId(message.id), 1_000);
                }}
                onPointerLeave={() => {
                  window.clearTimeout(reactionTimer.current);
                  setReactionTargetId((current) => current === message.id ? undefined : current);
                }}
                onFocus={() => setReactionTargetId(message.id)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setReactionTargetId((current) => current === message.id ? undefined : current);
                }}
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
                          onLoad={onLoadAttachment}
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
                    <div className={`message-actions message-reaction-trigger ${reactionTargetId === message.id ? "is-visible" : ""}`} role="group" aria-label="Реакция на сообщение">
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
                        <MenuPopover className="message-reaction-popover">
                          <MenuList className="message-reaction-grid">
                            {reactionOptions.map((reaction) => (
                              <MenuItem
                                aria-label={reaction.label}
                                key={reaction.emoji}
                                onClick={() => void run(() => onReactMessage(message, reaction.emoji))}
                              >
                                {reaction.emoji}
                              </MenuItem>
                            ))}
                          </MenuList>
                        </MenuPopover>
                      </Menu>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {contextMenu ? (() => {
        const message = contextMenu.message;
        const own = message.authorId === currentUserId;
        const hasVoice = attachments.some((attachment) => attachment.ownerType === "message" && attachment.ownerId === message.id && attachment.mediaKind === "voice");
        const mayDelete = message.canDelete ?? (own || message.canPin || ["admin", "superadmin"].includes(currentUserRole));
        return <MessageContextMenu x={contextMenu.x} y={contextMenu.y} onPointerDown={(event) => event.stopPropagation()}>
          <Button appearance="subtle" onClick={() => { setReply(message); setContextMenu(undefined); }}>Ответить</Button>
          <Button appearance="subtle" onClick={() => { setForwarding(message); setContextMenu(undefined); }}>Переслать</Button>
          {message.canPin ? <Button appearance="subtle" icon={message.isPinned ? <PinOff24Regular /> : <Pin24Regular />} onClick={() => { void run(() => onPinMessage(message, !message.isPinned)); setContextMenu(undefined); }}>{message.isPinned ? "Открепить" : "Закрепить"}</Button> : null}
          <Button appearance="subtle" icon={<TaskListSquareLtr24Regular />} onClick={() => { setTaskSource(message); setContextMenu(undefined); }}>В задачу</Button>
          {own && message.canEdit && !hasVoice ? <Button appearance="subtle" onClick={() => { startEditing(message); setContextMenu(undefined); }}>Изменить</Button> : null}
          {mayDelete ? <Button appearance="subtle" onClick={() => { setDeleting(message); setContextMenu(undefined); }}>Удалить</Button> : null}
        </MessageContextMenu>;
      })() : null}
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
                setPendingDeletion({ message: deleting, deadline: Date.now() + 6_000 });
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
      {pendingDeletion ? <div className="messenger-undo" role="status">
        <span>Сообщение будет удалено через {deleteSeconds} сек.</span>
        <Button size="small" appearance="primary" onClick={() => setPendingDeletion(undefined)}>Вернуть</Button>
      </div> : null}
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
      {forwarding ? <div className="message-forward-overlay" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setForwarding(undefined); }}>
        <aside className="message-forward-drawer" role="dialog" aria-modal="true" aria-label="Переслать сообщение">
          <header><div><small>Пересылка</small><strong>Выберите чат</strong></div><Button appearance="subtle" aria-label="Закрыть пересылку" onClick={() => setForwarding(undefined)}>×</Button></header>
          <p>{forwarding.body.slice(0, 180)}</p>
          <div className="message-forward-list">
            {availableChats.filter((target) => target.id !== chat.id && target.permissions.sendMessages).map((target) => <button type="button" key={target.id} onClick={() => void run(async () => {
              const forwarded = await onSendMessage(target.id, `Переслано от ${personName(forwarding.authorId)}:\n${forwarding.body}`, [], { mentionUserIds: [] });
              if (!forwarded) throw new Error("Не удалось переслать сообщение");
              setForwarding(undefined);
            })}><Avatar name={target.title} size={32} color="colorful" /><span><strong>{target.title}</strong><small>{target.kind === "direct" ? "Личный диалог" : "Рабочий чат"}</small></span></button>)}
          </div>
        </aside>
      </div> : null}
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
              {mentionCandidates.map((member) => {
                const person = people.find((item) => item.id === member.userId);
                if (!person) return null;
                const selected = mentions.includes(member.userId);
                return <button
                  className="mention-person"
                  type="button"
                  key={member.userId}
                  aria-label={`@${person.name}`}
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => {
                    setMentions(selected ? mentions.filter((id) => id !== member.userId) : [...new Set([...mentions, member.userId])]);
                    if (!selected && mentionMatch) {
                      const handle = person.username || person.name.replace(/\s+/gu, "_");
                      setDraft(`${draft.slice(0, mentionMatch.index! + mentionMatch[0].lastIndexOf("@"))}@${handle} `);
                      setMentionPicker(false);
                      requestAnimationFrame(() => composerInputRef.current?.focus());
                    }
                  }}
                >
                  <ProfileAvatar person={person} token={token} size={28} />
                  <span><strong>{person.name}</strong><small>@{person.username || person.name.replace(/\s+/gu, "_")}</small></span>
                  {selected ? <b aria-hidden="true">✓</b> : null}
                </button>;
              })}
              {!mentionCandidates.length ? <span className="mention-empty">Участники не найдены</span> : null}
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
            <Tooltip content="Записать голосовое сообщение" relationship="label">
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
                  setMentionPicker(/(?:^|\s)@[^\s@]*$/u.test(data.value));
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
  const [pendingChatDeletion, setPendingChatDeletion] = useState<{ chat: ChatSummary; deadline: number }>();
  const [chatDeleteSeconds, setChatDeleteSeconds] = useState(6);
  const [chatDeletionError, setChatDeletionError] = useState("");
  const visibleChats = chats.filter((chat) => chat.id !== pendingChatDeletion?.chat.id);
  const preferences = props.personalPreferences ?? defaultPersonalPreferences;
  const firstActive = visibleChats.find((chat) => chat.id === preferences.pinnedChatIds[0]) ?? visibleChats.find((chat) => !preferences.archivedChatIds.includes(chat.id));
  const [activeChatId, setActiveChatId] = useState(
    focusChatId ?? firstActive?.id ?? "",
  );
  const [listRevision, setListRevision] = useState(0);
  const [panel, setPanel] = useState<"create" | "manage">();
  const [conversationOpen, setConversationOpen] = useState(Boolean(focusChatId));
  const activeChat = visibleChats.find((chat) => chat.id === activeChatId) ?? firstActive;
  const requestChatDeletion = (chat: ChatSummary) => {
    setChatDeletionError("");
    setPendingChatDeletion({ chat, deadline: Date.now() + 6_000 });
    setChatDeleteSeconds(6);
    setPanel(undefined);
    setConversationOpen(false);
  };
  useEffect(() => {
    if (!pendingChatDeletion) return;
    const tick = () => setChatDeleteSeconds(Math.max(0, Math.ceil((pendingChatDeletion.deadline - Date.now()) / 1_000)));
    tick();
    const interval = window.setInterval(tick, 200);
    const timeout = window.setTimeout(() => {
      void props.chatActions.delete(pendingChatDeletion.chat.id)
        .then(() => {
          setPendingChatDeletion(undefined);
          setChatDeletionError("");
        })
        .catch((cause: unknown) => {
          setPendingChatDeletion(undefined);
          setConversationOpen(true);
          setChatDeletionError(cause instanceof Error ? cause.message : "Не удалось удалить чат");
        });
    }, Math.max(0, pendingChatDeletion.deadline - Date.now()));
    return () => { window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [pendingChatDeletion, props.chatActions]);
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
          <OrganizedChatList key={listRevision} chats={visibleChats} messages={messages} activeChatId={activeChat?.id} focusChatId={focusChatId}
          preferences={preferences} onChange={props.onPersonalChat} onReorder={props.onPinnedOrder}
          onDelete={requestChatDeletion}
          onSelect={(id) => { setActiveChatId(id); setConversationOpen(true); setPanel(undefined); }} />
      </aside>
      {activeChat ? (
        <Conversation
          key={`${props.currentUserId}:${activeChat.id}`}
          {...props}
          chat={activeChat}
          availableChats={visibleChats}
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
          onRequestDelete={requestChatDeletion}
          allowDelete={Boolean(activeChat?.canDelete)}
        />
      )}
      {pendingChatDeletion ? <div className="messenger-undo" role="status">
        <span>Чат будет удалён через {chatDeleteSeconds} сек.</span>
        <Button size="small" appearance="primary" onClick={() => setPendingChatDeletion(undefined)}>Вернуть</Button>
      </div> : null}
      {chatDeletionError ? (
        <div className="messenger-error messenger-chat-delete-error" role="alert">
          <span>{chatDeletionError}</span>
          <Button size="small" appearance="subtle" onClick={() => setChatDeletionError("")}>Закрыть</Button>
        </div>
      ) : null}
    </section>
  );
}
