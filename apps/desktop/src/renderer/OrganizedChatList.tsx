import { Fragment, useMemo, useState } from "react";
import type { ChatMessage, ChatSummary, PersonalChatAction, PersonalPreferences } from "@yuksalish/contracts";
import { Avatar, Badge, Button, Input, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from "@fluentui/react-components";
import { Archive20Regular, ArrowDown20Regular, ArrowUp20Regular, MoreHorizontal20Regular, Pin16Filled, Pin20Regular, PinOff20Regular, Search24Regular } from "@fluentui/react-icons";
import { moveBefore } from "./personal-organization";

export function OrganizedChatList({ chats, messages, activeChatId, focusChatId, preferences, onSelect, onChange, onReorder }: {
  readonly chats: readonly ChatSummary[];
  readonly messages: readonly ChatMessage[];
  readonly activeChatId?: string;
  readonly focusChatId?: string;
  readonly preferences: PersonalPreferences;
  readonly onSelect: (id: string) => void;
  readonly onChange?: (id: string, action: PersonalChatAction) => Promise<void>;
  readonly onReorder?: (order: readonly string[]) => Promise<void>;
}) {
  const [archive, setArchive] = useState(Boolean(focusChatId && preferences.archivedChatIds.includes(focusChatId)));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragged, setDragged] = useState<string>();
  const [over, setOver] = useState<string>();
  const pinnedIds = preferences.pinnedChatIds.filter((id) => chats.some((chat) => chat.id === id) && !preferences.archivedChatIds.includes(id));
  const archivedChats = chats.filter((chat) => preferences.archivedChatIds.includes(chat.id));
  const visibleChats = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matching = new Set(messages.filter((message) => !message.deletedAt && message.body.toLowerCase().includes(normalized)).map((message) => message.chatId));
    const selected = chats.filter((chat) => preferences.archivedChatIds.includes(chat.id) === archive
      && (!normalized || chat.title.toLowerCase().includes(normalized) || matching.has(chat.id)));
    if (archive) return selected;
    const positions = new Map(preferences.pinnedChatIds.map((id, index) => [id, index]));
    return [...selected].sort((a, b) => (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }, [archive, chats, messages, preferences, query]);
  const hasPins = !archive && visibleChats.some((chat) => pinnedIds.includes(chat.id));
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
      <button type="button" aria-pressed={!archive} onClick={() => setArchive(false)}>Чаты</button>
      <button type="button" aria-pressed={archive} onClick={() => setArchive(true)}><Archive20Regular />Архив <span>{archivedChats.length}</span>
        {archivedChats.some((chat) => chat.unread > 0) && <i aria-label="В архиве есть непрочитанные сообщения" />}</button>
    </div>
    {archive && <p className="chat-organization-hint">Архив только для вас. Переписка и уведомления сохраняются.</p>}
    {error && <div className="organization-error" role="alert">{error}</div>}
    <span className="organization-live" role="status">{busy ? "Сохраняем настройки чатов…" : notice}</span>
    <div className="chat-list" role="list" aria-label={archive ? "Архив чатов" : "Активные чаты"} aria-busy={busy}>
      {visibleChats.map((chat, index) => {
        const pinned = !archive && pinnedIds.includes(chat.id);
        const pinIndex = pinnedIds.indexOf(chat.id);
        const startGroup = hasPins && (index === 0 || (pinnedIds.includes(visibleChats[index - 1]!.id) && !pinned));
        return <Fragment key={chat.id}>
          {startGroup && <div className="chat-group-label">{pinned ? "Закреплённые" : "Остальные чаты"}{pinned && <small>{query.trim() ? "Очистите поиск для перестановки" : "Перетащите для перестановки"}</small>}</div>}
          <div role="listitem" className={`chat-list-item ${pinned ? "pinned" : ""} ${over === chat.id ? "drop-target" : ""}`}
            data-chat-id={chat.id} data-pinned={pinned} draggable={pinned && !busy && !query.trim()}
            onDragStart={(event) => { if (!pinned || busy || query.trim()) { event.preventDefault(); return; } setDragged(chat.id); event.dataTransfer.setData("application/x-yuksalish-pinned-chat", chat.id); event.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(event) => { if (pinned && dragged && dragged !== chat.id && !busy && !query.trim()) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(chat.id); } }}
            onDrop={(event) => { if (dragged && event.dataTransfer.getData("application/x-yuksalish-pinned-chat") === dragged) { event.preventDefault(); move(dragged, chat.id); } setDragged(undefined); setOver(undefined); }}
            onDragEnd={() => { setDragged(undefined); setOver(undefined); }}>
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
                aria-label={`Действия чата «${chat.title}»`} disabled={busy || !onChange} /></MenuTrigger>
              <MenuPopover><MenuList>
                {!archive && <MenuItem icon={pinned ? <PinOff20Regular /> : <Pin20Regular />} onClick={() => void run(() => onChange!(chat.id, pinned ? "unpin" : "pin"), pinned ? "Чат откреплён" : "Чат закреплён")}>{pinned ? "Открепить" : "Закрепить"}</MenuItem>}
                {pinned && <MenuItem icon={<ArrowUp20Regular />} disabled={!onReorder || pinIndex === 0 || Boolean(query.trim())} onClick={() => move(chat.id, pinnedIds[pinIndex - 1]!)}>Переместить выше</MenuItem>}
                {pinned && <MenuItem icon={<ArrowDown20Regular />} disabled={!onReorder || pinIndex === pinnedIds.length - 1 || Boolean(query.trim())} onClick={() => move(chat.id, pinnedIds[pinIndex + 1]!)}>Переместить ниже</MenuItem>}
                <MenuItem icon={<Archive20Regular />} onClick={() => void run(() => onChange!(chat.id, archive ? "unarchive" : "archive"), archive ? "Чат возвращён из архива" : "Чат убран в архив; переписка сохранена")}>{archive ? "Вернуть из архива" : "В архив"}</MenuItem>
              </MenuList></MenuPopover>
            </Menu>
          </div>
        </Fragment>;
      })}
      {!visibleChats.length && <div className="empty-compact">{query.trim() ? "Чаты не найдены" : archive ? "Архив пуст" : chats.length ? "Все чаты в архиве" : "Создайте первый разговор кнопкой +"}</div>}
    </div>
  </>;
}
