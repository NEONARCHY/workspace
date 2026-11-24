import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { LoadingSkeleton } from "./LoadingSkeleton";
import type { TaskHistoryEvent, TaskHistoryPage } from "@yuksalish/contracts";
import { Button } from "@fluentui/react-components";
import { loadTaskHistory } from "./workspace-api";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import "./task-history.css";

const labels: Readonly<Record<string, string>> = {
  incoming_received: "Письмо поступило", incoming_registered: "Зарегистрировано в источнике",
  incoming_added: "Добавлено в Workspace",
  task_created: "Задача поставлена", initial_snapshot: "Начало достоверного учёта",
  task_status_changed: "Статус изменён", assignee_changed: "Ответственный изменён",
  task_executors_changed: "Состав исполнителей изменён", deadline_changed: "Срок изменён",
  deadline_requested: "Запрошен перенос срока", deadline_approved: "Перенос срока одобрен",
  deadline_rejected: "Перенос срока отклонён", deadline_superseded: "Запрос переноса утратил актуальность",
  result_submitted_for_review: "Результат передан на проверку", result_accepted: "Результат принят",
  result_returned_for_revision: "Возвращено на доработку", task_completed: "Задача закрыта",
  task_reopened: "Задача возвращена в работу",
  task_cancelled: "Задача отменена", efficiency_excluded: "Исключена из эффективности",
  efficiency_exclusion_changed: "Правило учёта эффективности изменено",
};
const statuses: Readonly<Record<string, string>> = {
  new: "Новая", in_progress: "В работе", awaiting_review: "На проверке",
  completed: "Завершена", cancelled: "Отменена", overdue: "Просрочена",
};
const reasons: Readonly<Record<string, string>> = {
  corrections_required: "Нужны исправления", incomplete_result: "Результат неполный",
  requirements_not_met: "Требования не выполнены", other: "Другая причина",
  external_dependency: "Внешняя зависимость", requirements_changed: "Требования изменились",
  cancelled: "Задача отменена", duplicate: "Дубликат", historical_import: "Исторический импорт",
  author_review_required: "Отменено утверждение без постановщика",
};
function date(value?: string | null) {
  return value ? new Date(value).toLocaleString("ru-RU") : "Без срока";
}
function HistoryEntry({ event, letter }: { readonly event: TaskHistoryEvent; readonly letter: boolean }) {
  return <li><span className="task-history-dot" aria-hidden /><div>
    <strong>{letter && event.kind === "task_created" ? "Назначено исполнение"
      : letter && event.kind === "task_completed" ? "Исполнение завершено"
      : labels[event.kind] ?? "Изменение задачи"}</strong>
    <div className="task-history-byline"><time dateTime={event.occurredAt}>{date(event.occurredAt)}</time>
      {event.actorUserId ? <EmployeeProfileLink userId={event.actorUserId} personName={event.actorName ?? "Сотрудник"}>{event.actorName ?? "Сотрудник"}</EmployeeProfileLink> : <span>{event.kind === "incoming_received" || event.kind === "incoming_registered" ? "Источник письма" : "Система"}</span>}</div>
    {event.oldDueAt || event.dueAt ? <p>{["deadline_requested", "deadline_rejected", "deadline_superseded"].includes(event.kind) ? "Предложенный срок" : "Срок"}: {event.oldDueAt ? `${date(event.oldDueAt)} → ` : ""}{date(event.dueAt)}</p> : null}
    {event.status ? <p>{event.oldStatus ? `${statuses[event.oldStatus] ?? event.oldStatus} → ` : ""}{statuses[event.status] ?? event.status}</p> : null}
    {event.reasonCode ? <p>{reasons[event.reasonCode] ?? event.reasonCode}</p> : null}
    {event.reason ? <p className="task-history-reason">{event.reason}</p> : null}
  </div></li>;
}

export function TaskHistory({ token, taskId, revision, variant = "task", sourceEvents = [] }: {
  readonly token?: string; readonly taskId?: string; readonly revision: object;
  readonly variant?: "task" | "letter";
  readonly sourceEvents?: readonly TaskHistoryEvent[];
}) {
  const letter = variant === "letter";
  const [expanded, setOpen] = useState(false);
  const open = letter || expanded;
  const contentId = useId();
  const disclosureRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const disclosure = disclosureRef.current, content = contentRef.current;
    if (!disclosure || !content) return;
    // Only this requested disclosure animates layout. Measure content changes
    // (including the async history response), not every animation frame.
    const measure = () => { disclosure.style.height = open ? `${content.getBoundingClientRect().height}px` : "0px"; };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [open]);
  const [request, setRequest] = useState({ revision, offset: 0, retry: 0 });
  const [result, setResult] = useState<{
    request: typeof request; taskId?: string; token: string;
    page?: TaskHistoryPage; error: string;
  }>();
  if (request.revision !== revision) setRequest({ revision, offset: 0, retry: request.retry });
  const sameScope = result !== undefined && result.taskId === taskId && result.token === token;
  const page = sameScope ? result.page : undefined;
  const pending = Boolean(open && taskId && token && (!sameScope || result?.request !== request));
  const error = sameScope && result?.request === request ? result.error : "";
  useEffect(() => {
    if (!open || !token || !taskId) return;
    let active = true;
    void loadTaskHistory(token, taskId, request.offset).then(next => {
      if (!active) return;
      setResult(previous => ({ request, taskId, token, error: "", page:
        request.offset === 0 || !previous?.page || previous.taskId !== taskId || previous.token !== token ? next : {
          ...next, events: [...new Map([...previous.page.events, ...next.events].map(event => [event.id, event])).values()],
        },
      }));
    }).catch(() => {
      if (active) setResult(previous => ({ request, taskId, token,
        page: previous?.taskId === taskId && previous.token === token ? previous.page : undefined,
        error: letter ? "Не удалось загрузить историю исполнения. Попробуйте ещё раз."
          : "Не удалось загрузить маршрут задачи. Попробуйте ещё раз." }));
    });
    return () => { active = false; };
  }, [open, token, taskId, request, letter]);
  const events = [...new Map([...(page?.events ?? []), ...sourceEvents].map(event => [event.id, event])).values()]
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  return <section className={`detail-section task-history-section${letter ? " incoming-document-activity" : ""}`} aria-label={letter ? "Активность письма" : "Маршрут и история задачи"}>
    {letter ? <h3>Активность письма</h3> : <Button appearance="subtle" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(value => !value)}>Маршрут и история</Button>}
    <div ref={letter ? undefined : disclosureRef} id={contentId} className={letter ? undefined : "task-history-disclosure"} data-open={open} aria-hidden={!open} inert={!open}><div ref={letter ? undefined : contentRef} className="task-history-content">
      {taskId && !token ? <p>История доступна после подключения к серверу.</p> : null}
      {page && !page.historyComplete ? <p className="task-history-note">Ранние действия могли не фиксироваться. Ниже — только сохранённые события; дата создания известна из карточки.</p> : null}
      {events.length ? <ol className="task-history-list">{events.map(event => <HistoryEntry key={event.id} event={event} letter={letter} />)}</ol> : !taskId ? <p className="task-history-note">События письма пока не переданы.</p> : null}
      {pending && !page ? <LoadingSkeleton layout="rows" rows={3} label={letter ? "Загружаем историю исполнения…" : "Загружаем маршрут…"} /> : null}
      {error ? <p role="alert">{error} <Button appearance="subtle" onClick={() => setRequest(value => ({ ...value, retry: value.retry + 1 }))}>Повторить</Button></p> : null}
      {!pending && !error && page?.nextOffset != null ? <Button appearance="subtle" onClick={() => setRequest(value => ({ ...value, offset: page.nextOffset ?? 0 }))}>Показать более ранние события</Button> : null}
      {page && !pending ? <Button appearance="subtle" onClick={() => setRequest(value => ({ ...value, offset: 0, retry: value.retry + 1 }))}>{letter ? "Обновить активность" : "Обновить маршрут"}</Button> : null}
    </div></div>
  </section>;
}
