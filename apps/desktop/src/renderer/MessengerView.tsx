import { useMemo, useState } from "react";

import type { ChatMessage } from "@yuksalish/contracts";
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
} from "@fluentui/react-icons";

import { initialChats, initialMessages, personById } from "./demo-data";

export function MessengerView() {
  const [activeChatId, setActiveChatId] = useState(initialChats[0]!.id);
  const [messages, setMessages] = useState<readonly ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");

  const activeChat = initialChats.find((chat) => chat.id === activeChatId) ?? initialChats[0]!;
  const activeMessages = messages.filter((message) => message.chatId === activeChat.id);
  const visibleChats = useMemo(
    () =>
      initialChats.filter((chat) => chat.title.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  const sendMessage = () => {
    const body = draft.trim();
    if (body.length === 0) return;
    setMessages((current) => [
      ...current,
      {
        id: `local-${current.length + 1}`,
        chatId: activeChat.id,
        authorId: "aziza",
        body,
        time: new Intl.DateTimeFormat("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date()),
        own: true,
      },
    ]);
    setDraft("");
  };

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
          aria-label="Поиск чатов"
          className="pane-search"
          contentBefore={<Search24Regular />}
          placeholder="Поиск"
          value={query}
          onChange={(_event, data) => setQuery(data.value)}
        />
        <div className="chat-list" role="list">
          {visibleChats.map((chat) => (
            <button
              className={`chat-row ${chat.id === activeChat.id ? "selected" : ""}`}
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
                  <Avatar name={author.name} size={32} color="colorful" />
                ) : null}
                <div className="message-body">
                  {!message.own ? <strong>{author.name}</strong> : null}
                  <p>{message.body}</p>
                  <time>{message.time}</time>
                </div>
              </div>
            );
          })}
        </div>

        <div className="composer">
          <Tooltip content="Прикрепить файл" relationship="label">
            <Button appearance="subtle" icon={<Attach24Regular />} aria-label="Прикрепить файл" />
          </Tooltip>
          <Input
            aria-label="Новое сообщение"
            placeholder="Напишите сообщение"
            value={draft}
            onChange={(_event, data) => setDraft(data.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
          />
          <Button
            appearance="primary"
            icon={<Send24Filled />}
            aria-label="Отправить сообщение"
            disabled={draft.trim().length === 0}
            onClick={sendMessage}
          />
        </div>
      </article>
    </section>
  );
}
