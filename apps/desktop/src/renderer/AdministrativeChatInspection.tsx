import { useEffect, useMemo, useRef, useState } from "react";

import type { AdministrativeChat, AdministrativeChatInspection } from "@yuksalish/contracts";
import { Button, Field, Input, Spinner, Textarea } from "@fluentui/react-components";
import { Dismiss20Regular, LockClosed20Regular, Search20Regular } from "@fluentui/react-icons";
import { WorkspaceSelect as Select } from "./WorkspaceSelect";
import { EmployeeProfileLink } from "./EmployeeProfileLink";

import {
  createAdministrativeChatInspection,
  loadAdministrativeChats,
  revokeAdministrativeChatInspection,
} from "./workspace-api";

const kindLabels: Record<string, string> = {
  direct: "Личный чат",
  group: "Группа",
  department: "Подразделение",
  project: "Проект",
  task: "Задача",
  approval: "Согласование",
};

const formatDateTime = (value: string) => new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
}).format(new Date(value));

export function AdministrativeChatInspectionView({ token, onClose }: {
  readonly token: string;
  readonly onClose: () => void;
}) {
  const [chats, setChats] = useState<readonly AdministrativeChat[]>();
  const [selectedChatId, setSelectedChatId] = useState("");
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<15 | 30 | 60>(30);
  const [inspection, setInspection] = useState<AdministrativeChatInspection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inspectionId = useRef<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void loadAdministrativeChats(token)
      .then((loaded) => {
        if (!active) return;
        setChats(loaded);
        setSelectedChatId(loaded[0]?.id ?? "");
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Не удалось загрузить список чатов");
      });
    return () => {
      active = false;
      if (inspectionId.current) void revokeAdministrativeChatInspection(token, inspectionId.current);
    };
  }, [token]);

  useEffect(() => {
    if (!inspection) return;
    const remaining = Math.max(0, new Date(inspection.expiresAt).getTime() - Date.now());
    const timer = window.setTimeout(() => {
      inspectionId.current = undefined;
      setInspection(undefined);
      setReason("");
      setError("Срок административного просмотра истёк. Чтобы продолжить, укажите новое основание.");
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [inspection]);

  const visibleChats = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    if (!normalized) return chats ?? [];
    return (chats ?? []).filter((chat) =>
      `${chat.title} ${chat.members.map((member) => member.name).join(" ")}`
        .toLocaleLowerCase("ru-RU")
        .includes(normalized));
  }, [chats, query]);
  const selectedChat = chats?.find((chat) => chat.id === selectedChatId);

  const startInspection = async () => {
    if (busy || !selectedChat || reason.trim().length < 12) return;
    setBusy(true);
    setError("");
    try {
      if (inspectionId.current) await revokeAdministrativeChatInspection(token, inspectionId.current);
      const created = await createAdministrativeChatInspection(
        token,
        selectedChat.id,
        reason.trim(),
        duration,
      );
      inspectionId.current = created.id;
      setInspection(created);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось открыть контролируемый просмотр");
    } finally {
      setBusy(false);
    }
  };

  const endInspection = async () => {
    if (busy || !inspectionId.current) return;
    setBusy(true);
    setError("");
    try {
      await revokeAdministrativeChatInspection(token, inspectionId.current);
      inspectionId.current = undefined;
      setInspection(undefined);
      setReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось завершить просмотр");
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (busy) return;
    if (inspectionId.current) {
      setBusy(true);
      try {
        await revokeAdministrativeChatInspection(token, inspectionId.current);
        inspectionId.current = undefined;
      } catch {
        // The short-lived server grant will expire even if the close-time revocation cannot reach it.
      }
    }
    onClose();
  };

  return <section className="admin-chat-control" aria-label="Контролируемый доступ к чатам">
    <header className="admin-chat-header">
      <div className="admin-chat-heading-icon"><LockClosed20Regular /></div>
      <div>
        <span>Административный контроль</span>
        <h2>Просмотр рабочих чатов</h2>
        <p>Только чтение, обязательное основание и запись каждого открытия в аудит.</p>
      </div>
      <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть контроль чатов" disabled={busy} onClick={() => void close()} />
    </header>
    <div className="admin-chat-notice">
      Администратор не становится участником чата, не меняет непрочитанные сообщения и не может отправлять, редактировать или скачивать вложения.
    </div>
    <div className="admin-chat-feedback-slot">
      {error ? <div className="admin-chat-error" role="alert">{error}</div> : null}
    </div>
    {chats === undefined && !error ? <Spinner label="Загружаем доступные для контроля чаты" /> : null}
    {chats !== undefined ? <div className="admin-chat-layout">
      <aside className="admin-chat-list" aria-label="Чаты Workspace">
        <Input contentBefore={<Search20Regular />} aria-label="Поиск чатов для контроля" placeholder="Название или участник" value={query} onChange={(_, data) => setQuery(data.value)} />
        <div className="admin-chat-list-scroll">
          {visibleChats.map((chat) => <button
            type="button"
            key={chat.id}
            className={chat.id === selectedChatId ? "selected" : ""}
            disabled={busy || Boolean(inspection)}
            onClick={() => { setSelectedChatId(chat.id); setReason(""); setError(""); }}
          >
            <span><strong>{chat.title}</strong><small>{kindLabels[chat.kind] ?? chat.kind}</small></span>
            <small>{chat.members.length} участн. · {chat.messageCount} сообщ.</small>
          </button>)}
          {!visibleChats.length ? <p className="admin-chat-empty">Чаты не найдены</p> : null}
        </div>
      </aside>
      <main className="admin-chat-stage">
        {inspection ? <>
          <div className="admin-inspection-session">
            <div><span>Просмотр активен до {formatDateTime(inspection.expiresAt)}</span><strong>{inspection.chat.title}</strong></div>
            <Button disabled={busy} onClick={() => void endInspection()}>Завершить просмотр</Button>
          </div>
          <p className="admin-inspection-reason"><strong>Основание:</strong> {inspection.reason}</p>
          <div className="admin-inspection-messages" role="log" aria-label={`Сообщения: ${inspection.chat.title}`}>
            {inspection.messages.map((message) => <article key={message.id} className={message.deletedAt ? "deleted" : ""}>
              <header><EmployeeProfileLink userId={message.authorUserId} personName={message.authorName}><strong>{message.authorName}</strong></EmployeeProfileLink><time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time></header>
              <p>{message.body}</p>
              {message.editedAt && !message.deletedAt ? <small>изменено</small> : null}
            </article>)}
            {!inspection.messages.length ? <p className="admin-chat-empty">В чате пока нет сообщений</p> : null}
          </div>
          {inspection.truncated ? <p className="admin-chat-limit">Показаны последние 500 из {inspection.totalMessages} сообщений.</p> : null}
        </> : selectedChat ? <div className="admin-chat-request">
          <div className="admin-chat-summary">
            <span>{kindLabels[selectedChat.kind] ?? selectedChat.kind}</span>
            <h3>{selectedChat.title}</h3>
            <p>{selectedChat.members.map((member, index) => <span key={member.userId}>{index ? ", " : ""}<EmployeeProfileLink userId={member.userId} personName={member.name}>{member.name}</EmployeeProfileLink></span>)}</p>
            <small>{selectedChat.messageCount} сообщений · обновлён {formatDateTime(selectedChat.updatedAt)}</small>
          </div>
          <Field label="Основание просмотра" required hint="Минимум 12 символов. Основание сохранится в журнале аудита.">
            <Textarea aria-label="Основание административного просмотра" resize="vertical" maxLength={500} value={reason} disabled={busy} onChange={(_, data) => setReason(data.value)} />
          </Field>
          <Field label="Срок доступа" hint="После истечения просмотр закрывается сервером автоматически.">
            <Select aria-label="Срок административного просмотра" value={String(duration)} disabled={busy} onChange={(event) => setDuration(Number(event.target.value) as 15 | 30 | 60)}>
              <option value="15">15 минут</option>
              <option value="30">30 минут</option>
              <option value="60">60 минут</option>
            </Select>
          </Field>
          <Button appearance="primary" disabled={busy || reason.trim().length < 12} onClick={() => void startInspection()}>
            {busy ? "Открываем…" : "Открыть для просмотра"}
          </Button>
        </div> : <p className="admin-chat-empty">Выберите чат слева</p>}
      </main>
    </div> : null}
  </section>;
}
