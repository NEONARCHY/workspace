import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WandSparkles } from "lucide-react";
import { scrollToLatest } from "./message-scroll";
import type {
  ChatMessage,
  ChatSummary,
  MessageReaction,
  MessageReactionEmoji,
  PersonalPreferences,
  PersonalChatAction,
  MessageOptions,
  WorkspaceAttachment,
  WorkspacePerson,
  WorkspaceDepartment,
  WorkspaceTask,
  WorkspaceTaskCreateInput,
} from "@yuksalish/contracts";
import {
  Avatar,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Tooltip,
  useRestoreFocusTarget,
} from "@fluentui/react-components";
import {
  Add24Regular,
  Attach24Regular,
  CalendarLtr24Regular,
  Color24Regular,
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
import { ReactionPicker } from "./ReactionPicker";
import { MessageLinkPreviews } from "./MessageLinkPreviews";
import { rewriteMessengerDraft, type AssistantRewriteStyle } from "./workspace-api";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { chatBackgrounds, readChatBackground, saveChatBackground } from "./chat-backgrounds";
import {
  MessageRevealOverlay,
  MessageVanishOverlay,
  type MessageRevealRequest,
  type MessageVanishRequest,
} from "./MessageVanishOverlay";

interface OutgoingMessageReveal {
  readonly messageId?: string;
  readonly request: MessageRevealRequest;
  readonly composerFinished: boolean;
  readonly phase: "waiting" | "revealing";
}

export interface MessengerViewProps {
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
  readonly departments?: readonly WorkspaceDepartment[];
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
  readonly onEditMessage: (message: ChatMessage, body: string, mentionUserIds: readonly string[]) => Promise<void>;
  readonly onDeleteMessage: (message: ChatMessage) => Promise<void>;
  readonly onCreateTaskFromMessage: (
    message: ChatMessage,
    payload: WorkspaceTaskCreateInput,
  ) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onCreateCalendarEventFromChat?: (chat: ChatSummary) => void;
  readonly onDownloadAttachment: (
    attachment: WorkspaceAttachment,
  ) => void | Promise<void>;
  readonly onLoadAttachment: (attachment: WorkspaceAttachment) => Promise<Blob>;
  readonly onMarkRead: (chatId: string) => void | Promise<void>;
  readonly onOpenContext?: (contextType: "task" | "project" | "trip", contextId: string) => void;
  readonly onOpenPersonProfile?: (userId: string) => void;
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

function MessageReactionChip({ reaction, people, token, disabled, onToggle, onOpenDetails }: {
  readonly reaction: MessageReaction;
  readonly people: readonly WorkspacePerson[];
  readonly token: string;
  readonly disabled: boolean;
  readonly onToggle: () => void;
  readonly onOpenDetails: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const reactors = (reaction.reactorUserIds ?? [])
    .map((userId) => people.find((person) => person.id === userId))
    .filter((person): person is WorkspacePerson => person !== undefined);
  const additionalReactors = reactors.length > 1 ? reactors.slice(1, 4) : [];
  const names = reactors.length
    ? reactors.map((person) => person.name)
    : [`${reaction.count} ${reaction.count === 1 ? "реакция" : "реакции"}`];

  return <span
    className="message-reaction-chip"
  >
    <Button
      size="small"
      appearance={reaction.reactedByCurrentUser ? "primary" : "subtle"}
      disabled={disabled}
      aria-label={`${reaction.emoji}: ${names.join(", ")}`}
      aria-haspopup="dialog"
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onOpenDetails(event); }}
      onClick={onToggle}
    >
      <span className="message-reaction-emoji" aria-hidden="true">{reaction.emoji}</span>
      {additionalReactors.length ? <span className="message-reaction-avatars" aria-hidden="true">
        {additionalReactors.map((person) => <ProfileAvatar key={person.id} person={person} token={token} size={20} />)}
      </span> : null}
    </Button>
  </span>;
}

function ReactionPeople({ reactions, people, token, onOpenPersonProfile }: {
  readonly reactions: readonly MessageReaction[];
  readonly people: readonly WorkspacePerson[];
  readonly token: string;
  readonly onOpenPersonProfile?: (userId: string) => void;
}) {
  const entries = reactions.flatMap((reaction) => (reaction.reactorUserIds ?? []).map((userId) => ({ userId, emoji: reaction.emoji })));
  return <div className="message-reaction-people">
    {entries.length ? entries.map(({ userId, emoji }) => {
      const person = people.find((item) => item.id === userId);
      return <button key={`${userId}-${emoji}`} type="button" disabled={!person || !onOpenPersonProfile} onClick={() => person && onOpenPersonProfile?.(person.id)}>
        {person ? <ProfileAvatar person={person} token={token} size={28} /> : <span className="message-reaction-person-fallback" aria-hidden="true">?</span>}
        <span>{person?.name ?? "Сотрудник"}</span><span aria-label={`Реакция ${emoji}`}>{emoji}</span>
      </button>;
    }) : <p>{reactions.reduce((total, reaction) => total + reaction.count, 0)} реакций · список сотрудников недоступен</p>}
  </div>;
}

function Conversation({
  token,
  chat,
  availableChats,
  messages,
  attachments,
  people,
  departments,
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
  onCreateCalendarEventFromChat,
  onDownloadAttachment,
  onLoadAttachment,
  onManage,
  onBack,
  personalPreferences,
  onPersonalChat,
  onOpenContext,
  onOpenPersonProfile,
  embedded = false,
}: Omit<MessengerViewProps, "chats" | "chatActions" | "onMarkRead"> & {
  readonly chat: ChatSummary;
  readonly availableChats: readonly ChatSummary[];
  readonly onManage: () => void;
  readonly onBack: () => void;
  readonly embedded?: boolean;
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
  const [editMentions, setEditMentions] = useState<readonly string[]>([]);
  const [deleting, setDeleting] = useState<ChatMessage>();
  const [removingMessage, setRemovingMessage] = useState<{ message: ChatMessage; index: number; height: number; phase: "ready" | "exiting" | "done" }>();
  const removalTimer = useRef<number | undefined>(undefined);
  const previousRows = useRef(new Map<string, { message: ChatMessage; index: number; height: number }>());
  const locallyRemovedIds = useRef(new Set<string>());
  const [contextMenu, setContextMenu] = useState<{ message: ChatMessage; x: number; y: number }>();
  const [reactionQuick, setReactionQuick] = useState<{ message: ChatMessage; emoji: MessageReactionEmoji; x: number; y: number }>();
  const [reactionDialog, setReactionDialog] = useState<ChatMessage>();
  const [reactionPreview, setReactionPreview] = useState(false);
  const [reactionTargetId, setReactionTargetId] = useState<string>();
  const [chatBackground, setChatBackground] = useState(() => readChatBackground(currentUserId));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [vanishRequest, setVanishRequest] = useState<MessageVanishRequest>();
  const [outgoingReveal, setOutgoingReveal] = useState<OutgoingMessageReveal>();
  const vanishSequence = useRef(0);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [rewriteError, setRewriteError] = useState("");
  const [rewriteSuggestion, setRewriteSuggestion] = useState<{
    source: string; style: AssistantRewriteStyle; text: string;
  }>();
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const rewriteRef = useRef<HTMLDivElement>(null);
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
  const personById = (id: string) => people.find((person) => person.id === id);
  const activeMessages = useMemo(() => messages.filter(
    (message) => message.chatId === chat.id && !message.deletedAt,
  ), [messages, chat.id]);
  const visibleMessages = useMemo(() => activeMessages.filter(
    (message) => message.id === editing?.id || !query
      || message.body.toLowerCase().includes(query.toLowerCase()),
  ), [activeMessages, editing?.id, query]);
  const renderedMessages = visibleMessages.filter((message) => message.id !== removingMessage?.message.id);
  if (removingMessage && removingMessage.phase !== "done") {
    renderedMessages.splice(Math.min(removingMessage.index, renderedMessages.length), 0, removingMessage.message);
  }
  useLayoutEffect(() => {
    const pane = scrollRef.current;
    const currentRows = new Map<string, { message: ChatMessage; index: number; height: number }>();
    const measuredRows = new Map([...pane?.querySelectorAll<HTMLElement>(".message-row") ?? []]
      .map((element) => [element.querySelector<HTMLElement>("[data-message-id]")?.dataset.messageId, element.getBoundingClientRect().height] as const));
    activeMessages.forEach((message, index) => {
      currentRows.set(message.id, { message, index, height: measuredRows.get(message.id) ?? 0 });
    });
    const vanished = [...previousRows.current].find(([id, entry]) =>
      !currentRows.has(id) && !locallyRemovedIds.current.has(id)
      && !entry.message.systemKind && entry.height > 0,
    )?.[1];
    for (const id of locallyRemovedIds.current) {
      if (!currentRows.has(id)) locallyRemovedIds.current.delete(id);
    }
    previousRows.current = currentRows;
    if (!vanished || (removingMessage && removingMessage.phase !== "done")
      || !pane?.getClientRects().length || document.visibilityState !== "visible"
      || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setRemovingMessage({ ...vanished, phase: "ready" });
    requestAnimationFrame(() => requestAnimationFrame(() => setRemovingMessage((current) => current?.message.id === vanished.message.id ? { ...current, phase: "exiting" } : current)));
    if (removalTimer.current) window.clearTimeout(removalTimer.current);
    removalTimer.current = window.setTimeout(() => setRemovingMessage((current) => current?.message.id === vanished.message.id ? { ...current, phase: "done" } : current), 230);
  }, [activeMessages, visibleMessages, removingMessage]);
  useEffect(() => () => { if (removalTimer.current) window.clearTimeout(removalTimer.current); }, []);
  const activeMemberIds = new Set(chat.members.map((member) => member.userId));
  const activeComposerBody = editing ? editBody : draft;
  useEffect(() => {
    if (!rewriteOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rewriteRef.current?.contains(event.target as Node)) setRewriteOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [rewriteOpen]);
  const rewriteStyles: readonly { id: AssistantRewriteStyle; label: string }[] = [
    { id: "conversational", label: "Разговорный" },
    { id: "friendly", label: "Дружелюбный" },
    { id: "professional", label: "Профессиональный" },
    { id: "corporate", label: "Корпоративный" },
    { id: "caveman", label: "Пещерный мем" },
  ];
  const requestRewrite = async (style: AssistantRewriteStyle, source = activeComposerBody) => {
    if (!source.trim() || rewriteBusy) return;
    setRewriteBusy(true);
    setRewriteError("");
    try {
      const suggestion = await rewriteMessengerDraft(token, source.trim(), style);
      setRewriteSuggestion({ source, style, text: suggestion.text });
    } catch (cause) {
      setRewriteError(cause instanceof Error ? cause.message : "Не удалось предложить вариант.");
    } finally {
      setRewriteBusy(false);
    }
  };
  const activeMentions = editing ? editMentions : mentions;
  const mentionMatch = activeComposerBody.match(/(?:^|\s)@([^\s@]*)$/u);
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
  }, [
    latestMessage?.id,
    latestMessage?.authorId,
    currentUserId,
    outgoingReveal?.messageId,
    outgoingReveal?.phase,
  ]);
  useEffect(() => {
    if (editing) {
      const input = composerInputRef.current;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
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
    if (!contextMenu) return;
    const close = () => { setContextMenu(undefined); setReactionPreview(false); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); };
  }, [contextMenu]);
  useEffect(() => {
    if (!reactionQuick) return;
    const close = () => setReactionQuick(undefined);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); window.removeEventListener("keydown", close); };
  }, [reactionQuick]);
  const startEditing = (message: ChatMessage) => {
    if (busy || !canSend || message.authorId !== currentUserId || !message.canEdit || message.deletedAt) return;
    vanishSequence.current += 1;
    setVanishRequest({ id: vanishSequence.current, text: message.body, direction: "restore" });
    setEditing(message);
    setEditBody(message.body);
    setEditMentions(message.mentionUserIds ?? []);
    setMentionPicker(false);
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
    const sentText = draft.trim();
    const sentScrollLeft = composerInputRef.current?.scrollLeft ?? 0;
    const sentFiles = pendingFiles;
    const sentReplyId = reply?.id;
    const sentMentions = mentions.filter((id) => activeMemberIds.has(id));
    let transitionId: number | undefined;
    if (sentText) {
      vanishSequence.current += 1;
      transitionId = vanishSequence.current;
      const request = { id: transitionId, text: sentText };
      setOutgoingReveal({ request, composerFinished: false, phase: "waiting" });
      setVanishRequest({
        ...request,
        direction: "vanish",
        scrollLeft: sentScrollLeft,
      });
      setDraft("");
    }
    focusAfterSend.current = true;
    void run(async () => {
      try {
        const message = await onSendMessage(chat.id, sentText || "Файл", sentFiles, {
          replyToMessageId: sentReplyId,
          mentionUserIds: sentMentions,
        });
        if (!message)
          throw new Error(
            "Сообщение не отправлено. Текст сохранён — попробуйте снова.",
          );
        if (transitionId !== undefined) {
          setOutgoingReveal((current) => current?.request.id === transitionId
            ? {
                ...current,
                messageId: message.id,
                phase: current.composerFinished ? "revealing" : "waiting",
              }
            : current);
        }
      } catch (cause) {
        if (transitionId !== undefined) {
          setOutgoingReveal(undefined);
          setDraft(sentText);
          setVanishRequest({
            id: transitionId,
            text: sentText,
            direction: "restore",
            scrollLeft: sentScrollLeft,
          });
        }
        throw cause;
      }
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
  const saveEdit = () => {
    if (!editing || busy || !editBody.trim()) return;
    focusAfterSend.current = true;
    void run(async () => {
      await onEditMessage(
        editing,
        editBody.trim(),
        editMentions.filter((id) => activeMemberIds.has(id)),
      );
      setEditing(undefined);
      setEditBody("");
      setEditMentions([]);
      setMentionPicker(false);
    });
  };
  return (
    <article className={`conversation-pane${embedded ? " embedded-conversation" : ""}`}>
      <header className="conversation-header">
        {!embedded ? <Button className="compact-back" appearance="subtle" onClick={onBack}>К списку чатов</Button> : null}
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
          <Popover positioning="below-end" trapFocus>
            <PopoverTrigger disableButtonEnhancement><Button className="chat-background-trigger" appearance="subtle" icon={<Color24Regular />} aria-label="Выбрать фон переписки">Фон</Button></PopoverTrigger>
            <PopoverSurface className="chat-background-picker" aria-label="Фон переписки">
              <strong>Фон переписки</strong>
              <p>Ваш выбор действует во всех чатах на этом устройстве.</p>
              <div className="chat-background-options">
                {chatBackgrounds.map((option) => <button key={option.id} type="button" aria-pressed={chatBackground === option.id} onClick={() => { setChatBackground(option.id); saveChatBackground(currentUserId, option.id); }}>
                  <span className={`chat-background-preview is-${option.id}`} aria-hidden="true" />
                  <span><strong>{option.label}</strong><small>{option.description}</small></span>
                </button>)}
              </div>
            </PopoverSurface>
          </Popover>
          {!embedded ? <>
          {chat.contextId && (chat.contextType === "task" || chat.contextType === "project" || chat.contextType === "trip") ? <Button appearance="secondary" onClick={() => onOpenContext?.(chat.contextType as "task" | "project" | "trip", chat.contextId!)}>
            {chat.contextType === "task" ? "Открыть задачу" : chat.contextType === "project" ? "Открыть проект" : "Открыть поездку"}
          </Button> : null}
          {onCreateCalendarEventFromChat ? <Button
            className="conversation-calendar-action"
            appearance="secondary"
            icon={<CalendarLtr24Regular />}
            disabled={busy}
            onClick={() => onCreateCalendarEventFromChat(chat)}
          >
            Мероприятие
          </Button> : null}
          <Button {...restoreFocusTarget} onClick={onManage}>
            {chat.kind === "group" ? "Участники и права" : "Участники"}
          </Button>
          </> : null}
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
                <EmployeeProfileLink userId={message.authorId} personName={personName(message.authorId)}>{personName(message.authorId)}</EmployeeProfileLink>
                <strong>{message.body.slice(0, 140)}</strong>
                <time>{message.time}</time>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="message-scroll" data-chat-background={chatBackground} aria-label="Переписка" aria-live="polite" ref={scrollRef}
        onScroll={(event) => { const pane = event.currentTarget; followLatest.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80; }}>
        {!renderedMessages.length && (
          <div className="empty-compact">
            {query
              ? "Сообщения не найдены"
              : "Начните разговор — отправьте первое сообщение"}
          </div>
        )}
        {renderedMessages.map((message, index) => {
          const parent = activeMessages.find(
            (item) => item.id === message.replyToMessageId,
          );
          const date = message.createdAt
            ? new Date(message.createdAt).toLocaleDateString("ru-RU")
            : "История переписки";
          const previous = renderedMessages[index - 1]?.createdAt;
          const previousDate = previous
            ? new Date(previous).toLocaleDateString("ru-RU")
            : "История переписки";
          if (message.systemKind) return <div key={message.id}>
            {(index === 0 || date !== previousDate) && <div className="date-separator">{date}</div>}
            <div className="message-system" data-message-id={message.id} role="note">
              <span>{message.body}</span><time>{message.time}</time>
            </div>
          </div>;
          const own = message.authorId === currentUserId;
          const messageAttachments = attachments.filter(
            (attachment) => attachment.ownerType === "message" && attachment.ownerId === message.id,
          );
          const voiceAttachments = messageAttachments.filter((attachment) => attachment.mediaKind === "voice");
          const revealPhase = outgoingReveal?.messageId === message.id
            ? outgoingReveal.phase
            : undefined;
          const revealClass = revealPhase === "waiting"
            ? " message-awaiting-reveal"
            : revealPhase === "revealing"
              ? " message-particle-revealing"
              : "";
          return (
            <div key={message.id} className={`message-row${removingMessage?.message.id === message.id ? ` is-removing is-${removingMessage.phase}` : ""}`} style={removingMessage?.message.id === message.id ? { height: removingMessage.phase === "exiting" ? 0 : removingMessage.height } : undefined} hidden={revealPhase === "waiting"}>
              {(index === 0 || date !== previousDate) && (
                <div className="date-separator">{date}</div>
              )}
              <div
                data-message-id={message.id}
                className={`message ${own ? "own" : ""} ${message.isPinned ? "message-pinned" : ""} ${message.mentionUserIds?.includes(currentUserId) ? "message-mentioned" : ""}${revealClass}`}
                aria-hidden={revealPhase ? true : undefined}
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
                tabIndex={revealPhase ? -1 : 0}
                onPointerEnter={() => setReactionTargetId(message.id)}
                onPointerLeave={() => {
                  setReactionTargetId((current) => current === message.id ? undefined : current);
                }}
                onFocus={() => setReactionTargetId(message.id)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setReactionTargetId((current) => current === message.id ? undefined : current);
                }}
              >
                {!own && (
                  <EmployeeProfileLink userId={message.authorId} personName={personName(message.authorId)}>
                    {personById(message.authorId) ? <ProfileAvatar person={personById(message.authorId)!} token={token} size={32} /> : <Avatar name={personName(message.authorId)} size={32} color="colorful" />}
                  </EmployeeProfileLink>
                )}
                <div className="message-content">
                  <div className="message-body">
                    {!own && <EmployeeProfileLink userId={message.authorId} personName={personName(message.authorId)}><strong>{personName(message.authorId)}</strong></EmployeeProfileLink>}
                    {parent && (
                      <blockquote className="message-quote">
                        <EmployeeProfileLink userId={parent.authorId} personName={personName(parent.authorId)}><strong>{personName(parent.authorId)}</strong></EmployeeProfileLink>
                        <span>{parent.body}</span>
                      </blockquote>
                    )}
                    {voiceAttachments.length === 0 ? <p className="message-text">{message.body}</p> : null}
                    {revealPhase === "revealing" ? (
                      <MessageRevealOverlay
                        request={outgoingReveal?.request}
                        onComplete={(id) => {
                          setOutgoingReveal((current) => current?.request.id === id ? undefined : current);
                        }}
                      />
                    ) : null}
                    {!message.deletedAt && (
                      <>
                        {!!message.mentionUserIds?.length && (
                          <div className="message-mentions">
                            {message.mentionUserIds.map((id) => (
                              <EmployeeProfileLink key={id} userId={id} personName={personName(id)}>@{personName(id)}</EmployeeProfileLink>
                            ))}
                          </div>
                        )}
                        {voiceAttachments.map((attachment) => (
                          <VoiceMessagePlayer key={attachment.id} attachment={attachment} onLoad={onLoadAttachment} />
                        ))}
                        {message.body ? <MessageLinkPreviews body={message.body} token={token} /> : null}
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
                        <MessageReactionChip
                          key={reaction.emoji}
                          reaction={reaction}
                          people={people}
                          token={token}
                          disabled={!canSend || busy}
                          onOpenDetails={(event) => { setContextMenu(undefined); setReactionQuick({ message, emoji: reaction.emoji, x: event.clientX, y: event.clientY }); }}
                          onToggle={() => void run(() => onReactMessage(message, reaction.emoji))}
                        />
                      ))}
                    </div>
                  )}
                  {!message.deletedAt && (
                    <div className={`message-actions message-reaction-trigger ${reactionTargetId === message.id ? "is-visible" : ""}`} role="group" aria-label="Реакция на сообщение">
                      <ReactionPicker userId={currentUserId} disabled={!canSend || busy} ownMessage={own}
                        active={(message.reactions ?? []).filter((item) => item.reactedByCurrentUser).map((item) => item.emoji)}
                        onSelect={(emoji) => void run(() => onReactMessage(message, emoji))} />
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
          {message.reactions?.length ? <div className="message-context-reactions" onPointerEnter={() => setReactionPreview(true)} onPointerLeave={() => setReactionPreview(false)}>
            <Button appearance="subtle" aria-haspopup="dialog" aria-expanded={reactionPreview} onFocus={() => setReactionPreview(true)} onClick={() => { setReactionDialog(message); setContextMenu(undefined); setReactionPreview(false); }}>Реакции · {message.reactions.reduce((total, reaction) => total + reaction.count, 0)}</Button>
            {reactionPreview ? <div className={`message-reaction-submenu ${contextMenu.x + 540 < window.innerWidth ? "is-right" : "is-left"}`} role="region" aria-label="Кто поставил реакции">
              <ReactionPeople reactions={message.reactions} people={people} token={token} onOpenPersonProfile={(id) => { setContextMenu(undefined); onOpenPersonProfile?.(id); }} />
            </div> : null}
          </div> : null}
        </MessageContextMenu>;
      })() : null}
      {reactionQuick ? <MessageContextMenu x={reactionQuick.x} y={reactionQuick.y} onPointerDown={(event) => event.stopPropagation()}>
        <strong className="message-reaction-quick-title">{reactionQuick.emoji} · Поставили реакцию</strong>
        <ReactionPeople reactions={(reactionQuick.message.reactions ?? []).filter((reaction) => reaction.emoji === reactionQuick.emoji)} people={people} token={token} onOpenPersonProfile={(id) => { setReactionQuick(undefined); onOpenPersonProfile?.(id); }} />
      </MessageContextMenu> : null}
      <Dialog open={Boolean(reactionDialog)} onOpenChange={(_, data) => { if (!data.open) setReactionDialog(undefined); }}><DialogSurface className="message-reaction-dialog" aria-label="Реакции на сообщение">
        <DialogBody><DialogTitle>Реакции</DialogTitle><DialogContent>
          <div className="message-reaction-summary">{reactionDialog?.reactions?.map((reaction) => <span key={reaction.emoji}>{reaction.emoji} {reaction.count}</span>)}</div>
          <ReactionPeople reactions={reactionDialog?.reactions ?? []} people={people} token={token} onOpenPersonProfile={(id) => { setReactionDialog(undefined); onOpenPersonProfile?.(id); }} />
        </DialogContent></DialogBody>
      </DialogSurface></Dialog>
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
            onClick={() => {
              const target = deleting;
              const row = [...scrollRef.current?.querySelectorAll<HTMLElement>(".message-row") ?? []]
                .find((element) => element.querySelector<HTMLElement>("[data-message-id]")?.dataset.messageId === target.id);
              const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
              locallyRemovedIds.current.add(target.id);
              if (row && target.authorId === currentUserId && !reduceMotion) {
                setRemovingMessage({ message: target, index: visibleMessages.findIndex((message) => message.id === target.id), height: row.getBoundingClientRect().height, phase: "ready" });
                requestAnimationFrame(() => requestAnimationFrame(() => setRemovingMessage((current) => current?.message.id === target.id ? { ...current, phase: "exiting" } : current)));
                removalTimer.current = window.setTimeout(() => setRemovingMessage((current) => current?.message.id === target.id ? { ...current, phase: "done" } : current), 230);
              }
              setDeleting(undefined);
              void run(async () => {
                try {
                  await onDeleteMessage(target);
                  if (reply?.id === target.id) setReply(undefined);
                } catch (cause) {
                  if (removalTimer.current) window.clearTimeout(removalTimer.current);
                  setRemovingMessage(undefined);
                  locallyRemovedIds.current.delete(target.id);
                  throw cause;
                }
              });
            }}
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
        departments={departments}
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
                <small>Ответ · <EmployeeProfileLink userId={reply.authorId} personName={personName(reply.authorId)}>{personName(reply.authorId)}</EmployeeProfileLink></small>
                <p>
                  {reply.body.slice(0, 200)}
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
          {editing ? (
            <div className="composer-context composer-edit-context">
              <div>
                <small>Редактирование сообщения</small>
                <p>Изменения будут сохранены в сообщении от {editing.time}</p>
              </div>
              <Button appearance="subtle" aria-label="Отменить редактирование" disabled={busy} onClick={() => {
                setEditing(undefined);
                setEditBody("");
                setEditMentions([]);
                setMentionPicker(false);
              }}>×</Button>
            </div>
          ) : null}
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
                const selected = activeMentions.includes(member.userId);
                return <button
                  className="mention-person"
                  type="button"
                  key={member.userId}
                  aria-label={`@${person.name}`}
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => {
                    const nextMentions = selected
                      ? activeMentions.filter((id) => id !== member.userId)
                      : [...new Set([...activeMentions, member.userId])];
                    if (editing) setEditMentions(nextMentions);
                    else setMentions(nextMentions);
                    if (!selected && mentionMatch) {
                      const nextBody = activeComposerBody.slice(0, mentionMatch.index! + mentionMatch[0].lastIndexOf("@")).trimEnd();
                      if (editing) setEditBody(nextBody);
                      else setDraft(nextBody);
                      setMentionPicker(false);
                      requestAnimationFrame(() => composerInputRef.current?.focus());
                    }
                  }}
                >
                  <span className="mention-person-identity">
                    <ProfileAvatar person={person} token={token} size={28} />
                    <strong>{person.name}</strong>
                    <small>@{person.username || person.name.replace(/\s+/gu, "_")}</small>
                  </span>
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
                disabled={busy || Boolean(editing) || !chat.permissions.uploadFiles}
                onClick={() => fileInputRef.current?.click()}
              />
            </Tooltip>
            <Tooltip content="Создать мероприятие с участниками этого чата" relationship="label">
              <Button
                appearance="subtle"
                icon={<CalendarLtr24Regular />}
                aria-label="Создать мероприятие из чата"
                disabled={busy}
                onClick={() => onCreateCalendarEventFromChat?.(chat)}
              />
            </Tooltip>
            <Button
              className="composer-mention-button"
              appearance="subtle"
              aria-label="Упомянуть участника"
              aria-expanded={mentionPicker}
              disabled={busy}
              onClick={() => setMentionPicker(!mentionPicker)}
            >
              <span className="composer-mention-glyph" aria-hidden="true">@</span>
              {activeMentions.length ? <span className="composer-mention-count">{activeMentions.length}</span> : null}
            </Button>
            <Tooltip content="Записать голосовое сообщение" relationship="label">
              <Button
                appearance="subtle"
                icon={<Mic24Regular />}
                aria-label="Записать голосовое сообщение"
                disabled={busy || Boolean(editing) || Boolean(draft.trim()) || pendingFiles.length > 0}
                onClick={() => setVoiceOpen(true)}
              />
            </Tooltip>
            <div className="composer-rewrite-anchor" ref={rewriteRef}>
              <Tooltip content="Переформулировать черновик с ИИ" relationship="label">
                <Button appearance="subtle" icon={<WandSparkles size={19} />}
                  aria-label="Переформулировать черновик с ИИ" aria-expanded={rewriteOpen}
                  disabled={busy || !canSend || !activeComposerBody.trim()}
                  onClick={() => { setRewriteOpen((value) => !value); setRewriteSuggestion(undefined); setRewriteError(""); }} />
              </Tooltip>
              {rewriteOpen && <div className="composer-rewrite-panel" role="dialog" aria-label="Стиль сообщения">
                <div className="composer-rewrite-heading">В каком стиле написать?</div>
                <div className="composer-rewrite-styles">
                  {rewriteStyles.map((style) => <button type="button" key={style.id}
                    disabled={rewriteBusy} onClick={() => void requestRewrite(style.id)}>
                    {style.label}
                  </button>)}
                </div>
                {rewriteBusy && <p role="status">Готовлю вариант…</p>}
                {rewriteSuggestion && <div className="composer-rewrite-result">
                  <p>{rewriteSuggestion.text}</p>
                  <div>
                    <button type="button" disabled={rewriteBusy || activeComposerBody !== rewriteSuggestion.source}
                      onClick={() => {
                        if (editing) setEditBody(rewriteSuggestion.text);
                        else { draftEdited.current = true; setDraft(rewriteSuggestion.text); }
                        setRewriteOpen(false);
                        composerInputRef.current?.focus();
                      }}>Заменить мой текст</button>
                    <button type="button" disabled={rewriteBusy}
                      onClick={() => void requestRewrite(rewriteSuggestion.style, rewriteSuggestion.source)}>
                      Перегенерировать
                    </button>
                  </div>
                  {activeComposerBody !== rewriteSuggestion.source && <small>Черновик изменился. Выберите стиль ещё раз.</small>}
                </div>}
                {rewriteError && <p role="alert">{rewriteError}</p>}
              </div>}
            </div>
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
              <div className={`composer-field-shell${vanishRequest ? " is-message-animating" : ""}`}>
                <Input
                  input={{ ref: composerInputRef }}
                  aria-label={editing ? "Редактирование сообщения" : "Новое сообщение"}
                  aria-description="Стрелка вверх в пустом поле — изменить последнее своё сообщение"
                  placeholder={editing ? "Измените сообщение" : "Напишите сообщение · @ упомянуть"}
                  maxLength={20000}
                  value={editing ? editBody : draft}
                  disabled={busy}
                  onChange={(_, data) => {
                    if (editing) {
                      setEditBody(data.value);
                      setMentionPicker(/(?:^|\s)@[^\s@]*$/u.test(data.value));
                      return;
                    }
                    draftEdited.current = true;
                    setDraft(data.value);
                    setMentionPicker(/(?:^|\s)@[^\s@]*$/u.test(data.value));
                  }}
                  onKeyDown={(event) => {
                  if (
                    event.key === "ArrowUp" &&
                    !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    draft.length === 0 && pendingFiles.length === 0 && !reply &&
                    !editing && !deleting && !taskSource && !busy
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
                    if (editing) saveEdit();
                    else send();
                  }
                  if (event.key === "Escape" && editing && !busy && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    setEditing(undefined);
                    setEditBody("");
                    setEditMentions([]);
                    setMentionPicker(false);
                  }
                  }}
                />
                <MessageVanishOverlay
                  inputRef={composerInputRef}
                  request={vanishRequest}
                  onComplete={(id) => {
                    setVanishRequest((current) => current?.id === id ? undefined : current);
                    setOutgoingReveal((current) => current?.request.id === id
                      ? {
                          ...current,
                          composerFinished: true,
                          phase: current.messageId ? "revealing" : "waiting",
                        }
                      : current);
                  }}
                />
              </div>
            </div>
            <Button
              appearance="primary"
              icon={<Send24Filled />}
              aria-label={editing ? "Сохранить изменения" : "Отправить сообщение"}
              disabled={busy || (editing ? !editBody.trim() : (!draft.trim() && pendingFiles.length === 0))}
              onClick={editing ? saveEdit : send}
            />
          </div>}
        </>
      )}
    </article>
  );
}

export function EmbeddedConversation(props: MessengerViewProps & {
  readonly chatId: string;
  readonly contextLabel?: "задачи" | "проекта" | "поездки";
}) {
  const { onMarkRead, contextLabel = "задачи" } = props;
  const chat = props.chats.find((item) => item.id === props.chatId);
  useEffect(() => {
    if (chat?.unread) void onMarkRead(chat.id);
  }, [chat?.id, chat?.unread, onMarkRead]);
  if (!chat) return <div className="embedded-chat-unavailable">Чат {contextLabel} недоступен для вашей роли.</div>;
  return <section className="messenger-view embedded-chat" aria-label={`Чат ${contextLabel}: ${chat.title}`}>
    <Conversation
      key={`${props.currentUserId}:${chat.id}`}
      {...props}
      chat={chat}
      availableChats={props.chats}
      onManage={() => undefined}
      onBack={() => undefined}
      embedded
    />
  </section>;
}

export function MessengerView(props: MessengerViewProps) {
  const restoreFocusTarget = useRestoreFocusTarget();
  const { chats, messages, focusChatId, onMarkRead } = props;
  const [pendingChatDeletion, setPendingChatDeletion] = useState<{ chat: ChatSummary; deadline: number }>();
  const [chatDeleteSeconds, setChatDeleteSeconds] = useState(6);
  const [chatDeletionError, setChatDeletionError] = useState("");
  const [pendingLeave, setPendingLeave] = useState<ChatSummary>();
  const [leaveBusy, setLeaveBusy] = useState(false);
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
    if (chat.contextType || (chat.kind !== "direct" && chat.kind !== "group")) return;
    setChatDeletionError("");
    setPendingChatDeletion({ chat, deadline: Date.now() + 6_000 });
    setChatDeleteSeconds(6);
    setPanel(undefined);
    setConversationOpen(false);
  };
  const openDirectChat = async (person: WorkspacePerson) => {
    const chat = await props.chatActions.create({
      kind: "direct",
      title: "",
      description: "",
      memberIds: [person.id],
    });
    setActiveChatId(chat.id);
    setConversationOpen(true);
    setPanel(undefined);
    setListRevision((revision) => revision + 1);
  };
  const leaveGroup = async () => {
    if (!pendingLeave || leaveBusy) return;
    setLeaveBusy(true);
    setChatDeletionError("");
    try {
      await props.chatActions.remove(pendingLeave.id, props.currentUserId);
      if (activeChatId === pendingLeave.id) setConversationOpen(false);
      setPendingLeave(undefined);
    } catch (cause) {
      setChatDeletionError(cause instanceof Error ? cause.message : "Не удалось выйти из группы");
    } finally {
      setLeaveBusy(false);
    }
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
          <Tooltip content="Создать группу" relationship="label">
            <Button
              appearance="subtle"
              icon={<Add24Regular />}
              aria-label="Создать группу"
              {...restoreFocusTarget}
              onClick={() => setPanel("create")}
            />
          </Tooltip>
        </div>
          <OrganizedChatList key={listRevision} token={props.token} chats={visibleChats} messages={messages} people={props.people} currentUserId={props.currentUserId} activeChatId={activeChat?.id} focusChatId={focusChatId}
          preferences={preferences} onChange={props.onPersonalChat} onReorder={props.onPinnedOrder}
          onDelete={requestChatDeletion} onLeave={setPendingLeave} onOpenDirect={openDirectChat}
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
          token={props.token}
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
          onRequestLeave={(group) => { setPanel(undefined); setPendingLeave(group); }}
          allowDelete={Boolean(activeChat?.canDelete)}
        />
      )}
      <ConfirmActionDialog
        open={Boolean(pendingLeave)}
        title="Выйти из группы?"
        message={pendingLeave ? `Группа «${pendingLeave.title}» исчезнет из вашего списка. История останется у других участников.` : ""}
        confirmLabel="Выйти"
        busyLabel="Выходим…"
        busy={leaveBusy}
        onCancel={() => { if (!leaveBusy) setPendingLeave(undefined); }}
        onConfirm={() => void leaveGroup()}
      />
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
