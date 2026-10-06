import { SpatialSort, SpatialSortItem } from "./SpatialSort";
import { useEffect, useMemo, useRef, useState, type ReactNode, type TransitionEvent } from "react";
import type { ChatMessage, ChatSummary, PersonalChatAction, PersonalPreferences, WorkspaceDepartment, WorkspacePerson } from "@yuksalish/contracts";
import { Avatar, Badge, Input, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from "@fluentui/react-components";
import { Airplane20Regular, Archive20Regular, ArrowDown20Regular, ArrowUp20Regular, Delete20Regular, Folder20Regular, MoreHorizontal20Regular, Pin16Filled, Pin20Regular, PinOff20Regular, Search24Regular, SignOut20Regular, TaskListSquareLtr24Regular } from "@fluentui/react-icons";
import { moveBefore } from "./personal-organization";
import { ProfileAvatar } from "./ProfileAvatar";
import { EmployeeScopeSwitch } from "./EmployeeScopeSwitch";
import { employeeScope, type EmployeeScope } from "./employee-scope";
import { ChatIcon, defaultChatIcon } from "./ChatAvatar";
import { SwipeRow } from "./SwipeRow";

type ChatBucket = "chats" | "task-chats" | "project-chats" | "trip-chats" | "archive";

const isTaskChat = (chat: ChatSummary): boolean => chat.kind === "task";
const isProjectChat = (chat: ChatSummary): boolean => chat.contextType === "project" || chat.contextType === "project_hub";
const isTripChat = (chat: ChatSummary): boolean => chat.contextType === "trip";
const isContextChat = (chat: ChatSummary): boolean => isProjectChat(chat) || isTripChat(chat);

const bucketLabel = (bucket: ChatBucket): string => bucket === "chats" ? "Чаты" : bucket === "task-chats" ? "Чаты задач" : bucket === "project-chats" ? "Чаты проектов" : bucket === "trip-chats" ? "Чаты поездок" : "Архив";

const bucketEmptyMessage = (bucket: ChatBucket): string => bucket === "archive" ? "Архив пуст" : bucket === "task-chats" ? "Чатов задач не найдено" : bucket === "project-chats" ? "Чатов проектов не найдено" : bucket === "trip-chats" ? "Чатов поездок не найдено" : "Все чаты в архиве";

export function OrganizedChatList({ token, chats, messages, people = [], departments, currentUserId, activeChatId, focusChatId, preferences, onSelect, onOpenDirect, onChange, onReorder, onDelete, onLeave }: {
  readonly token?: string;
  readonly chats: readonly ChatSummary[];
  readonly messages: readonly ChatMessage[];
  readonly people?: readonly WorkspacePerson[];
  readonly departments?: readonly WorkspaceDepartment[];
  readonly currentUserId?: string;
  readonly activeChatId?: string;
  readonly focusChatId?: string;
  readonly preferences: PersonalPreferences;
  readonly onSelect: (id: string) => void;
  readonly onOpenDirect?: (person: WorkspacePerson) => Promise<void>;
  readonly onChange?: (id: string, action: PersonalChatAction) => Promise<void>;
  readonly onReorder?: (order: readonly string[]) => Promise<void>;
  readonly onDelete?: (chat: ChatSummary) => void;
  readonly onLeave?: (chat: ChatSummary) => void;
}) {
  const initialBucket: ChatBucket = focusChatId && preferences.archivedChatIds.includes(focusChatId)
    ? "archive"
    : "chats";
  const [query, setQuery] = useState("");
  const [peopleScope, setPeopleScope] = useState<EmployeeScope>("central");
  const [busy, setBusy] = useState(false);
  const [pendingPinnedOrder, setPendingPinnedOrder] = useState<{ order: string[]; revision: number } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [bucket, setBucket] = useState<ChatBucket>(initialBucket);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [morePreviewActive, setMorePreviewActive] = useState(false);
  const moreOpenPending = useRef(false);
  const moreOpenFallback = useRef<number | undefined>(undefined);
  const archive = bucket === "archive";
  const hasServerOrder = pendingPinnedOrder !== null && (preferences.revision > pendingPinnedOrder.revision ||
    preferences.pinnedChatIds.length === pendingPinnedOrder.order.length &&
    preferences.pinnedChatIds.every((id, index) => id === pendingPinnedOrder.order[index]));
  const pinnedOrder = pendingPinnedOrder && !hasServerOrder ? pendingPinnedOrder.order : preferences.pinnedChatIds;
  const pinnedIds = pinnedOrder.filter((id) => chats.some((chat) => chat.id === id) && !preferences.archivedChatIds.includes(id));
  const archivedChats = chats.filter((chat) => preferences.archivedChatIds.includes(chat.id));
  const regularChats = chats.filter((chat) => !isTaskChat(chat) && !isContextChat(chat) && !preferences.archivedChatIds.includes(chat.id));
  const directPeerIds = new Set(chats.filter((chat) => chat.kind === "direct").flatMap((chat) => chat.members.map((member) => member.userId).filter((id) => id !== currentUserId)));
  const availablePeople = people.filter((person) => person.id !== currentUserId && (person.status === undefined || person.status === "active") && !directPeerIds.has(person.id));
  const scopedPeople = availablePeople.filter((person) => !departments || employeeScope(person.departmentId, departments) === peopleScope);
  const taskChats = chats.filter((chat) => isTaskChat(chat) && !preferences.archivedChatIds.includes(chat.id));
  const projectChats = chats.filter((chat) => isProjectChat(chat) && !preferences.archivedChatIds.includes(chat.id));
  const tripChats = chats.filter((chat) => isTripChat(chat) && !preferences.archivedChatIds.includes(chat.id));
  const archivedRegularChats = chats.filter((chat) => !isTaskChat(chat) && preferences.archivedChatIds.includes(chat.id));
  const archivedTaskChats = chats.filter((chat) => isTaskChat(chat) && preferences.archivedChatIds.includes(chat.id));
  const visibleChats = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matching = new Set(messages.filter((message) => !message.deletedAt && message.body.toLowerCase().includes(normalized)).map((message) => message.chatId));
    const base = bucket === "archive" ? [...archivedRegularChats, ...archivedTaskChats] : bucket === "task-chats" ? taskChats : bucket === "project-chats" ? projectChats : bucket === "trip-chats" ? tripChats : regularChats;
    const selected = base.filter((chat) => !normalized || chat.title.toLowerCase().includes(normalized) || matching.has(chat.id));
    if (archive) return selected;
    const positions = new Map(pinnedOrder.map((id, index) => [id, index]));
    const sourcePositions = new Map(chats.map((chat, index) => [chat.id, index]));
    const activity = new Map<string, number>();
    messages.forEach((message, index) => {
      const parsed = message.createdAt ? Date.parse(message.createdAt) : Number.NaN;
      activity.set(message.chatId, Math.max(activity.get(message.chatId) ?? -1, Number.isNaN(parsed) ? index : parsed));
    });
    return [...selected].sort((a, b) => {
      const aPin = positions.get(a.id);
      const bPin = positions.get(b.id);
      if (aPin !== undefined || bPin !== undefined) {
        if (aPin === undefined) return 1;
        if (bPin === undefined) return -1;
        return aPin - bPin;
      }
      const activityDifference = (activity.get(b.id) ?? -1) - (activity.get(a.id) ?? -1);
      return activityDifference || (sourcePositions.get(a.id) ?? 0) - (sourcePositions.get(b.id) ?? 0);
    });
  }, [archive, bucket, archivedRegularChats, archivedTaskChats, regularChats, taskChats, projectChats, tripChats, chats, messages, pinnedOrder, query]);
  const normalizedQuery = query.trim().toLowerCase();
  const visiblePeople = bucket === "chats" && !archive
    ? scopedPeople.filter((person) => !normalizedQuery || `${person.name} ${person.username ?? ""} ${person.jobTitle ?? ""}`.toLowerCase().includes(normalizedQuery)).sort((a, b) => a.name.localeCompare(b.name, "ru"))
    : [];
  const hasPins = !archive && visibleChats.some((chat) => pinnedIds.includes(chat.id));
  const emptyMessage = bucket === "chats" && query.trim() ? "Чаты не найдены" : bucket === "task-chats" && query.trim() ? "Чаты задач не найдены" : bucket === "archive" && query.trim() ? "В архиве чатов не найдено" : bucketEmptyMessage(bucket);
  const run = async (operation: () => Promise<void>, message: string) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await operation(); setNotice(message); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить настройки чатов"); }
    finally { setBusy(false); }
  };
  const move = (source: string, target: string) => {
    if (!onReorder || busy || query.trim() || source === target || !pinnedIds.includes(source) || !pinnedIds.includes(target)) return;
    const order = moveBefore(pinnedIds, source, target);
    // Keep the dropped row in its new slot while the server confirms the order.
    setPendingPinnedOrder({ order, revision: preferences.revision });
    void run(async () => {
      try { await onReorder(order); }
      catch (cause) { setPendingPinnedOrder(null); throw cause; }
    }, "Порядок закреплённых чатов сохранён");
  };
  useEffect(() => () => window.clearTimeout(moreOpenFallback.current), []);
  const finishMoreOpen = () => {
    if (!moreOpenPending.current) return;
    moreOpenPending.current = false;
    window.clearTimeout(moreOpenFallback.current);
    moreOpenFallback.current = undefined;
    setMoreMenuOpen(true);
  };
  const closeMoreMenu = () => {
    moreOpenPending.current = false;
    window.clearTimeout(moreOpenFallback.current);
    moreOpenFallback.current = undefined;
    setMoreMenuOpen(false);
    setMorePreviewActive(false);
  };
  const requestMoreMenu = () => {
    if (moreMenuOpen || moreOpenPending.current) return;
    setMorePreviewActive(true);
    const alreadyAtMore = bucket === "project-chats" || bucket === "trip-chats";
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (alreadyAtMore || reduceMotion) {
      setMoreMenuOpen(true);
      return;
    }
    moreOpenPending.current = true;
    moreOpenFallback.current = window.setTimeout(finishMoreOpen, 220);
  };
  const selectBucket = (nextBucket: ChatBucket) => {
    closeMoreMenu();
    setBucket(nextBucket);
  };
  return <>
    <Input aria-label="Поиск чатов и сообщений" className="pane-search" contentBefore={<Search24Regular />}
      placeholder={archive ? "Поиск в архиве" : "Поиск по чатам и сообщениям"} value={query} onChange={(_, data) => setQuery(data.value)} />
    <div className={`chat-buckets is-${bucket}${morePreviewActive || bucket === "project-chats" || bucket === "trip-chats" ? " is-more" : ""}`} role="group" aria-label="Папки чатов">
      <span className="chat-bucket-slider" aria-hidden="true" onTransitionEnd={(event: TransitionEvent<HTMLSpanElement>) => {
        if (event.target !== event.currentTarget) return;
        if (event.propertyName && event.propertyName !== "transform") return;
        finishMoreOpen();
      }} />
      <button type="button" aria-pressed={bucket === "chats" && !morePreviewActive} onClick={() => selectBucket("chats")}>
        <span className="chat-bucket-label">Чаты</span><span>{regularChats.length + scopedPeople.length}</span>
      </button>
      <button type="button" aria-pressed={bucket === "task-chats" && !morePreviewActive} onClick={() => selectBucket("task-chats")}>
        <TaskListSquareLtr24Regular /><span className="chat-bucket-label">Чаты задач</span><span>{taskChats.length}</span>
      </button>
      <button type="button" aria-pressed={bucket === "archive" && !morePreviewActive} onClick={() => selectBucket("archive")}><Archive20Regular /><span className="chat-bucket-label">Архив</span><span>{archivedRegularChats.length + archivedTaskChats.length}</span>
        {archivedChats.some((chat) => chat.unread > 0) && <i aria-label="В архиве есть непрочитанные сообщения" />}</button>
      <Menu open={moreMenuOpen} onOpenChange={(_event, data) => {
        if (data.open) requestMoreMenu();
        else closeMoreMenu();
      }}>
        <MenuTrigger disableButtonEnhancement><button type="button" className="chat-more-bucket" aria-pressed={morePreviewActive || bucket === "project-chats" || bucket === "trip-chats"}>
          <MoreHorizontal20Regular /><span className="chat-bucket-label">Ещё</span><span>{projectChats.length + tripChats.length}</span>
        </button></MenuTrigger>
        <MenuPopover><MenuList>
          <MenuItem icon={<Folder20Regular />} onClick={() => selectBucket("project-chats")}>Чаты проектов <span>{projectChats.length}</span></MenuItem>
          <MenuItem icon={<Airplane20Regular />} onClick={() => selectBucket("trip-chats")}>Чаты поездок <span>{tripChats.length}</span></MenuItem>
        </MenuList></MenuPopover>
      </Menu>
    </div>
    {archive && <p className="chat-organization-hint">Архив только для вас. Переписка и уведомления сохраняются.</p>}
    {error && <div className="organization-error" role="alert">{error}</div>}
    <span className="organization-live" role="status">{busy ? "Сохраняем настройки чатов…" : notice}</span>
    {bucket === "chats" && departments ? <EmployeeScopeSwitch value={peopleScope} onChange={setPeopleScope} label="Контакты" /> : null}
    <SpatialSort ids={visibleChats.map(chat => chat.id)} onMove={move} verticalIntent>
    <div className="chat-list" role="list" aria-label={bucketLabel(bucket)} aria-busy={busy}>
      {visibleChats.flatMap((chat, index): ReactNode[] => {
        const pinned = !archive && pinnedIds.includes(chat.id);
        const pinIndex = pinnedIds.indexOf(chat.id);
        const peer = chat.kind === "direct"
          ? people.find((person) => chat.members.some((member) => member.userId === person.id && person.id !== currentUserId))
          : undefined;
        const userManaged = !chat.contextType && (chat.kind === "direct" || chat.kind === "group");
        const currentMembership = chat.members.find((member) => member.userId === currentUserId);
        const managedLeave = ["project", "project_hub", "trip"].includes(chat.contextType ?? "");
        const canLeave = managedLeave ? chat.canLeave === true : userManaged && chat.kind === "group" && (chat.canLeave ?? (Boolean(currentMembership) && !(currentMembership?.role === "owner" && chat.members.length < 2)));
        const canSwipe = chat.kind === "direct" && !chat.contextType ? Boolean(onDelete) : canLeave && Boolean(onLeave);
        const startGroup = hasPins && (index === 0 || (pinnedIds.includes(visibleChats[index - 1]!.id) && !pinned));
        const groupLabel = bucket === "task-chats" ? (pinned ? "Закреплённые чаты задач" : "Остальные чаты задач") : bucket === "project-chats" ? "Чаты проектов" : bucket === "trip-chats" ? "Чаты поездок" : (pinned ? "Закреплённые" : "Остальные чаты");
        return [
          startGroup ? <div key={`group:${groupLabel}`} className="chat-group-label">{groupLabel}</div> : null,
          <SpatialSortItem key={chat.id} id={chat.id} label={chat.title} activation="item" disabled={!pinned || busy || !!query.trim() || !onReorder} role="listitem" className={`chat-list-item ${pinned ? "pinned" : ""}`}
            data-chat-id={chat.id} data-pinned={pinned}>
            <SwipeRow label={`${chat.kind === "direct" ? "Удалить" : "Выйти"}: ${chat.title}`} disabled={!canSwipe || busy}
              onAction={() => { if (chat.kind === "direct") onDelete?.(chat); else if (canLeave) onLeave?.(chat); }}>
            <Menu openOnContext>
              <MenuTrigger disableButtonEnhancement>
                <button className={`chat-row ${chat.id === activeChatId ? "selected" : ""}`} type="button" onClick={() => onSelect(chat.id)}>
                  {peer && token ? <ProfileAvatar person={peer} token={token} size={40} /> : chat.kind === "direct" ? <Avatar name={chat.title} size={40} color="colorful" /> : <ChatIcon iconKey={chat.avatarIconKey ?? defaultChatIcon(chat)} />}
                  <span className="chat-row-copy">
                    <span className="chat-row-line"><strong>{chat.title}</strong><span className="chat-row-meta">{pinned && <Pin16Filled aria-label="Закреплённый чат" className="chat-pin-indicator" />}<time>{chat.time}</time></span></span>
                    <span className="chat-row-line preview-line"><span>{chat.preview}</span>
                      {chat.unread > 0 && <Badge appearance="filled" color="brand" size="small">{chat.unread}</Badge>}
                    </span>
                  </span>
                </button>
              </MenuTrigger>
              <MenuPopover><MenuList>
                {!archive && onChange ? <MenuItem icon={pinned ? <PinOff20Regular /> : <Pin20Regular />} onClick={() => void run(() => onChange(chat.id, pinned ? "unpin" : "pin"), pinned ? "Чат откреплён" : "Чат закреплён")}>{pinned ? "Открепить" : "Закрепить"}</MenuItem> : null}
                {pinned && <MenuItem icon={<ArrowUp20Regular />} disabled={!onReorder || pinIndex === 0 || Boolean(query.trim())} onClick={() => move(chat.id, pinnedIds[pinIndex - 1]!)}>Переместить выше</MenuItem>}
                {pinned && <MenuItem icon={<ArrowDown20Regular />} disabled={!onReorder || pinIndex === pinnedIds.length - 1 || Boolean(query.trim())} onClick={() => move(chat.id, pinnedIds[pinIndex + 1]!)}>Переместить ниже</MenuItem>}
                {onChange ? <MenuItem icon={<Archive20Regular />} onClick={() => void run(() => onChange(chat.id, archive ? "unarchive" : "archive"), archive ? "Чат возвращён из архива" : "Чат убран в архив; переписка сохранена")}>{archive ? "Вернуть из архива" : "В архив"}</MenuItem> : null}
                {(chat.kind === "group" && userManaged || managedLeave && canLeave) && onLeave ? <MenuItem icon={<SignOut20Regular />} disabled={!canLeave} title={!canLeave ? "Сначала добавьте участника для передачи владения" : undefined} onClick={() => onLeave(chat)}>Выйти из группы</MenuItem> : null}
                {userManaged && (chat.kind === "direct" || chat.canDelete) && onDelete ? <MenuItem icon={<Delete20Regular />} onClick={() => onDelete(chat)}>{chat.kind === "group" ? "Удалить группу" : "Удалить чат"}</MenuItem> : null}
              </MenuList></MenuPopover>
            </Menu>
            </SwipeRow>
          </SpatialSortItem>,
        ];
      })}
      {visiblePeople.map((person) => (
        <div className="chat-list-item chat-contact-item" role="listitem" key={`person:${person.id}`} data-person-id={person.id}>
          <button className="chat-row" type="button" disabled={busy || !onOpenDirect} onClick={() => {
            if (onOpenDirect) void run(() => onOpenDirect(person), `Открыт диалог с ${person.name}`);
          }}>
            {token ? <ProfileAvatar person={person} token={token} size={40} /> : <Avatar name={person.name} size={40} color="colorful" />}
            <span className="chat-row-copy">
              <span className="chat-row-line"><strong>{person.name}</strong></span>
              <span className="chat-row-line preview-line"><span>{person.jobTitle || "Начать диалог"}</span></span>
            </span>
          </button>
        </div>
      ))}
      {!visibleChats.length && !visiblePeople.length && <div className="empty-compact">{query.trim() ? emptyMessage : (regularChats.length || taskChats.length || archivedChats.length || availablePeople.length ? emptyMessage : "В системе пока нет других сотрудников")}</div>}
    </div>
    </SpatialSort>
  </>;
}
