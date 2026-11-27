import { formatRussianDateTime } from "./date-time-format";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { employeeDisplayName } from "./employee-display-name";
import { LoadingSkeleton } from "./LoadingSkeleton";
import {
  Button,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Input,
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
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft20Regular, Search20Regular } from "@fluentui/react-icons";
import { useProgressiveList } from "./useProgressiveList";
import { useBrowserCompactLayout } from "./browser-layout";
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
  return formatRussianDateTime(new Date(value), {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const EMPTY_REQUESTS: SupportRegistry["requests"] = [];

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
  const [selection, setSelection] = useState<{ id: string; focusId?: string }>();
  const [comments, setComments] = useState<Readonly<Record<string, string>>>({});
  const [query, setQuery] = useState("");
  const [phoneScreen, setPhoneScreen] = useState<"list" | "thread" | "compose">();
  const phoneLayout = useBrowserCompactLayout(true, "(max-width: 700px)");
  const mainRef = useRef<HTMLElement>(null);
  const submissionLock = useRef(false);
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
        setError("");
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

  const requests = registry?.requests ?? EMPTY_REQUESTS;
  const isInbox = registry?.mode === "inbox";
  const effectiveSelectedId = selection?.focusId === focusRequestId ? selection?.id ?? requests[0]?.id : focusRequestId ?? requests[0]?.id;
  const selected = requests.find((item) => item.id === effectiveSelectedId);
  const comment = comments[effectiveSelectedId ?? ""] ?? "";
  const setComment = (value: string) => { if (effectiveSelectedId) setComments(current => ({ ...current, [effectiveSelectedId]: value })); };
  const searchIndex = useMemo(() => requests.map(item => ({ item, text: `${item.subject} ${item.authorName} ${item.authorUsername} ${statusCopy[item.status]}`.toLocaleLowerCase() })), [requests]);
  const search = query.trim().toLocaleLowerCase();
  const visibleRequests = useMemo(() => searchIndex.filter(entry => entry.text.includes(search)).map(entry => entry.item), [searchIndex, search]);
  const { stream, sentinel, shown, hasMore, loadMore } = useProgressiveList(open ? visibleRequests.length : 0, `${token}:${open}:${query}:${registry?.mode}`, '.support-request-card');
  const mobileScreen = phoneScreen ?? (focusRequestId ? "thread" : isInbox ? "list" : "compose");

  const refresh = async (preferredId?: string) => {
    const loaded = await loadSupportRegistry(token);
    onRegistryChange(loaded);
    if (preferredId) setSelection({ id: preferredId, focusId: focusRequestId });
  };

  const submit = async () => {
    if (submissionLock.current) return;
    if (subject.trim().length < 3 || body.trim().length < 8) {
      setError("Добавьте короткую тему и описание не короче 8 символов.");
      return;
    }
    submissionLock.current = true;
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
      setPhoneScreen("thread");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось отправить обращение");
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  };

  const act = async (payload: SupportAdminActionInput) => {
    if (!selected || submissionLock.current) return;
    submissionLock.current = true;
    setBusy(true);
    setError("");
    try {
      await actOnSupportRequest(token, selected.id, payload);
      setComment("");
      await refresh(selected.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить ответ");
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  };

  return (
    <WorkspaceDialog open={open} onOpenChange={(_event, data) => {
      if (!busy) { if (!data.open) setPhoneScreen(undefined); onOpenChange(data.open); }
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
            <p className="support-intro">{isInbox ? "Обратная связь сотрудников: вопросы, ошибки и предложения" : "Сообщите об ошибке или предложите улучшение. Ответ сохранится в истории."}</p>

            {error ? <WorkspaceNotice tone="error" className="support-error" role="alert">{error}</WorkspaceNotice> : null}
            {!registry ? (!error ? <LoadingSkeleton layout="rows" label="Загружаем обращения" /> : null) : (
              <div className={`support-workspace ${isInbox ? "is-inbox" : "is-personal"}`} data-mobile-screen={mobileScreen}>
                {phoneLayout && (mobileScreen === "thread" || !isInbox) && <nav className="support-mobile-navigation" aria-label="Разделы обращений">
                  <Button disabled={busy} icon={mobileScreen === "thread" ? <ArrowLeft20Regular /> : undefined} aria-pressed={mobileScreen === "list"} onClick={() => setPhoneScreen("list")}>{isInbox ? "Все обращения" : "Моя история"}</Button>
                  {!isInbox && <Button disabled={busy} aria-pressed={mobileScreen === "compose"} onClick={() => setPhoneScreen("compose")}>Новое обращение</Button>}
                </nav>}
                <aside className="support-request-list" aria-label={isInbox ? "Все обращения" : "Мои обращения"}>
                  <div className="support-list-title">
                    <strong>{isInbox ? "Все обращения" : "Моя история"}</strong>
                    <span>{visibleRequests.length}</span>
                  </div>
                  <Input aria-label="Поиск обращений" contentBefore={<Search20Regular />} placeholder="Тема или сотрудник" value={query} onChange={(_, data) => setQuery(data.value)} />
                  <div className="support-request-stream" ref={stream}>
                  {visibleRequests.length === 0 ? (
                    <p className="support-empty">{search ? "По этому запросу ничего не найдено." : isInbox ? "Новых обращений пока нет." : "Вы ещё не отправляли обращений."}</p>
                  ) : visibleRequests.slice(0, shown).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`support-request-card ${effectiveSelectedId === item.id ? "is-selected" : ""} ${item.responseUnread ? "has-response" : ""}`}
                      disabled={busy} aria-pressed={effectiveSelectedId === item.id}
                      onClick={() => { setSelection({ id: item.id, focusId: focusRequestId }); setPhoneScreen("thread"); setError(""); setRejectionReason("insufficient_information"); if (mainRef.current) mainRef.current.scrollTop = 0; }}
                    >
                      <span><b>{item.subject}</b><em className={`status-${item.status}`}>{statusCopy[item.status]}</em></span>
                      <small>{isInbox ? `${employeeDisplayName(item.authorName)} · @${item.authorUsername}` : categories.find((entry) => entry.key === item.category)?.label}</small>
                      <time>{timeLabel(item.updatedAt)}</time>
                    </button>
                  ))}
                  {hasMore && <div className="support-load-more" ref={sentinel}><Button disabled={busy} onClick={() => loadMore(true)}>Показать ещё</Button><small>{shown} из {visibleRequests.length}</small></div>}
                  </div>
                </aside>

                <main className="support-main" ref={mainRef}>
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
                      {isInbox ? <p className="support-author">{employeeDisplayName(selected.authorName)} · @{selected.authorUsername}</p> : null}
                      <div className="support-message-list">
                        {selected.messages.map((message) => (
                          <article key={message.id} className={`support-message kind-${message.kind}`}>
                            <span><b>{employeeDisplayName(message.authorName)}</b><small>{messageKindCopy[message.kind]}</small><time>{timeLabel(message.createdAt)}</time></span>
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
