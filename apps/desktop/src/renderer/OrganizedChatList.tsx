import { SpatialSort, SpatialSortItem } from "./SpatialSort";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { ChatMessage, ChatSummary, PersonalChatAction, PersonalPreferences } from "@yuksalish/contracts";
import { Avatar, Badge, Button, Input, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from "@fluentui/react-components";
import { Airplane20Regular, Archive20Regular, ArrowDown20Regular, ArrowUp20Regular, Delete20Regular, Dismiss20Regular, Folder20Regular, MoreHorizontal20Regular, Pin16Filled, Pin20Regular, PinOff20Regular, Search24Regular, TaskListSquareLtr24Regular } from "@fluentui/react-icons";
import { moveBefore } from "./personal-organization";

type ChatBucket = "chats" | "task-chats" | "archive";

const isTaskChat = (chat: ChatSummary): boolean => chat.kind === "task";
const isProjectChat = (chat: ChatSummary): boolean => chat.contextType === "project";
const isTripChat = (chat: ChatSummary): boolean => chat.contextType === "trip";
const isContextChat = (chat: ChatSummary): boolean => isProjectChat(chat) || isTripChat(chat);

const bucketLabel = (bucket: ChatBucket): string => bucket === "chats" ? "Чаты" : bucket === "task-chats" ? "Чаты задач" : "Архив";

const bucketEmptyMessage = (bucket: ChatBucket): string => bucket === "archive" ? "Архив пуст" : bucket === "task-chats" ? "Чатов задач не найдено" : "Все чаты в архиве";

export function OrganizedChatList({ chats, messages, activeChatId, focusChatId, preferences, onSelect, onChange, onReorder, onDelete }: {
  readonly chats: readonly ChatSummary[];
  readonly messages: readonly ChatMessage[];
  readonly activeChatId?: string;
  readonly focusChatId?: string;
  readonly preferences: PersonalPreferences;
  readonly onSelect: (id: string) => void;
  readonly onChange?: (id: string, action: PersonalChatAction) => Promise<void>;
  readonly onReorder?: (order: readonly string[]) => Promise<void>;
  readonly onDelete?: (chat: ChatSummary) => void;
}) {
  const initialBucket: ChatBucket = focusChatId && preferences.archivedChatIds.includes(focusChatId)
    ? "archive"
    : "chats";
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [bucket, setBucket] = useState<ChatBucket>(initialBucket);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [moreOpen]);
  const archive = bucket === "archive";
  const pinnedIds = preferences.pinnedChatIds.filter((id) => chats.some((chat) => chat.id === id) && !preferences.archivedChatIds.includes(id));
  const archivedChats = chats.filter((chat) => preferences.archivedChatIds.includes(chat.id));
  const regularChats = chats.filter((chat) => !isTaskChat(chat) && !isContextChat(chat) && !preferences.archivedChatIds.includes(chat.id));
  const taskChats = chats.filter((chat) => isTaskChat(chat) && !preferences.archivedChatIds.includes(chat.id));
  const projectChats = chats.filter((chat) => isProjectChat(chat) && !preferences.archivedChatIds.includes(chat.id));
  const tripChats = chats.filter((chat) => isTripChat(chat) && !preferences.archivedChatIds.includes(chat.id));
  const archivedRegularChats = chats.filter((chat) => !isTaskChat(chat) && preferences.archivedChatIds.includes(chat.id));
  const archivedTaskChats = chats.filter((chat) => isTaskChat(chat) && preferences.archivedChatIds.includes(chat.id));
  const visibleChats = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matching = new Set(messages.filter((message) => !message.deletedAt && message.body.toLowerCase().includes(normalized)).map((message) => message.chatId));
    const base = bucket === "archive" ? [...archivedRegularChats, ...archivedTaskChats] : bucket === "task-chats" ? taskChats : regularChats;
    const selected = base.filter((chat) => !normalized || chat.title.toLowerCase().includes(normalized) || matching.has(chat.id));
    if (archive) return selected;
    const positions = new Map(preferences.pinnedChatIds.map((id, index) => [id, index]));
    return [...selected].sort((a, b) => (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }, [archive, bucket, archivedRegularChats, archivedTaskChats, regularChats, taskChats, messages, preferences, query]);
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
    void run(() => onReorder(moveBefore(pinnedIds, source, target)), "Порядок закреплённых чатов сохранён");
  };
  return <>
    <Input aria-label="Поиск чатов и сообщений" className="pane-search" contentBefore={<Search24Regular />}
      placeholder={archive ? "Поиск в архиве" : "Поиск по чатам и сообщениям"} value={query} onChange={(_, data) => setQuery(data.value)} />
    <div className="chat-buckets" role="group" aria-label="Папки чатов">
      <button type="button" aria-pressed={bucket === "chats"} onClick={() => { setBucket("chats"); }}>
        Чаты <span>{regularChats.length}</span>
      </button>
      <button type="button" aria-pressed={bucket === "task-chats"} onClick={() => { setBucket("task-chats"); }}>
        <TaskListSquareLtr24Regular />Чаты задач <span>{taskChats.length}</span>
      </button>
      <button type="button" aria-pressed={bucket === "archive"} onClick={() => { setBucket("archive"); }}><Archive20Regular />Архив <span>{archivedRegularChats.length + archivedTaskChats.length}</span>
        {archivedChats.some((chat) => chat.unread > 0) && <i aria-label="В архиве есть непрочитанные сообщения" />}</button>
      <button type="button" className="chat-more-bucket" aria-expanded={moreOpen} aria-controls="messenger-more-drawer" onClick={() => setMoreOpen(true)}>
        <MoreHorizontal20Regular />Ещё <span>{projectChats.length + tripChats.length}</span>
      </button>
    </div>
    {moreOpen ? <div className="messenger-more-backdrop" onMouseDown={() => setMoreOpen(false)}>
      <aside id="messenger-more-drawer" className="messenger-more-drawer" role="dialog" aria-modal="true" aria-labelledby="messenger-more-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className="messenger-eyebrow">Связанные обсуждения</span><h2 id="messenger-more-title">Другие чаты</h2></div>
          <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть другие чаты" onClick={() => setMoreOpen(false)} /></header>
        {[{ title: "Чаты проектов", icon: <Folder20Regular />, chats: projectChats }, { title: "Чаты поездок", icon: <Airplane20Regular />, chats: tripChats }].map((section) => <section key={section.title}>
          <h3>{section.icon}{section.title}<span>{section.chats.length}</span></h3>
          <div className="messenger-context-chat-list">
            {section.chats.map((chat) => <button key={chat.id} type="button" onClick={() => { onSelect(chat.id); setMoreOpen(false); }}>
              <Avatar name={chat.title} size={36} color="colorful" /><span className="messenger-context-chat-copy"><strong>{chat.title}</strong><small>{chat.preview}</small></span>
              {chat.unread > 0 ? <Badge appearance="filled" color="brand" size="small">{chat.unread}</Badge> : null}
            </button>)}
            {!section.chats.length ? <p>Пока нет доступных чатов</p> : null}
          </div>
        </section>)}
      </aside>
    </div> : null}
    {archive && <p className="chat-organization-hint">Архив только для вас. Переписка и уведомления сохраняются.</p>}
    {error && <div className="organization-error" role="alert">{error}</div>}
    <span className="organization-live" role="status">{busy ? "Сохраняем настройки чатов…" : notice}</span>
    <SpatialSort ids={visibleChats.map(chat => chat.id)} onMove={move}>
    <div className="chat-list" role="list" aria-label={bucketLabel(bucket)} aria-busy={busy}>
      {visibleChats.map((chat, index) => {
        const pinned = !archive && pinnedIds.includes(chat.id);
        const pinIndex = pinnedIds.indexOf(chat.id);
        const startGroup = hasPins && (index === 0 || (pinnedIds.includes(visibleChats[index - 1]!.id) && !pinned));
        const groupLabel = bucket === "task-chats" ? (pinned ? "Закреплённые чаты задач" : "Остальные чаты задач") : (pinned ? "Закреплённые" : "Остальные чаты");
        return <Fragment key={chat.id}>
          {startGroup && <div className="chat-group-label">{groupLabel}{pinned && <small>{query.trim() ? "Очистите поиск для перестановки" : "Перетащите для перестановки"}</small>}</div>}
          <SpatialSortItem id={chat.id} label={chat.title} disabled={!pinned || busy || !!query.trim() || !onReorder} role="listitem" className={`chat-list-item ${pinned ? "pinned" : ""}`}
            data-chat-id={chat.id} data-pinned={pinned}>
            <button className={`chat-row ${chat.id === activeChatId ? "selected" : ""}`} type="button" onClick={() => onSelect(chat.id)}>
              <Avatar name={chat.title} size={40} color="colorful" />
              <span className="chat-row-copy">
                <span className="chat-row-line"><strong>{chat.title}</strong><time>{chat.time}</time></span>
                <span className="chat-row-line preview-line"><span>{chat.preview}</span>
                  {pinned && <Pin16Filled aria-label="Закреплённый чат" className="chat-pin-indicator" />}
                  {chat.unread > 0 && <Badge appearance="filled" color="brand" size="small">{chat.unread}</Badge>}
                </span>
              </span>
            </button>
            <Menu>
              <MenuTrigger disableButtonEnhancement><Button className="chat-more" appearance="subtle" size="small" icon={<MoreHorizontal20Regular />}
                aria-label={`Действия чата «${chat.title}»`} disabled={busy || (!onChange && !onDelete)} /></MenuTrigger>
              <MenuPopover><MenuList>
                {!archive && onChange ? <MenuItem icon={pinned ? <PinOff20Regular /> : <Pin20Regular />} onClick={() => void run(() => onChange(chat.id, pinned ? "unpin" : "pin"), pinned ? "Чат откреплён" : "Чат закреплён")}>{pinned ? "Открепить" : "Закрепить"}</MenuItem> : null}
                {pinned && <MenuItem icon={<ArrowUp20Regular />} disabled={!onReorder || pinIndex === 0 || Boolean(query.trim())} onClick={() => move(chat.id, pinnedIds[pinIndex - 1]!)}>Переместить выше</MenuItem>}
                {pinned && <MenuItem icon={<ArrowDown20Regular />} disabled={!onReorder || pinIndex === pinnedIds.length - 1 || Boolean(query.trim())} onClick={() => move(chat.id, pinnedIds[pinIndex + 1]!)}>Переместить ниже</MenuItem>}
                {onChange ? <MenuItem icon={<Archive20Regular />} onClick={() => void run(() => onChange(chat.id, archive ? "unarchive" : "archive"), archive ? "Чат возвращён из архива" : "Чат убран в архив; переписка сохранена")}>{archive ? "Вернуть из архива" : "В архив"}</MenuItem> : null}
                {chat.canDelete && onDelete ? <MenuItem icon={<Delete20Regular />} onClick={() => onDelete(chat)}>Удалить чат</MenuItem> : null}
              </MenuList></MenuPopover>
            </Menu>
          </SpatialSortItem>
        </Fragment>;
      })}
      {!visibleChats.length && <div className="empty-compact">{query.trim() ? emptyMessage : (regularChats.length || taskChats.length || archivedChats.length ? emptyMessage : "Создайте первый разговор кнопкой +")}</div>}
    </div>
    </SpatialSort>
  </>;
}
