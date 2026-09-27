import {
  Button,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Input,
  Spinner,
  Textarea,
} from "@fluentui/react-components";
import {
  ChatHelp24Regular,
  CheckmarkCircle24Regular,
  Comment24Regular,
  DismissCircle24Regular,
  Dismiss20Regular,
  Lightbulb24Regular,
  Warning24Regular,
} from "@fluentui/react-icons";
import { useEffect, useState, type ReactNode } from "react";
import type {
  SupportAdminActionInput,
  SupportRegistry,
  SupportRejectionReason,
  SupportRequestCategory,
} from "@yuksalish/contracts";
import {
  actOnSupportRequest,
  createSupportRequest,
  loadSupportRegistry,
  markSupportResponsesRead,
} from "./workspace-api";
import { WorkspaceDialog } from "./WorkspaceDialog";

const categories: readonly {
  key: SupportRequestCategory;
  label: string;
  detail: string;
  icon: ReactNode;
}[] = [
  { key: "comment", label: "Комментарий", detail: "Поделитесь наблюдением", icon: <ChatHelp24Regular /> },
  { key: "bug", label: "Ошибка", detail: "Сообщите, что работает не так", icon: <Warning24Regular /> },
  { key: "improvement", label: "Улучшение", detail: "Предложите полезное изменение", icon: <Lightbulb24Regular /> },
];

const statusCopy = {
  open: "Открыто",
  implemented: "Учтено и реализовано",
  rejected: "Отклонено",
} as const;

const messageKindCopy = {
  submission: "Обращение отправлено",
  comment: "Комментарий администратора",
  implemented: "Решение подтверждено",
  rejected: "Обращение отклонено",
} as const;

const rejectionReasons: readonly { key: SupportRejectionReason; label: string }[] = [
  { key: "insufficient_information", label: "Недостаточно информации" },
  { key: "not_needed", label: "Изменение не требуется" },
  { key: "already_implemented", label: "Уже реализовано" },
];

function timeLabel(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface SupportDialogProps {
  readonly open: boolean;
  readonly token: string;
  readonly registry?: SupportRegistry;
  readonly focusRequestId?: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRegistryChange: (registry: SupportRegistry) => void;
}

export function SupportDialog({
  open,
  token,
  registry,
  focusRequestId,
  onOpenChange,
  onRegistryChange,
}: SupportDialogProps) {
  const [category, setCategory] = useState<SupportRequestCategory>("comment");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [comment, setComment] = useState("");
  const [rejectionReason, setRejectionReason] = useState<SupportRejectionReason>(
    "insufficient_information",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    void loadSupportRegistry(token)
      .then(async (loaded) => {
        if (!active) return;
        onRegistryChange(loaded);
        if (loaded.mode === "support" && loaded.unreadResponseCount > 0) {
          await markSupportResponsesRead(token);
          if (active) onRegistryChange({ ...loaded, indicator: null, unreadResponseCount: 0,
            requests: loaded.requests.map((item) => ({ ...item, responseUnread: false })) });
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Не удалось загрузить обращения");
      });
    return () => { active = false; };
  }, [onRegistryChange, open, token]);

  const requests = registry?.requests ?? [];
  const effectiveSelectedId = focusRequestId ?? selectedId ?? requests[0]?.id;
  const selected = requests.find((item) => item.id === effectiveSelectedId);

  const refresh = async (preferredId?: string) => {
    const loaded = await loadSupportRegistry(token);
    onRegistryChange(loaded);
    if (preferredId) setSelectedId(preferredId);
  };

  const submit = async () => {
    if (subject.trim().length < 3 || body.trim().length < 8) {
      setError("Добавьте короткую тему и описание не короче 8 символов.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await createSupportRequest(token, {
        category,
        subject: subject.trim(),
        body: body.trim(),
      });
      setSubject("");
      setBody("");
      await refresh(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось отправить обращение");
    } finally {
      setBusy(false);
    }
  };

  const act = async (payload: SupportAdminActionInput) => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await actOnSupportRequest(token, selected.id, payload);
      setComment("");
      await refresh(selected.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить ответ");
    } finally {
      setBusy(false);
    }
  };

  const isInbox = registry?.mode === "inbox";
  return (
    <WorkspaceDialog open={open} onOpenChange={(_event, data) => {
      if (!busy) onOpenChange(data.open);
    }}>
      <DialogSurface className="support-dialog" aria-labelledby="support-dialog-title">
        <DialogBody>
          <DialogTitle id="support-dialog-title" action={
            <DialogTrigger action="close" disableButtonEnhancement>
              <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть поддержку" disabled={busy} />
            </DialogTrigger>
          }>
            {isInbox ? "Обращения сотрудников" : "Поддержка"}
          </DialogTitle>
          <DialogContent className="support-dialog-content">
            <header className="support-hero">
              <span><ChatHelp24Regular /></span>
              <div>
                <strong>{isInbox ? "Единая очередь обратной связи" : "Помогите сделать Workspace лучше"}</strong>
                <p>{isInbox
                  ? "Читайте сообщения, уточняйте детали и возвращайте сотруднику понятный результат."
                  : "Здесь можно оставить комментарий, сообщить об ошибке или предложить улучшение. Ответ администратора появится в уведомлениях и сохранится в истории."}</p>
              </div>
            </header>

            {error ? <div className="support-error" role="alert">{error}</div> : null}
            {!registry ? <div className="support-loading"><Spinner label="Загружаем обращения" /></div> : (
              <div className={`support-workspace ${isInbox ? "is-inbox" : "is-personal"}`}>
                <aside className="support-request-list" aria-label={isInbox ? "Все обращения" : "Мои обращения"}>
                  <div className="support-list-title">
                    <strong>{isInbox ? "Все обращения" : "Моя история"}</strong>
                    <span>{requests.length}</span>
                  </div>
                  {requests.length === 0 ? (
                    <p className="support-empty">{isInbox ? "Новых обращений пока нет." : "Вы ещё не отправляли обращений."}</p>
                  ) : requests.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`support-request-card ${effectiveSelectedId === item.id ? "is-selected" : ""} ${item.responseUnread ? "has-response" : ""}`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <span><b>{item.subject}</b><em className={`status-${item.status}`}>{statusCopy[item.status]}</em></span>
                      <small>{isInbox ? `${item.authorName} · @${item.authorUsername}` : categories.find((entry) => entry.key === item.category)?.label}</small>
                      <time>{timeLabel(item.updatedAt)}</time>
                    </button>
                  ))}
                </aside>

                <main className="support-main">
                  {!isInbox ? (
                    <section className="support-composer" aria-label="Новое обращение">
                      <div className="support-category-picker" role="group" aria-label="Тип обращения">
                        {categories.map((entry) => (
                          <button key={entry.key} type="button" aria-pressed={category === entry.key} onClick={() => setCategory(entry.key)}>
                            {entry.icon}<span><b>{entry.label}</b><small>{entry.detail}</small></span>
                          </button>
                        ))}
                      </div>
                      <label><span>Тема</span><Input value={subject} maxLength={160} placeholder="Коротко о главном" onChange={(_event, data) => setSubject(data.value)} /></label>
                      <label><span>Описание</span><Textarea value={body} maxLength={10_000} resize="vertical" placeholder="Что произошло или что можно улучшить?" onChange={(_event, data) => setBody(data.value)} /></label>
                      <Button appearance="primary" disabled={busy} onClick={() => void submit()}>{busy ? "Отправляем…" : "Отправить обращение"}</Button>
                    </section>
                  ) : null}

                  {selected ? (
                    <section className="support-thread" aria-label={`Обращение: ${selected.subject}`}>
                      <header>
                        <div><span>{categories.find((entry) => entry.key === selected.category)?.label}</span><h2>{selected.subject}</h2></div>
                        <em className={`status-${selected.status}`}>{statusCopy[selected.status]}</em>
                      </header>
                      {isInbox ? <p className="support-author">{selected.authorName} · @{selected.authorUsername}</p> : null}
                      <div className="support-message-list">
                        {selected.messages.map((message) => (
                          <article key={message.id} className={`support-message kind-${message.kind}`}>
                            <span><b>{message.authorName}</b><small>{messageKindCopy[message.kind]}</small><time>{timeLabel(message.createdAt)}</time></span>
                            <p>{message.body}</p>
                          </article>
                        ))}
                      </div>
                      {isInbox ? (
                        <div className="support-admin-actions">
                          <label><span>Комментарий сотруднику</span><Textarea value={comment} maxLength={10_000} resize="vertical" placeholder="Уточните детали или объясните решение" onChange={(_event, data) => setComment(data.value)} /></label>
                          <div className="support-resolution-reasons" role="group" aria-label="Причина отклонения">
                            {rejectionReasons.map((reason) => <button key={reason.key} type="button" aria-pressed={rejectionReason === reason.key} onClick={() => setRejectionReason(reason.key)}>{reason.label}</button>)}
                          </div>
                          <div className="support-action-row">
                            <Button icon={<Comment24Regular />} disabled={busy || comment.trim().length < 2} onClick={() => void act({ action: "comment", body: comment.trim() })}>Отправить комментарий</Button>
                            <Button appearance="primary" icon={<CheckmarkCircle24Regular />} disabled={busy} onClick={() => void act({ action: "implement", body: comment.trim() || undefined })}>Учтено и реализовано</Button>
                            <Button className="support-reject" icon={<DismissCircle24Regular />} disabled={busy} onClick={() => void act({ action: "reject", rejectionReason, body: comment.trim() || undefined })}>Отклонить</Button>
                          </div>
                        </div>
                      ) : null}
                    </section>
                  ) : <div className="support-thread-empty">Выберите обращение, чтобы открыть историю.</div>}
                </main>
              </div>
            )}
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </WorkspaceDialog>
  );
}
