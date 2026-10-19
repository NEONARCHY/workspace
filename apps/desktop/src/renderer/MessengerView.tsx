import { EmployeeAvatar as Avatar } from "./EmployeeAvatar";
import { RichMessageEditor } from "./RichMessageEditor";
import { RichMessageText, EMPTY_ENTITIES, editorSelection, setEditorSelection, trimRichDocument } from "./message-rich-text";
import { decodeRichDraft, encodeRichDraft, useRichComposer } from "./useRichComposer";
import "./message-rich-text.css";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { ReactionEmoji } from "./ReactionEmoji";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject, SetStateAction } from "react";
import { CheckSquare, Copy, Forward, ListTodo, Pencil, Pin, PinOff, Reply, Smile, Trash2, UserRound, UsersRound, WandSparkles } from "lucide-react";
import { useMessageArrivalMotion } from "./useMessageArrivalMotion";
import { ComposerSendTransition, MessageTextAnimate } from "./MessageTextAnimate";
import type {
  AssistantActionDraft,
  ChatMessage,
  ChatSummary,
  ChatAvatarIconKey,
  MessageReaction,
  MessageReactionEmoji,
  PersonalPreferences,
  PersonalChatAction,
  MessageOptions,
  MessageEntity,
  MessageQuote,
  WorkspaceAttachment,
  WorkspacePerson,
  WorkspaceDepartment,
  WorkspaceTask,
  WorkspaceTaskCreateInput,
} from "@yuksalish/contracts";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Textarea,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Tooltip,
  useRestoreFocusTarget,
} from "@fluentui/react-components";
import { Input } from "./WorkspaceInput";
import {
  Attach24Regular,
  CalendarLtr24Regular,
  ChevronLeft20Regular,
  Color24Regular,
  Dismiss24Regular,
  Mic24Regular,
  MoreHorizontal20Regular,
  Pin24Regular,
  Search24Regular,
  Send24Filled,
} from "@fluentui/react-icons";
import { AttachmentChips } from "./AttachmentPanel";
import { PendingMessageFiles } from "./PendingMessageFiles";
import { MessageAttachmentsDialog } from "./MessageAttachmentsDialog";
import { ChatManagement, type ChatActions } from "./ChatManagement";
import { OrganizedChatList } from "./OrganizedChatList";
import { BrowserChatActions } from "./BrowserChatActions";
import { useBrowserCompactLayout } from "./browser-layout";
import { UndoActionsToast, useUndoActions } from "./UndoActions";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { defaultPersonalPreferences } from "./personal-organization";
import { TaskComposer } from "./TaskComposer";
import { sendMessengerRecording, VoiceMessagePlayer, VoiceRecorder } from "./VoiceMessage";
import { workspacePlatform } from "./platform-adapter";
import { ProfileAvatar } from "./ProfileAvatar";
import { ReactionPicker } from "./ReactionPicker";
import { MessageContextMenu, menuPortalContainerFor } from "./MessageContextMenu";
import { ReactionPeople, ReactionDetailsMenu, type ReactionDetailsTarget } from "./ReactionPeople";
import { MessageLinkPreviews } from "./MessageLinkPreviews";
import { rewriteMessengerDraft, validateWorkspaceAttachmentFile, type AssistantRewriteStyle } from "./workspace-api";
import { MessengerFileDropSurface, useMessengerFileNavigationGuard } from "./MessengerFileDrop";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { ForwardDialog, type ForwardContentAction } from "./ForwardDialog";
import { ForwardedMessage } from "./ForwardedMessage";
import { ZoomInvitationCard } from "./ZoomInvitationCard";
import { fileViewerKind } from "./file-viewer-kind";
import { MessageMetadata } from "./MessageMetadata";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { EmployeeScopeSwitch } from "./EmployeeScopeSwitch";
import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";
import { employeeScope, type EmployeeScope } from "./employee-scope";
import { chatBackgrounds, readChatBackground, saveChatBackground } from "./chat-backgrounds";
import { ChatAvatar, ChatIconPicker, defaultChatIcon } from "./ChatAvatar";

function messagesShareBubbleGroup(first?: ChatMessage, second?: ChatMessage): boolean {
  if (!first || !second || first.systemKind || second.systemKind || first.chatId !== second.chatId
    || first.authorId !== second.authorId || !first.createdAt || !second.createdAt
    || first.replyToMessageId || second.replyToMessageId || first.isPinned || second.isPinned
    || first.forwarded || second.forwarded || first.zoomInvitation || second.zoomInvitation
    || first.reactions?.length || first.deletedAt || second.deletedAt) return false;
  const firstAt = Date.parse(first.createdAt);
  const secondAt = Date.parse(second.createdAt);
  return Number.isFinite(firstAt) && Number.isFinite(secondAt)
    && secondAt >= firstAt && secondAt - firstAt <= 5 * 60_000
    && new Date(firstAt).toDateString() === new Date(secondAt).toDateString();
}

function useComposerState<T>(initial: T | (() => T), revisionRef: RefObject<number>) {
  const [value, setValue] = useState(initial);
  const update = useCallback((next: SetStateAction<T>) => { revisionRef.current += 1; setValue(next); }, [revisionRef]);
  return [value, update] as const;
}

type ReplyTarget = ChatMessage & { readonly selectedQuote?: MessageQuote };

interface OutgoingDraft {
  readonly entities: readonly MessageEntity[];
  readonly id: number;
  readonly text: string;
  readonly files: readonly File[];
  readonly reply?: ReplyTarget;
  readonly mentions: readonly string[];
  readonly error: string;
}

export interface MessengerViewProps {
  readonly onForwardContent?: ForwardContentAction;
  readonly onOpenFeedPost?: (id: string) => void | Promise<void>;
  readonly canUseAssistant?: boolean;
  readonly assistantDraft?: AssistantActionDraft;
  readonly assistantRecipientId?: string;
  readonly token: string;
  readonly personalPreferences?: PersonalPreferences;
  readonly onPersonalChat?: (id: string, action: PersonalChatAction) => Promise<void>;
  readonly onPinnedOrder?: (order: readonly string[]) => Promise<void>;
  readonly focusChatId?: string;
  readonly focusMessageId?: string;
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
  readonly onPinMessage: (message: ChatMessage, pinned: boolean, scope?: "all" | "self") => Promise<void>;
  readonly onEditMessage: (message: ChatMessage, body: string, mentionUserIds: readonly string[], entities?: readonly MessageEntity[]) => Promise<void>;
  readonly onDeleteMessage: (message: ChatMessage) => Promise<void>;
  readonly onCreateTaskFromMessage: (
    message: ChatMessage,
    payload: WorkspaceTaskCreateInput,
  ) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onRequestTaskDeadline?: (
    task: WorkspaceTask, proposedDueAt: string, reason: string,
  ) => Promise<WorkspaceTask | undefined>;
  readonly onDecideTaskDeadline?: (
    task: WorkspaceTask, requestId: string, approved: boolean,
  ) => Promise<WorkspaceTask | undefined>;
  readonly onCreateCalendarEventFromChat?: (chat: ChatSummary) => void;
  readonly onDownloadAttachment: (
    attachment: WorkspaceAttachment,
  ) => void | Promise<void>;
  readonly onLoadAttachment: (attachment: WorkspaceAttachment) => Promise<Blob>;
  readonly onMarkRead: (chatId: string) => void | Promise<void>;
  readonly onOpenContext?: (contextType: "task" | "project" | "project_hub" | "trip", contextId: string) => void;
  readonly onOpenPersonProfile?: (userId: string) => void;
}

function MessageReactionChip({ reaction, people, token, disabled, onToggle, onOpenDetails }: {
  readonly reaction: MessageReaction;
  readonly people: readonly WorkspacePerson[];
  readonly token: string;
  readonly disabled: boolean;
  readonly onToggle: () => void;
  readonly onOpenDetails: (event: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => void;
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
      onKeyDown={(event) => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault(); event.stopPropagation(); onOpenDetails(event);
      }}
      onClick={onToggle}
    >
      <span className="message-reaction-emoji" aria-hidden="true"><ReactionEmoji emoji={reaction.emoji} /></span>
      {additionalReactors.length ? <span className="message-reaction-avatars" aria-hidden="true">
        {additionalReactors.map((person) => <ProfileAvatar key={person.id} person={person} token={token} size={20} />)}
      </span> : null}
    </Button>
  </span>;
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
  chatActions,
  onSendMessage,
  onForwardContent,
  onOpenFeedPost,
  onSendVoiceMessage,
  onReactMessage,
  onPinMessage,
  onEditMessage,
  onDeleteMessage,
  onCreateTaskFromMessage,
  onRequestTaskDeadline,
  onDecideTaskDeadline,
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
  assistantDraft,
  canUseAssistant = false,
  fileDropDisabledReason,
  focusMessageId,
}: Omit<MessengerViewProps, "chats" | "onMarkRead"> & {
  readonly chat: ChatSummary;
  readonly availableChats: readonly ChatSummary[];
  readonly onManage: () => void;
  readonly onBack: () => void;
  readonly embedded?: boolean;
  readonly fileDropDisabledReason?: string;
}) {
  const composerRevision = useRef(0);
  const [draft, setDraft, draftEntities, setDraftDocument] = useRichComposer(assistantDraft?.kind === "message" ? assistantDraft.fields.body ?? "" : "", composerRevision);
  const draftKey = `chat:${currentUserId}:${chat.id}`;
  const draftEdited = useRef(assistantDraft?.kind === "message");
  const draftReady = useRef(assistantDraft?.kind === "message");
  const [reply, setReply] = useComposerState<ReplyTarget | undefined>(undefined, composerRevision);
  const [mentions, setMentions] = useComposerState<readonly string[]>([], composerRevision);
  const [mentionPicker, setMentionPicker] = useState(false);
  const [mentionScope, setMentionScope] = useState<EmployeeScope>("central");
  const [pendingFiles, setPendingFiles] = useComposerState<readonly File[]>([], composerRevision);
  const [attachmentReviewOpen, setAttachmentReviewOpen] = useState(false);
  const [taskSource, setTaskSource] = useState<ChatMessage>();
  const [forwarding, setForwarding] = useState<readonly ChatMessage[]>();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const cancelSelection = useCallback(() => { setSelectionMode(false); setSelectedIds(new Set()); }, []);
  const toggleSelection = useCallback((id: string) => setSelectedIds(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  const [editing, setEditing] = useComposerState<ChatMessage | undefined>(undefined, composerRevision);
  const [editBody, setEditBody, editEntities, setEditDocument] = useRichComposer("", composerRevision);
  const [editMentions, setEditMentions] = useState<readonly string[]>([]);
  const [deleting, setDeleting] = useState<ChatMessage>();
  const deleteReturnFocus = useRef<HTMLElement | null>(null);
  const deleteDescriptionId = useId();
  const [removingMessage, setRemovingMessage] = useState<{ message: ChatMessage; index: number; height: number; phase: "ready" | "exiting" | "done" }>();
  const removalTimer = useRef<number | undefined>(undefined);
  const previousRows = useRef(new Map<string, { message: ChatMessage; index: number; height: number }>());
  const locallyRemovedIds = useRef(new Set<string>());
  const [contextMenu, setContextMenu] = useState<{ message: ChatMessage; x: number; y: number; portalContainer: HTMLElement; trigger?: HTMLButtonElement; selectedQuote?: MessageQuote }>();
  const [reactionQuick, setReactionQuick] = useState<ReactionDetailsTarget & { message: ChatMessage }>();
  const [reactionDialog, setReactionDialog] = useState<ChatMessage>();
  const [reactionPreview, setReactionPreview] = useState(false);
  const [reactionTargetId, setReactionTargetId] = useState<string>();
  const reactionHoverTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(reactionHoverTimer.current), []);
  const [chatBackground, setChatBackground] = useState(() => readChatBackground(currentUserId));
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [avatarDraft, setAvatarDraft] = useState<ChatAvatarIconKey>(chat.avatarIconKey ?? defaultChatIcon(chat));
  const [query, setQuery] = useState("");
  const compactBrowser = useBrowserCompactLayout(workspacePlatform.kind === "web", "(max-width: 800px)");
  const [searchOpen, setSearchOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [deadlineDate, setDeadlineDate] = useState("");
  const [deadlineReason, setDeadlineReason] = useState("");
  const [deadlineBusy, setDeadlineBusy] = useState(false);
  const [deadlineDecisionId, setDeadlineDecisionId] = useState<string>();
  const [deadlineError, setDeadlineError] = useState("");
  const [sendingText, setSendingText] = useState<{ id: number; text: string; entities: readonly MessageEntity[]; scrollLeft: number; scrollTop: number; height: number }>();
  const sendingSequence = useRef(0);
  const sendQueue = useRef<Promise<void>>(Promise.resolve());
  const submittedRevision = useRef(-1);
  const [pendingSendCount, setPendingSendCount] = useState(0);
  const [failedSends, setFailedSends] = useState<readonly OutgoingDraft[]>([]);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceVisible, setVoiceVisible] = useState(false);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [rewriteError, setRewriteError] = useState("");
  const [rewriteSuggestion, setRewriteSuggestion] = useState<{
    source: string; style: AssistantRewriteStyle; text: string;
  }>();
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLDivElement>(null);
  const rewriteRef = useRef<HTMLDivElement>(null);
  const wasEditing = useRef(false);
  const focusAfterSend = useRef(false);
  const restoreFocusTarget = useRestoreFocusTarget();
  const avatarRestoreFocusTarget = useRestoreFocusTarget();
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (deleting || busy || !deleteReturnFocus.current) return;
    const frame = requestAnimationFrame(() => {
      const target = deleteReturnFocus.current;
      deleteReturnFocus.current = null;
      (target?.isConnected ? target : composerInputRef.current)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [deleting, busy]);
  const followLatest = useRef(true);
  useEffect(() => {
    const bridge = workspacePlatform;
    let active = true;
    void bridge.loadDraft(draftKey).then((saved) => {
      if (active && saved !== null && (assistantDraft?.kind === "message" || !draftEdited.current)) {
        const decoded = decodeRichDraft(saved);
        if (assistantDraft?.kind === "message") setDraft(current => decoded.text.trim() ? `${decoded.text.trimEnd()}\n\n${current}` : current);
        else setDraftDocument(decoded.text, decoded.entities);
        void bridge.clearDraft(draftKey).catch(() => undefined);
      }
    }).catch(() => undefined).finally(() => { draftReady.current = true; });
    return () => { active = false; };
  }, [assistantDraft, draftKey, setDraft, setDraftDocument]);
  useEffect(() => {
    const bridge = workspacePlatform;
    if (!draftReady.current || !draftEdited.current) return;
    const save = () => {
      void (draft ? bridge.saveDraft(draftKey, encodeRichDraft(draft, draftEntities)) : bridge.clearDraft(draftKey))
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
  }, [draft, draftKey, draftEntities]);
  const canSend = chat.permissions.sendMessages;
  const fileDropBlocked = fileDropDisabledReason || (!canSend ? "В этом чате нельзя отправлять сообщения"
    : !chat.permissions.uploadFiles ? "Вложения запрещены владельцем группы"
    : busy ? "Дождитесь завершения текущего действия"
    : editing ? "Сначала завершите редактирование сообщения"
    : voiceOpen ? "Сначала завершите голосовое сообщение"
    : taskSource || forwarding || deleting || avatarPickerOpen || reactionDialog
      ? "Сначала закройте открытое окно чата" : undefined);
  const acceptFiles = useCallback((files: readonly File[]) => {
    if (fileDropBlocked || !files.length) return false;
    try { files.forEach(file => validateWorkspaceAttachmentFile(file)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось прикрепить файлы"); return false; }
    focusAfterSend.current = false;
    // Distinct files can share all metadata; never discard one on that basis.
    setPendingFiles(current => [...new Set([...current, ...files])]);
    setAttachmentReviewOpen(true);
    setError("");
    return true;
  }, [fileDropBlocked, setPendingFiles, setError]);
  const personById = useCallback((id: string) => people.find((person) => person.id === id), [people]);
  const personName = useCallback((id: string) => personById(id)?.name ?? "Сотрудник", [personById]);
  const activeMessages = useMemo(() => messages.filter(
    (message) => message.chatId === chat.id && !message.deletedAt,
  ), [messages, chat.id]);
  const visibleMessages = useMemo(() => activeMessages.filter(
    (message) => message.id === editing?.id || !query
      || message.body.toLowerCase().includes(query.toLowerCase()),
  ), [activeMessages, editing?.id, query]);
  const selectedMessages = activeMessages.filter(message => selectedIds.has(message.id) && !message.systemKind);
  const renderedMessages = useMemo(() => {
    const rows = visibleMessages.filter((message) => message.id !== removingMessage?.message.id);
    if (removingMessage && removingMessage.phase !== "done") {
      rows.splice(Math.min(removingMessage.index, rows.length), 0, removingMessage.message);
    }
    return rows;
  }, [visibleMessages, removingMessage]);
  const { arrivingIds, motionDisabled, cancelArrivalMotion } = useMessageArrivalMotion({
    paneRef: scrollRef, messages: renderedMessages, scope: `${chat.id}:${query}`,
    followLatest, currentUserId,
  });
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
    if (!canUseAssistant || !source.trim() || rewriteBusy) return;
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
    return (!departments || employeeScope(person?.departmentId, departments) === mentionScope)
      && (!mentionQuery || `${person?.name ?? ""} ${person?.username ?? ""}`.toLocaleLowerCase("ru").includes(mentionQuery));
  });
  const pinnedMessages = activeMessages.filter((message) => message.isPinned && !message.pinHiddenForMe && !message.deletedAt);
  const latestPinned = pinnedMessages.at(-1);
  const revealMessage = (messageId: string) => {
    setQuery("");
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };
  useEffect(() => {
    if (!focusMessageId) return;
    const frame = requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(focusMessageId)}"]`)?.scrollIntoView({ block: "center", behavior: "instant" }));
    return () => cancelAnimationFrame(frame);
  }, [focusMessageId]);
  useEffect(() => {
    if (editing) {
      const input = composerInputRef.current;
      input?.focus();
      if (input) setEditorSelection(input, input.textContent?.length ?? 0);
    } else if (wasEditing.current) {
      composerInputRef.current?.focus();
    }
    wasEditing.current = Boolean(editing);
  }, [editing]);
  useEffect(() => {
    if (!busy && focusAfterSend.current && !attachmentReviewOpen) {
      focusAfterSend.current = false;
      composerInputRef.current?.focus();
    }
  }, [busy, draft, pendingFiles, attachmentReviewOpen]);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => { setContextMenu(undefined); setReactionPreview(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || contextMenu.portalContainer.querySelector(".reaction-picker-context-popover")) return;
      event.preventDefault();
      event.stopPropagation();
      close();
      contextMenu.trigger?.focus({ preventScroll: true });
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); window.removeEventListener("keydown", escape, true); };
  }, [contextMenu]);
  const startEditing = (message: ChatMessage) => {
    if (busy || !canSend || message.authorId !== currentUserId || !message.canEdit || message.deletedAt) return;
    setSendingText(undefined);
    setEditing(message);
    setEditDocument(message.body, message.entities ?? EMPTY_ENTITIES);
    setEditMentions(message.mentionUserIds ?? []);
    setMentionPicker(false);
    setError("");
  };
  const run = useCallback(async (operation: () => Promise<void>) => {
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
  }, []);
  const requestMessageDelete = (message: ChatMessage, trigger?: HTMLButtonElement) => {
    if (busy) return;
    deleteReturnFocus.current = trigger ?? composerInputRef.current;
    deleteReturnFocus.current?.focus({ preventScroll: true });
    setDeleting(message);
    setContextMenu(undefined);
  };
  const send = () => {
    if (!canSend || busy || submittedRevision.current === composerRevision.current || (!draft.trim() && pendingFiles.length === 0)) return;
    const sentDocument = trimRichDocument(draft, draftEntities);
    const sentText = sentDocument.text;
    setAttachmentReviewOpen(false);
    const sentScrollLeft = composerInputRef.current?.scrollLeft ?? 0;
    const sentScrollTop = composerInputRef.current?.scrollTop ?? 0;
    const sentFiles = pendingFiles;
    const sentReply = reply;
    const sentMentions = mentions.filter((id) => activeMemberIds.has(id));
    sendingSequence.current += 1;
    const sendId = sendingSequence.current;
    if (sentText) {
      setSendingText({ id: sendingSequence.current, text: sentText, entities: sentDocument.entities, scrollLeft: sentScrollLeft, scrollTop: sentScrollTop, height: composerInputRef.current?.getBoundingClientRect().height ?? 0 });
    }
    // Snapshot and release the composer before any network work. Acknowledgements
    // must never clear text/files/reply belonging to the next message.
    setDraft(""); setPendingFiles([]); setReply(undefined); setMentions([]); setMentionPicker(false);
    draftEdited.current = true;
    void workspacePlatform.clearDraft(draftKey).catch(() => undefined);
    if (fileInputRef.current) fileInputRef.current.value = "";
    const revision = composerRevision.current;
    submittedRevision.current = revision;
    focusAfterSend.current = true;
    setError(""); setPendingSendCount((count) => count + 1);
    // Serialize explicit sends, not typing; no automatic retry after an uncertain response.
    sendQueue.current = sendQueue.current.then(async () => {
      try {
        const message = await onSendMessage(chat.id, sentText || "Файл", sentFiles, {
          replyToMessageId: sentReply?.id,
          replyQuote: sentReply?.selectedQuote,
          entities: sentDocument.entities,
          mentionUserIds: sentMentions,
        });
        if (!message)
          throw new Error(
            "Сообщение не отправлено. Текст сохранён — попробуйте снова.",
          );
      } catch (cause) {
        const failure = cause instanceof Error ? cause.message : "Не удалось отправить сообщение";
        if (composerRevision.current === revision) {
          setSendingText(undefined);
          setDraftDocument(sentText, sentDocument.entities);
          setPendingFiles(sentFiles); setReply(sentReply); setMentions(sentMentions);
          setError(failure);
        } else {
          setFailedSends((items) => [...items, { id: sendId, text: sentText, entities: sentDocument.entities, files: sentFiles, reply: sentReply, mentions: sentMentions, error: failure }]);
        }
      } finally {
        setPendingSendCount((count) => count - 1);
      }
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
        trimRichDocument(editBody, editEntities).entities,
      );
      setEditing(undefined);
      setEditBody("");
      setEditMentions([]);
      setMentionPicker(false);
    });
  };
  const taskForChat = chat.contextType === "task"
    ? tasks.find((task) => task.id === chat.contextId) : undefined;
  const currentExecutor = taskForChat?.assigneeId === currentUserId
    || taskForChat?.participants.some((person) => person.userId === currentUserId && person.role === "co_assignee");
  const canRequestDeadline = !!onRequestTaskDeadline && !!taskForChat?.dueAt
    && !!currentExecutor && taskForChat.authorId !== currentUserId
    && !["completed", "cancelled"].includes(taskForChat.status)
    && !taskForChat.deadlineRequests?.some((item) => item.status === "pending");
  const canDecideDeadline = taskForChat?.authorId === currentUserId
    || ["manager", "admin", "superadmin"].includes(currentUserRole);
  const requestDeadline = async () => {
    if (!taskForChat?.dueAt || !onRequestTaskDeadline || deadlineBusy) return;
    const proposed = new Date(deadlineDate);
    if (!Number.isFinite(proposed.getTime()) || proposed.getTime() <= Math.max(Date.now(), new Date(taskForChat.dueAt).getTime())) {
      setDeadlineError("Выберите дату и время позже текущего срока и настоящего момента.");
      return;
    }
    if (!deadlineReason.trim()) { setDeadlineError("Укажите причину переноса."); return; }
    setDeadlineError("");
    setDeadlineBusy(true);
    try {
      if (await onRequestTaskDeadline(taskForChat, proposed.toISOString(), deadlineReason.trim())) {
        setDeadlineOpen(false);
        setDeadlineReason("");
      }
    } finally {
      setDeadlineBusy(false);
    }
  };
  const decideDeadline = useCallback(async (requestId: string, approved: boolean) => {
    if (!taskForChat || !onDecideTaskDeadline || deadlineDecisionId) return;
    setDeadlineDecisionId(requestId);
    setDeadlineError("");
    try {
      await onDecideTaskDeadline(taskForChat, requestId, approved);
    } finally {
      setDeadlineDecisionId(undefined);
    }
  }, [taskForChat, onDecideTaskDeadline, deadlineDecisionId]);
  // Keep typing local: unchanged history must not rebuild rich message subtrees.
  const messageRows = useMemo(() => renderedMessages.map((message, index) => {
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
          const deadlineRequest = message.systemKind === "task_deadline_request"
            ? taskForChat?.deadlineRequests?.find((item) => item.messageId === message.id) : undefined;
          if (message.systemKind) return <div key={message.id} data-message-row-id={message.id}>
            {(index === 0 || date !== previousDate) && <div className="date-separator">{date}</div>}
            {deadlineRequest ? <div className="task-deadline-message" data-message-id={message.id} role="group" aria-label="Запрос переноса срока">
              <strong>Перенос срока · {deadlineRequest.status === "pending" ? "ожидает решения" : deadlineRequest.status === "approved" ? "подтверждён" : deadlineRequest.status === "rejected" ? "отклонён" : "неактуален"}</strong>
              <small>Запросил: {people.find((person) => person.id === deadlineRequest.requesterUserId)?.name ?? "Исполнитель"}</small>
              <p><MessageTextAnimate key={`${message.id}:${arrivingIds.has(message.id)}`} enabled={arrivingIds.has(message.id)} disabled={motionDisabled}>{message.body}</MessageTextAnimate></p>
              <div><span>Было: {new Date(deadlineRequest.oldDueAt).toLocaleString("ru-RU")}</span><span>Предложено: {new Date(deadlineRequest.proposedDueAt).toLocaleString("ru-RU")}</span></div>
              {deadlineRequest.status === "pending" && canDecideDeadline && onDecideTaskDeadline ? <div className="task-deadline-message-actions">
                <Button appearance="primary" disabled={!!deadlineDecisionId} onClick={() => void decideDeadline(deadlineRequest.id, true)}>Подтвердить перенос</Button>
                <Button appearance="secondary" disabled={!!deadlineDecisionId} onClick={() => void decideDeadline(deadlineRequest.id, false)}>Отклонить</Button>
              </div> : null}
              <time>{message.time}</time>
            </div> : <div className="message-system" data-message-id={message.id} role="note">
              <span><MessageTextAnimate key={`${message.id}:${arrivingIds.has(message.id)}`} enabled={arrivingIds.has(message.id)} disabled={motionDisabled}>{message.body}</MessageTextAnimate></span><time>{message.time}</time>
            </div>}
          </div>;
          const own = message.authorId === currentUserId;
          const groupedWithPrevious = !query && messagesShareBubbleGroup(renderedMessages[index - 1], message);
          const groupedWithNext = !query && messagesShareBubbleGroup(message, renderedMessages[index + 1]);
          const groupPosition = groupedWithPrevious
            ? groupedWithNext ? "is-group-middle" : "is-group-last"
            : groupedWithNext ? "is-group-first" : "";
          const messageAttachments = attachments.filter(
            (attachment) => attachment.ownerType === "message" && attachment.ownerId === message.id,
          );
          const voiceAttachments = messageAttachments.filter((attachment) => attachment.mediaKind === "voice");
          const mediaOnly = !!onLoadAttachment && !message.deletedAt && !message.forwarded && !message.zoomInvitation
            && messageAttachments.length > 0 && messageAttachments.every(attachment => fileViewerKind(attachment) === "image");
          const mediaCaption = mediaOnly && message.body.trim() !== "Файл" ? message.body : "";
          const documentOnly = !message.deletedAt && !message.forwarded && !message.zoomInvitation
            && messageAttachments.length > 0 && messageAttachments.every(attachment => attachment.mediaKind !== "voice"
              && !["image", "video", "audio"].includes(fileViewerKind(attachment)));
          const voiceOnly = !message.deletedAt && !message.zoomInvitation && message.forwarded?.kind !== "feed"
            && voiceAttachments.length > 0 && voiceAttachments.length === messageAttachments.length;
          const mentionFooter = !message.deletedAt && !!message.mentionUserIds?.length
            && !messageAttachments.length && !message.forwarded && !message.zoomInvitation;
          return (
            <div key={message.id} data-message-row-id={message.id} className={`message-row ${groupPosition}${removingMessage?.message.id === message.id ? ` is-removing is-${removingMessage.phase}` : ""}`} style={removingMessage?.message.id === message.id ? { height: removingMessage.phase === "exiting" ? 0 : removingMessage.height } : undefined}>
              {(index === 0 || date !== previousDate) && (
                <div className="date-separator">{date}</div>
              )}
              <div
                data-message-id={message.id}
                className={`message ${own ? "own" : ""} ${message.isPinned ? "message-pinned" : ""} ${message.mentionUserIds?.includes(currentUserId) ? "message-mentioned" : ""}${selectionMode ? " is-selecting" : ""}${selectionMode && selectedIds.has(message.id) ? " is-selected" : ""}`}
                onClickCapture={event => {
                  if (!selectionMode || (event.target as HTMLElement).closest(".message-select")) return;
                  event.preventDefault(); event.stopPropagation(); toggleSelection(message.id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  const textRoot = event.currentTarget.querySelector<HTMLElement>("[data-message-text]");
                  const selectedQuote = textRoot ? editorSelection(textRoot) : undefined;
                  setContextMenu({ message, selectedQuote, x: event.clientX, y: event.clientY, portalContainer: menuPortalContainerFor(event.currentTarget) });
                }}
                onKeyDown={(event) => {
                  if (selectionMode && event.key === "Escape") { event.preventDefault(); cancelSelection(); return; }
                  if (selectionMode && event.target === event.currentTarget && [" ", "Enter"].includes(event.key)) {
                    event.preventDefault(); toggleSelection(message.id); return;
                  }
                  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setContextMenu({ message, x: rect.left + 28, y: rect.top + 28, portalContainer: menuPortalContainerFor(event.currentTarget) });
                  }
                }}
                tabIndex={0}
                onPointerEnter={(event) => {
                  window.clearTimeout(reactionHoverTimer.current);
                  if (event.pointerType === "touch" || event.currentTarget.contains(document.activeElement)) return;
                  setReactionTargetId(undefined);
                  reactionHoverTimer.current = window.setTimeout(() => setReactionTargetId(message.id), 500);
                }}
                onPointerLeave={(event) => {
                  window.clearTimeout(reactionHoverTimer.current);
                  if (event.currentTarget.contains(document.activeElement)) return;
                  setReactionTargetId((current) => current === message.id ? undefined : current);
                }}
                onFocus={() => {
                  window.clearTimeout(reactionHoverTimer.current);
                  setReactionTargetId(message.id);
                }}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setReactionTargetId((current) => current === message.id ? undefined : current);
                }}
              >
                {selectionMode ? <input className="message-select" type="checkbox" checked={selectedIds.has(message.id)}
                  aria-label={`Выделить сообщение: ${message.body.slice(0, 80) || "Файл"}`} onChange={() => toggleSelection(message.id)} /> : null}
                {!own && (groupedWithNext ? <span className="message-avatar-spacer" aria-hidden="true" /> :
                  <EmployeeProfileLink className="message-sender-avatar" userId={message.authorId} personName={personName(message.authorId)}>
                    {personById(message.authorId) ? <ProfileAvatar person={personById(message.authorId)!} token={token} size={32} /> : <Avatar name={personName(message.authorId)} size={32} color="colorful" />}
                  </EmployeeProfileLink>
                )}
                <div className="message-content">
                  <div className={`message-body${message.forwarded || message.zoomInvitation || messageAttachments.length ? " has-rich-content" : ""}${messageAttachments.length ? " has-attachments" : ""}${mediaOnly ? ` is-media-message${mediaCaption || parent || message.mentionUserIds?.length ? " has-media-caption" : ""}` : ""}${documentOnly ? " is-document-message" : ""}${voiceOnly ? " is-voice-message" : ""}${message.zoomInvitation && !message.deletedAt ? " is-conference-message" : ""}`}>
                    {!own && (groupedWithPrevious
                      ? <span className="sr-only">Сообщение от {personName(message.authorId)}</span>
                      : <EmployeeProfileLink userId={message.authorId} personName={personName(message.authorId)}><strong>{personName(message.authorId)}</strong></EmployeeProfileLink>)}
                    {parent && (
                      <blockquote className="message-quote">
                        <EmployeeProfileLink userId={parent.authorId} personName={personName(parent.authorId)}><strong>{personName(parent.authorId)}</strong></EmployeeProfileLink>
                        <span>{message.replyQuote?.text ?? parent.body}</span>
                      </blockquote>
                    )}
                    {message.zoomInvitation && !message.deletedAt ? <ZoomInvitationCard messageId={message.id} invitation={message.zoomInvitation} people={people} token={token} />
                      : message.forwarded ? <ForwardedMessage message={message} voice={voiceOnly} onOpenPost={onOpenFeedPost} animateText={arrivingIds.has(message.id)} motionDisabled={motionDisabled} />
                      : voiceAttachments.length === 0 && !mediaOnly && !(messageAttachments.length && message.body.trim() === "Файл") ? <p className="message-text" data-message-text><MessageTextAnimate entities={message.entities} key={`${message.id}:${arrivingIds.has(message.id)}`} enabled={arrivingIds.has(message.id)} disabled={motionDisabled}>{message.body}</MessageTextAnimate></p> : null}
                    {!message.deletedAt && (
                      <>
                        {!!message.mentionUserIds?.length && !mentionFooter && (
                          <div className="message-mentions">
                            {message.mentionUserIds.map((id) => (
                              <EmployeeProfileLink key={id} userId={id} personName={personName(id)}>@{personName(id)}</EmployeeProfileLink>
                            ))}
                          </div>
                        )}
                        {voiceAttachments.map((attachment, voiceIndex) => (
                          <VoiceMessagePlayer key={attachment.id} attachment={attachment} onLoad={onLoadAttachment}
                            metadata={voiceOnly && voiceIndex === voiceAttachments.length - 1 ? <MessageMetadata message={message} own={own} /> : undefined} />
                        ))}
                        {message.body && !message.zoomInvitation && message.forwarded?.kind !== "feed" ? <MessageLinkPreviews body={message.body} token={token} /> : null}
                        <AttachmentChips
                          attachments={messageAttachments.filter((attachment) => attachment.mediaKind !== "voice")}
                          onDownload={onDownloadAttachment}
                          onLoad={onLoadAttachment}
                          presentation={mediaOnly ? "media" : undefined}
                          documentMetadata={documentOnly ? <MessageMetadata message={message} own={own} /> : undefined}
                        />
                        {mediaCaption ? <p className="message-text message-media-caption" data-message-text><RichMessageText text={mediaCaption} entities={message.entities} /></p> : null}
                      </>
                    )}
                    {mentionFooter ? <div className="message-mentions-footer">
                      <div className="message-mentions">{message.mentionUserIds?.map(id =>
                        <EmployeeProfileLink key={id} userId={id} personName={personName(id)}>@{personName(id)}</EmployeeProfileLink>)}</div>
                      <MessageMetadata message={message} own={own} />
                    </div> : !voiceOnly && !documentOnly ? <MessageMetadata message={message} own={own} /> : null}
                    {!message.deletedAt && (
                      <div className={`message-actions message-reaction-trigger ${reactionTargetId === message.id ? "is-visible" : ""}`} role="group" aria-label="Реакция на сообщение">
                        <ReactionPicker userId={currentUserId} disabled={!canSend || busy} ownMessage={own}
                          active={(message.reactions ?? []).filter((item) => item.reactedByCurrentUser).map((item) => item.emoji)}
                          onSelect={(emoji) => void run(() => onReactMessage(message, emoji))} />
                        <Button className="browser-message-menu" appearance="subtle" icon={<MoreHorizontal20Regular />}
                          aria-label="Действия сообщения" aria-haspopup="menu" onClick={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setContextMenu({ message, x: rect.left, y: rect.bottom, portalContainer: menuPortalContainerFor(event.currentTarget), trigger: event.currentTarget });
                          }} />
                      </div>
                    )}
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
                          onOpenDetails={(event) => {
                            setContextMenu(undefined);
                            const rect = event.currentTarget.getBoundingClientRect();
                            setReactionQuick({ message, emoji: reaction.emoji, x: "clientX" in event ? event.clientX : rect.left, y: "clientY" in event ? event.clientY : rect.bottom, anchor: event.currentTarget });
                          }}
                          onToggle={() => void run(() => onReactMessage(message, reaction.emoji))}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        }), [renderedMessages, activeMessages, taskForChat, people, canDecideDeadline, onDecideTaskDeadline, deadlineDecisionId, decideDeadline, arrivingIds, motionDisabled, currentUserId, query, attachments, onLoadAttachment, removingMessage, personName, personById, token, onOpenFeedPost, onDownloadAttachment, reactionTargetId, canSend, busy, run, onReactMessage, selectionMode, selectedIds, toggleSelection, cancelSelection]);
  return (
    <MessengerFileDropSurface className={`conversation-pane${embedded ? " embedded-conversation" : ""}`}
      title={chat.title} blockedReason={fileDropBlocked} receive={acceptFiles} reject={setError}>
      <header className="conversation-header">
        {!embedded ? <Button className="compact-back" appearance="subtle" icon={<ChevronLeft20Regular />} onClick={onBack}>К списку чатов</Button> : null}
        <div className="conversation-identity">
          {chat.canEditAvatar && chatActions.setAvatar ? <Dialog open={avatarPickerOpen}
            onOpenChange={(_, data) => { if (data.open) setAvatarDraft(chat.avatarIconKey ?? defaultChatIcon(chat)); setAvatarPickerOpen(data.open); }}>
            <DialogTrigger disableButtonEnhancement><button {...avatarRestoreFocusTarget} type="button" className="chat-avatar-edit-trigger" aria-label="Изменить иконку чата" title="Изменить иконку чата">
              <ChatAvatar chat={chat} currentUserId={currentUserId} people={people} token={token} size={56} />
            </button></DialogTrigger>
            <DialogSurface className="chat-avatar-picker" aria-label="Иконка чата"><DialogBody>
              <DialogTitle>Иконка чата</DialogTitle>
              <DialogContent>
              <ChatIconPicker value={avatarDraft} onChange={setAvatarDraft} disabled={busy} />
              <p>Иконку увидят все участники чата.</p>
              {error ? <WorkspaceNotice tone="error" className="messenger-error" role="alert">{error}</WorkspaceNotice> : null}
              </DialogContent>
              <DialogActions className="chat-dialog-actions">
                <Button onClick={() => setAvatarPickerOpen(false)}>Отмена</Button>
                <Button aria-disabled={busy} onClick={() => { if (!busy) void run(async () => { await chatActions.setAvatar!(chat.id, null); setAvatarPickerOpen(false); }); }}>По умолчанию</Button>
                <Button appearance="primary" aria-disabled={busy} onClick={() => { if (!busy) void run(async () => { await chatActions.setAvatar!(chat.id, avatarDraft); setAvatarPickerOpen(false); }); }}>{busy ? "Сохраняем…" : "Сохранить иконку"}</Button>
              </DialogActions>
            </DialogBody></DialogSurface>
          </Dialog> : <ChatAvatar chat={chat} currentUserId={currentUserId} people={people} token={token} size={56} />}
          <div>
          <h2>{chat.title}</h2>
          <p>
            {chat.kind === "direct"
              ? "Личный диалог"
              : `${chat.members.length} участников · ${chat.kind === "group" ? "Закрытая группа" : "Рабочий чат"}`}
          </p>
          </div>
        </div>
        <BrowserChatActions compact={compactBrowser}>
          {compactBrowser ? <Button appearance="subtle" icon={<Search24Regular />} onClick={() => { setSearchOpen((value) => !value); if (searchOpen) setQuery(""); }}>{searchOpen ? "Закрыть поиск" : "Поиск в переписке"}</Button> : null}
          {compactBrowser && latestPinned && !searchOpen ? <Button appearance="subtle" icon={<Pin24Regular />} onClick={() => setPinnedOpen((value) => !value)}>Закреплено: {pinnedMessages.length}</Button> : null}
          {canRequestDeadline ? <Button appearance="secondary" icon={<CalendarLtr24Regular />} aria-expanded={deadlineOpen} onClick={() => {
            if (!deadlineOpen && taskForChat?.dueAt) {
              const next = new Date(Math.max(Date.now(), new Date(taskForChat.dueAt).getTime()) + 24 * 60 * 60_000);
              setDeadlineDate(new Date(next.getTime() - next.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
              setDeadlineError("");
            }
            setDeadlineOpen((current) => !current);
          }}>Попросить перенос срока</Button> : null}
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
          {chat.contextId && (chat.contextType === "task" || chat.contextType === "project" || chat.contextType === "project_hub" || chat.contextType === "trip") ? <Button appearance="secondary" onClick={() => onOpenContext?.(chat.contextType as "task" | "project" | "project_hub" | "trip", chat.contextId!)}>
            {chat.contextType === "task" ? "Открыть задачу" : chat.contextType === "trip" ? "Открыть поездку" : "Открыть проект"}
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
        </BrowserChatActions>
      </header>
      {deadlineOpen && canRequestDeadline ? <div className="task-deadline-request-popover" role="region" aria-label="Запрос переноса срока">
        <strong>Новый срок задачи</strong>
        <p>Постановщик увидит запрос прямо в чате задачи.</p>
        <label>Дата и время<WorkspaceDateTimePicker ariaLabel="Запрашиваемый срок" value={deadlineDate} min={taskForChat?.dueAt ? new Date(new Date(taskForChat.dueAt).getTime() - new Date(taskForChat.dueAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : undefined} onChange={setDeadlineDate} /></label>
        <label>Причина<Textarea aria-label="Причина переноса срока" value={deadlineReason} onChange={(_, data) => setDeadlineReason(data.value)} placeholder="Что мешает завершить задачу в срок?" /></label>
        {deadlineError ? <span role="alert">{deadlineError}</span> : null}
        <div className="task-deadline-request-actions"><Button appearance="subtle" disabled={deadlineBusy} onClick={() => setDeadlineOpen(false)}>Отмена</Button><Button appearance="primary" disabled={deadlineBusy || !deadlineReason.trim()} onClick={() => void requestDeadline()}>{deadlineBusy ? "Отправляем…" : "Отправить запрос в чат"}</Button></div>
      </div> : null}
      {personalPreferences?.archivedChatIds.includes(chat.id) && <div className="chat-archive-banner">
        <span>Этот чат в вашем архиве</span>
        <Button size="small" appearance="subtle" disabled={busy || !onPersonalChat} onClick={() => void run(() => onPersonalChat!(chat.id, "unarchive"))}>Вернуть из архива</Button>
      </div>}
      <div className="conversation-search" hidden={compactBrowser && !searchOpen}>
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
              <div key={message.id} className="pinned-message-item">
                <button type="button" onClick={() => revealMessage(message.id)}><span>{personName(message.authorId)}</span><strong>{message.body.slice(0, 140)}</strong><time>{message.time}</time></button>
                {message.pinProtected ? <small>Закреп председателя · нельзя снять</small> : <div className="pinned-message-actions">
                  {message.canUnpinForSelf ? <Button size="small" appearance="subtle" disabled={busy} onClick={() => void run(() => onPinMessage(message, false, "self"))}>Снять для себя</Button> : null}
                  {(message.canUnpinForAll ?? message.canPin) ? <Button size="small" appearance="subtle" disabled={busy} onClick={() => void run(() => onPinMessage(message, false, "all"))}>Снять для всех</Button> : null}
                </div>}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {selectionMode ? <div className="message-selection-toolbar" role="region" aria-label="Выделенные сообщения"
        onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); cancelSelection(); } }}>
        <span role="status">Выбрано: {selectedMessages.length}</span>
        <Button appearance="primary" disabled={!selectedMessages.length} icon={<Forward size={20} />}
          onClick={() => setForwarding(selectedMessages)}>Переслать выбранные</Button>
        <Button onClick={cancelSelection}>Отменить выделение</Button>
      </div> : null}
      <div className="message-scroll" data-chat-background={chatBackground} aria-label="Переписка" aria-live="polite" ref={scrollRef}
        onWheel={cancelArrivalMotion} onPointerDown={cancelArrivalMotion}
        onScroll={(event) => { const pane = event.currentTarget; followLatest.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80; }}>
        {!renderedMessages.length && (
          <div className="empty-compact">
            {query
              ? "Сообщения не найдены"
              : "Начните разговор — отправьте первое сообщение"}
          </div>
        )}
        {messageRows}
      </div>
      {contextMenu ? (() => {
        const message = contextMenu.message;
        const own = message.authorId === currentUserId;
        const hasVoice = attachments.some((attachment) => attachment.ownerType === "message" && attachment.ownerId === message.id && attachment.mediaKind === "voice");
        const mayDelete = message.canDelete ?? (own || message.canPin || ["admin", "superadmin"].includes(currentUserRole));
        return <MessageContextMenu x={contextMenu.x} y={contextMenu.y} portalContainer={contextMenu.portalContainer} autoFocus={Boolean(contextMenu.trigger)} onPointerDown={(event) => event.stopPropagation()}
          accessory={<ReactionPicker key={message.id} variant="context" userId={currentUserId} disabled={!canSend || busy} active={(message.reactions ?? []).filter((reaction) => reaction.reactedByCurrentUser).map((reaction) => reaction.emoji)} onSelect={(emoji) => { void run(() => onReactMessage(message, emoji)); setContextMenu(undefined); }} />}>
          <Button disabled={!canSend || (contextMenu.selectedQuote?.text.length ?? 0) > 4096} title={(contextMenu.selectedQuote?.text.length ?? 0) > 4096 ? "Цитата — не более 4096 символов" : undefined} appearance="subtle" icon={<Reply size={20} />} onClick={() => { setReply({ ...message, selectedQuote: contextMenu.selectedQuote }); setContextMenu(undefined); composerInputRef.current?.focus(); }}>{contextMenu.selectedQuote ? "Ответить с цитатой" : "Ответить"}</Button>
          {message.canPin && !message.isPinned ? <Button appearance="subtle" icon={<Pin size={20} />} onClick={() => { void run(() => onPinMessage(message, true)); setContextMenu(undefined); }}>Закрепить</Button> : null}
          {message.isPinned && message.pinProtected ? <span className="message-context-note">Закреп председателя · нельзя снять</span> : null}
          {message.isPinned && !message.pinProtected && message.canUnpinForSelf ? <Button appearance="subtle" icon={<PinOff size={20} />} onClick={() => { void run(() => onPinMessage(message, false, "self")); setContextMenu(undefined); }}>Снять закреп для себя</Button> : null}
          {message.isPinned && !message.pinProtected && (message.canUnpinForAll ?? message.canPin) ? <Button appearance="subtle" icon={<PinOff size={20} />} onClick={() => { void run(() => onPinMessage(message, false, "all")); setContextMenu(undefined); }}>Снять закреп для всех</Button> : null}
          {message.body && !(message.forwarded?.kind === "feed" && !message.forwarded.available) ? <Button appearance="subtle" icon={<Copy size={20} />} onClick={() => {
            setContextMenu(undefined);
            void run(async () => {
              if (!navigator.clipboard?.writeText) throw new Error("Копирование недоступно. Выделите текст и нажмите Ctrl+C.");
              try { await navigator.clipboard.writeText(contextMenu.selectedQuote?.text ?? message.body); }
              catch { throw new Error("Не удалось скопировать. Выделите текст и нажмите Ctrl+C."); }
            });
          }}>{contextMenu.selectedQuote ? "Копировать выделенное" : "Копировать"}</Button> : null}
          {onForwardContent && <Button appearance="subtle" icon={<Forward size={20} />} onClick={() => { setForwarding([message]); setContextMenu(undefined); }}>Переслать</Button>}
          {onForwardContent && <Button appearance="subtle" icon={<CheckSquare size={20} />} onClick={() => {
            setSelectionMode(true); setSelectedIds(new Set([message.id])); setContextMenu(undefined); setReactionTargetId(undefined);
            window.requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLInputElement>(".message-select:checked")?.focus());
          }}>Выделить</Button>}
          <Button appearance="subtle" icon={<ListTodo size={20} />} onClick={() => { setTaskSource(message); setContextMenu(undefined); }}>В задачу</Button>
          {own && message.canEdit && !hasVoice ? <Button appearance="subtle" icon={<Pencil size={20} />} onClick={() => { startEditing(message); setContextMenu(undefined); }}>Изменить</Button> : null}
          {mayDelete ? <Button className="message-context-delete" appearance="subtle" icon={<Trash2 size={20} />} onClick={() => requestMessageDelete(message, contextMenu.trigger)}>Удалить</Button> : null}
          {message.reactions?.length ? <div className="message-context-reactions" onPointerEnter={() => setReactionPreview(true)} onPointerLeave={() => setReactionPreview(false)}>
            <Button appearance="subtle" icon={<Smile size={20} />} aria-haspopup="dialog" aria-expanded={reactionPreview} onFocus={() => setReactionPreview(true)} onClick={() => { setReactionDialog(message); setContextMenu(undefined); setReactionPreview(false); }}>Реакции · {message.reactions.reduce((total, reaction) => total + reaction.count, 0)}</Button>
            {reactionPreview ? <div className={`message-reaction-submenu ${contextMenu.x + 540 < window.innerWidth ? "is-right" : "is-left"}`} role="region" aria-label="Кто поставил реакции">
              <ReactionPeople reactions={message.reactions} people={people} token={token} onOpenPersonProfile={(id) => { setContextMenu(undefined); onOpenPersonProfile?.(id); }} />
            </div> : null}
          </div> : null}
        </MessageContextMenu>;
      })() : null}
      {reactionQuick ? <ReactionDetailsMenu target={reactionQuick} reactions={reactionQuick.message.reactions ?? []}
        people={people} token={token} onClose={() => setReactionQuick(undefined)} onOpenPersonProfile={onOpenPersonProfile} /> : null}
      {reactionDialog && <Dialog open onOpenChange={(_, data) => { if (!data.open) setReactionDialog(undefined); }}><DialogSurface className="message-reaction-dialog" aria-label="Реакции на сообщение">
        <DialogBody><DialogTitle>Реакции</DialogTitle><DialogContent>
          <div className="message-reaction-summary">{reactionDialog?.reactions?.map((reaction) => <span key={reaction.emoji} aria-label={`${reaction.emoji} ${reaction.count}`}><ReactionEmoji emoji={reaction.emoji} /> {reaction.count}</span>)}</div>
          <ReactionPeople reactions={reactionDialog?.reactions ?? []} people={people} token={token} onOpenPersonProfile={(id) => { setReactionDialog(undefined); onOpenPersonProfile?.(id); }} />
        </DialogContent></DialogBody>
      </DialogSurface></Dialog>}
      {error && !avatarPickerOpen && !(attachmentReviewOpen && pendingFiles.length) && (
        <WorkspaceNotice tone="error" className="messenger-error" role="alert">
          {error}
        </WorkspaceNotice>
      )}
      {deleting && (
        <WorkspaceDialog open onOpenChange={(_, data) => { if (!data.open && !busy) setDeleting(undefined); }}>
          <DialogSurface className="chat-delete-dialog"
            backdrop={{ className: "chat-delete-backdrop" }} aria-describedby={deleteDescriptionId}>
            <span className="chat-delete-icon" aria-hidden="true"><Trash2 size={24} strokeWidth={1.6} /></span>
            <DialogBody>
              <DialogTitle>Удалить это сообщение?</DialogTitle>
              <DialogContent id={deleteDescriptionId}>Сообщение исчезнет у всех участников чата. История изменений сохранится для аудита.</DialogContent>
              <DialogActions className="chat-delete-actions">
                <Button disabled={busy} appearance="subtle" onClick={() => setDeleting(undefined)}>Отмена</Button>
          <Button
            className="chat-delete-confirm"
            disabled={busy}
            appearance="primary"
            onClick={() => {
              if (busy) return;
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
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </WorkspaceDialog>
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
      {forwarding?.length && onForwardContent ? <ForwardDialog source={{ kind: "message", id: forwarding[0]!.id }}
        sources={forwarding.map(message => ({ kind: "message", id: message.id }))}
        preview={forwarding.length > 1 ? `Сообщений: ${forwarding.length}` : forwarding[0]!.body} chats={availableChats} excludeChatId={chat.id}
        onForward={onForwardContent} onForwarded={cancelSelection} onClose={() => setForwarding(undefined)} /> : null}
      {!canSend ? (
        <WorkspaceNotice tone="info" className="chat-read-only">
          Вам доступно только чтение. Право отправлять сообщения меняет владелец
          группы.
        </WorkspaceNotice>
      ) : (
        <>
          {pendingSendCount > 0 && <small className="composer-send-status" role="status">Отправляется: {pendingSendCount}</small>}
          {failedSends.length > 0 && <div className="composer-failed-sends">{failedSends.map((item) => <WorkspaceNotice key={item.id} tone="error" role="alert">
            <span>{item.error}<br />{item.text.slice(0, 160) || "Сообщение с вложениями"}{item.files.length ? ` · файлов: ${item.files.length}` : ""}</span>
            <Button size="small" disabled={busy || Boolean(editing) || Boolean(draft.trim()) || pendingFiles.length > 0 || Boolean(reply) || mentions.length > 0} onClick={() => {
              setDraftDocument(item.text, item.entities); setPendingFiles(item.files); setReply(item.reply); setMentions(item.mentions); setSendingText(undefined);
              draftEdited.current = true; focusAfterSend.current = true;
              setFailedSends((items) => items.filter((entry) => entry.id !== item.id));
            }}>Вернуть в поле</Button>
          </WorkspaceNotice>)}</div>}
          {reply && (
            <div className="composer-context">
              <div>
                <small>Ответ · <EmployeeProfileLink userId={reply.authorId} personName={personName(reply.authorId)}>{personName(reply.authorId)}</EmployeeProfileLink></small>
                <p>
                  {(reply.selectedQuote?.text ?? reply.body).slice(0, 200)}
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
              {departments ? <EmployeeScopeSwitch value={mentionScope} onChange={setMentionScope} label="Группа участников для упоминания" /> : null}
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
              allowMp4
              disabled={busy}
              onVisibilityChange={setVoiceVisible}
              onClose={() => { setVoiceOpen(false); setVoiceVisible(false); }}
              onSend={async (file, durationMs) => {
                const options: MessageOptions = {
                  replyToMessageId: reply?.id,
                  replyQuote: reply?.selectedQuote,
                  mentionUserIds: mentions.filter((id) => activeMemberIds.has(id)),
                };
                // Older Safari records AAC/MP4. Send it as an ordinary playable
                // audio attachment, never mislabel it as the server's WebM/Opus voice.
                const message = await sendMessengerRecording(file, durationMs,
                  audio => onSendMessage(chat.id, "Голосовая запись", [audio], options),
                  (voice, duration) => onSendVoiceMessage(chat.id, voice, duration, options));
                if (!message) return false;
                setReply(undefined);
                setMentions([]);
                setMentionPicker(false);
                return true;
              }}
            />
          ) : null}
          {(!voiceOpen || !voiceVisible) && <div className="composer" onKeyDownCapture={event => {
            if (voiceOpen && event.key === "Escape") {
              event.preventDefault(); event.stopPropagation();
              setVoiceOpen(false); setVoiceVisible(false);
            }
          }}>
            <input
              ref={fileInputRef}
              hidden
              type="file"
              multiple
              aria-label="Файлы сообщения"
              disabled={Boolean(fileDropBlocked)}
              onChange={(event) => { acceptFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }}
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
                className="composer-tool-button"
                disabled={busy || Boolean(editing) || !chat.permissions.uploadFiles}
                onClick={() => fileInputRef.current?.click()}
              />
            </Tooltip>
            <Tooltip content="Создать мероприятие с участниками этого чата" relationship="label">
              <Button
                appearance="subtle"
                icon={<CalendarLtr24Regular />}
                aria-label="Создать мероприятие из чата"
                className="composer-tool-button"
                disabled={busy}
                onClick={() => onCreateCalendarEventFromChat?.(chat)}
              />
            </Tooltip>
            <Button
              className="composer-tool-button composer-mention-button"
              appearance="subtle"
              aria-label="Упомянуть участника"
              aria-expanded={mentionPicker}
              disabled={busy}
              onClick={() => setMentionPicker(!mentionPicker)}
            >
              <span className="composer-mention-glyph" aria-hidden="true">@</span>
              {activeMentions.length ? <span className="composer-mention-count">{activeMentions.length}</span> : null}
            </Button>
            <Tooltip content={voiceOpen ? "Микрофон подключается. Escape — отменить" : busy ? "Дождитесь завершения действия" : editing ? "Завершите редактирование сообщения перед записью" : draft.trim() ? "Чтобы записать голосовое сообщение, отправьте или удалите набранный текст" : pendingFiles.length ? "Отправьте или удалите вложения перед записью" : "Записать голосовое сообщение"} relationship="description">
              <Button
                className="composer-tool-button composer-microphone"
                appearance="subtle"
                icon={<><Mic24Regular className="composer-microphone-icon" /><Dismiss24Regular className="composer-microphone-blocked-icon" /></>}
                aria-label="Записать голосовое сообщение"
                aria-disabled={voiceOpen || busy || Boolean(editing) || Boolean(draft.trim()) || pendingFiles.length > 0}
                onClick={() => { if (!voiceOpen && !busy && !editing && !draft.trim() && !pendingFiles.length) { setVoiceVisible(false); setVoiceOpen(true); } }}
              />
            </Tooltip>
            {canUseAssistant ? <div className="composer-rewrite-anchor" ref={rewriteRef}>
              <Tooltip content="Переформулировать черновик с ИИ" relationship="label">
                <Button className="composer-tool-button" appearance="subtle" icon={<WandSparkles size={19} />}
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
            </div> : null}
            <div className="composer-input">
              {!attachmentReviewOpen && <PendingMessageFiles files={pendingFiles} disabled={busy}
                onRemove={index => setPendingFiles(current => current.filter((_, fileIndex) => fileIndex !== index))} />}
              <div className={`composer-field-shell${sendingText && !motionDisabled ? " is-message-animating" : ""}`}>
                <RichMessageEditor
                  ref={composerInputRef}
                  style={sendingText && !motionDisabled && sendingText.height > 0 ? { minHeight: sendingText.height } : undefined}
                  aria-label={editing ? "Редактирование сообщения" : "Новое сообщение"}
                  placeholder={editing ? "Измените сообщение" : "Напишите сообщение · @ упомянуть"}
                  value={editing ? editBody : draft}
                  entities={editing ? editEntities : draftEntities}
                  disabled={busy}
                  onChange={(value, entities) => {
                    if (voiceOpen) { setVoiceOpen(false); setVoiceVisible(false); }
                    setSendingText(undefined);
                    if (editing) {
                      setEditDocument(value, entities);
                      setMentionPicker(/(?:^|\s)@[^\s@]*$/u.test(value));
                      return;
                    }
                    draftEdited.current = true;
                    setDraftDocument(value, entities);
                    setMentionPicker(/(?:^|\s)@[^\s@]*$/u.test(value));
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
                    !event.ctrlKey && !event.altKey && !event.metaKey &&
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
                {sendingText ? <ComposerSendTransition key={sendingText.id} inputRef={composerInputRef}
                  text={sendingText.text} entities={sendingText.entities} scrollLeft={sendingText.scrollLeft} disabled={motionDisabled}
                  scrollTop={sendingText.scrollTop}
                  onComplete={() => setSendingText(current => current?.id === sendingText.id ? undefined : current)} /> : null}
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
      {attachmentReviewOpen && pendingFiles.length > 0 && <MessageAttachmentsDialog files={pendingFiles} caption={draft}
        onFiles={acceptFiles} errorMessage={error}
        blockedReason={fileDropBlocked} onCaption={value => { draftEdited.current = true; setDraft(value); }}
        onRemove={index => setPendingFiles(current => current.filter((_, fileIndex) => fileIndex !== index))}
        onAdd={() => fileInputRef.current?.click()} onSend={send} onClose={() => setAttachmentReviewOpen(false)} />}
    </MessengerFileDropSurface>
  );
}

export function EmbeddedConversation(props: MessengerViewProps & {
  readonly chatId: string;
  readonly contextLabel?: "задачи" | "проекта" | "поездки";
}) {
  useMessengerFileNavigationGuard();
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
  useMessengerFileNavigationGuard();
  const listPaneRef = useRef<HTMLElement>(null);
  const { chats, messages, focusChatId, onMarkRead } = props;
  const undo = useUndoActions();
  const [deletionChoice, setDeletionChoice] = useState<ChatSummary>();
  const [deletionChoiceOpen, setDeletionChoiceOpen] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<ChatSummary>();
  const visibleChats = chats.filter((chat) => !undo.pending.some(item => item.scope === "chat" && item.id === chat.id));
  const preferences = props.personalPreferences ?? defaultPersonalPreferences;
  const firstActive = visibleChats.find((chat) => chat.id === preferences.pinnedChatIds[0]) ?? visibleChats.find((chat) => !preferences.archivedChatIds.includes(chat.id));
  const [activeChatId, setActiveChatId] = useState(
    focusChatId ?? firstActive?.id ?? "",
  );
  const [listRevision, setListRevision] = useState(0);
  const [panel, setPanel] = useState<"create" | "manage">();
  const [conversationOpen, setConversationOpen] = useState(Boolean(focusChatId));
  const [assistantChat, setAssistantChat] = useState<ChatSummary>();
  const [assistantChatBusy, setAssistantChatBusy] = useState(false);
  const [assistantChatError, setAssistantChatError] = useState("");
  const [assistantPreparationDismissed, setAssistantPreparationDismissed] = useState(false);
  const activeChat = visibleChats.find((chat) => chat.id === activeChatId)
    ?? (assistantChat?.id === activeChatId ? assistantChat : undefined) ?? firstActive;
  const assistantRecipient = props.assistantDraft?.kind === "message" && props.assistantRecipientId
    ? props.people.find((person) => person.id === props.assistantRecipientId) : undefined;
  const pendingAssistantChat = assistantRecipient && !assistantChat && !assistantPreparationDismissed
    && !visibleChats.some((chat) => chat.kind === "direct"
      && chat.members.some((member) => member.userId === assistantRecipient.id));
  const openAssistantChat = async () => {
    if (!assistantRecipient || assistantChatBusy) return;
    setAssistantChatBusy(true);
    setAssistantChatError("");
    try {
      const chat = await props.chatActions.create({
        kind: "direct", title: "", description: "", memberIds: [assistantRecipient.id],
      });
      if (!chat.permissions.sendMessages) {
        setAssistantChatError("Диалог открыт, но отправка сообщений в нём недоступна.");
        return;
      }
      setAssistantChat(chat);
      setActiveChatId(chat.id);
      setConversationOpen(true);
      setListRevision((revision) => revision + 1);
    } catch (cause) {
      setAssistantChatError(cause instanceof Error ? cause.message : "Не удалось открыть диалог.");
    } finally {
      setAssistantChatBusy(false);
    }
  };
  const requestChatDeletion = (chat: ChatSummary) => {
    if (chat.contextType || (chat.kind !== "direct" && chat.kind !== "group")) return;
    setPanel(undefined);
    if (chat.kind === "direct") { setDeletionChoice(chat); setDeletionChoiceOpen(true); }
    else if (chat.canDelete) queueChatRemoval(chat, "both");
  };
  const queueChatRemoval = (chat: ChatSummary, mode: "self" | "both" | "leave") => {
    const commit = mode === "self" ? props.chatActions.dismiss
      ? () => props.chatActions.dismiss!(chat.id) : undefined
      : mode === "leave" ? () => props.chatActions.remove(chat.id, props.currentUserId)
      : () => props.chatActions.delete(chat.id);
    if (!commit) return;
    undo.enqueue({ id: chat.id, scope: "chat", label: mode === "leave" ? "Выход из группы" : mode === "self" ? "Чат удалён у вас" : chat.kind === "direct" ? "Чат удалён у обоих" : "Группа удалена", commit });
    setDeletionChoiceOpen(false);
    setPendingLeave(undefined);
    if (activeChat?.id === chat.id) setConversationOpen(false);
  };
  const openDirectChat = async (person: WorkspacePerson) => {
    const chat = await props.chatActions.create({
      kind: "direct",
      title: "",
      description: "",
      memberIds: [person.id],
    });
    setActiveChatId(chat.id);
    setAssistantPreparationDismissed(true);
    setConversationOpen(true);
    setPanel(undefined);
    setListRevision((revision) => revision + 1);
  };
  useEffect(() => {
    if (activeChat?.unread) void onMarkRead(activeChat.id);
  }, [activeChat?.id, activeChat?.unread, onMarkRead]);
  return (
    <section className={`workspace-view messenger-view ${(conversationOpen && activeChat) || pendingAssistantChat ? "conversation-open" : ""}`} aria-label="Мессенджер">
      <aside className="list-pane" ref={listPaneRef}>
          <OrganizedChatList key={listRevision} token={props.token} chats={visibleChats} messages={messages} people={props.people} departments={props.departments} currentUserId={props.currentUserId} activeChatId={activeChat?.id} focusChatId={focusChatId}
          preferences={preferences} onChange={props.onPersonalChat} onReorder={props.onPinnedOrder}
          onCreateGroup={() => setPanel("create")}
          onDelete={requestChatDeletion} onLeave={setPendingLeave} onOpenDirect={openDirectChat}
          onSelect={(id) => { setActiveChatId(id); setAssistantPreparationDismissed(true); setConversationOpen(true); setPanel(undefined); }} />
      </aside>
      {pendingAssistantChat ? (
        <div className="conversation-pane assistant-message-prepare" role="region" aria-label="Подготовка сообщения">
          <span className="view-kicker">ЧЕРНОВИК ОТ ИИ-АССИСТЕНТА</span>
          <h2>Сообщение для {assistantRecipient.name}</h2>
          <p>Проверьте получателя и текст. При открытии диалога сообщение останется черновиком — отправить его сможете только вы.</p>
          <blockquote>{props.assistantDraft?.fields.body}</blockquote>
          {assistantChatError ? <WorkspaceNotice tone="error" role="alert" className="messenger-error">{assistantChatError}</WorkspaceNotice> : null}
          <div className="assistant-message-prepare-actions">
            <Button appearance="primary" disabled={assistantChatBusy} onClick={() => void openAssistantChat()}>
              {assistantChatBusy ? "Открываем…" : "Открыть диалог с черновиком"}
            </Button>
            <Button disabled={assistantChatBusy} onClick={() => setAssistantPreparationDismissed(true)}>Отмена</Button>
          </div>
        </div>
      ) : activeChat ? (
        <Conversation
          key={`${props.currentUserId}:${activeChat.id}`}
          {...props}
          assistantDraft={assistantRecipient && activeChat.kind === "direct"
            && activeChat.members.some((member) => member.userId === assistantRecipient.id)
            ? props.assistantDraft : undefined}
          chat={activeChat}
          availableChats={visibleChats}
          onManage={() => setPanel("manage")}
          onBack={() => {
            setConversationOpen(false);
            const row = Array.from(listPaneRef.current?.querySelectorAll<HTMLElement>("[data-chat-id]") ?? [])
              .find((item) => item.dataset.chatId === activeChat.id)?.querySelector<HTMLButtonElement>(".chat-row");
            // The list is revealed in this commit; retain keyboard context without remounting the draft.
            requestAnimationFrame(() => row?.isConnected && row.focus({ preventScroll: true }));
          }}
          fileDropDisabledReason={panel || deletionChoiceOpen || pendingLeave ? "Сначала закройте окно управления чатом" : undefined}
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
          departments={props.departments}
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
        onCancel={() => setPendingLeave(undefined)}
        onConfirm={() => { if (pendingLeave) queueChatRemoval(pendingLeave, "leave"); }}
      />
      <WorkspaceDialog open={deletionChoiceOpen} onOpenChange={(_, data) => { if (!data.open) setDeletionChoiceOpen(false); }}>
        <DialogSurface className="chat-deletion-choice">
          <span className="chat-deletion-mark" aria-hidden="true"><Trash2 size={24} strokeWidth={1.6} /></span>
          <DialogBody>
            <DialogTitle>Удалить личный чат?</DialogTitle>
            <DialogContent>
              <p>Выберите, что сделать с диалогом «{deletionChoice?.title}».</p>
              <div className="chat-deletion-options">
                <Button className="chat-deletion-self" disabled={!props.chatActions.dismiss || !deletionChoice} onClick={() => { if (deletionChoiceOpen && deletionChoice) queueChatRemoval(deletionChoice, "self"); }}>
                  <span className="chat-deletion-option-icon" aria-hidden="true"><UserRound size={22} strokeWidth={1.6} /></span>
                  <span><strong>Удалить у меня</strong><small>У собеседника переписка останется. Новый диалог с ним вернёт вашу историю.</small></span>
                </Button>
                <Button className="chat-deletion-both" disabled={!deletionChoice?.canDelete} onClick={() => { if (deletionChoiceOpen && deletionChoice?.canDelete) queueChatRemoval(deletionChoice, "both"); }}>
                  <span className="chat-deletion-option-icon" aria-hidden="true"><UsersRound size={22} strokeWidth={1.6} /></span>
                  <span><strong>Удалить у обоих</strong><small>{deletionChoice?.canDelete ? "Диалог исчезнет у обоих участников. Историю нельзя будет вернуть после сохранения." : "Удаление для обоих недоступно в этом диалоге."}</small></span>
                </Button>
              </div>
              <p className="chat-deletion-note">После выбора у вас будет 5 секунд на отмену.</p>
            </DialogContent>
            <DialogActions className="chat-deletion-actions"><Button appearance="subtle" onClick={() => setDeletionChoiceOpen(false)}>Отмена</Button></DialogActions>
          </DialogBody>
        </DialogSurface>
      </WorkspaceDialog>
      {!undo.isShared ? <UndoActionsToast manager={undo} /> : null}
    </section>
  );
}
