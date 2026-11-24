import { useId, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import type { GrantAction, GrantDeadlineRequest, GrantDetail, WorkspacePerson } from "@yuksalish/contracts";
import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";
import { WorkspaceNotice } from "./WorkspaceNotice";

const labels: Readonly<Record<GrantDeadlineRequest["status"], string>> = {
  pending: "Ожидает решения", approved: "Одобрено", rejected: "Отклонено", superseded: "Больше не актуален",
};
function date(value: string) {
  return new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}
function minimumDate(value: string, now: number) {
  const minimum = new Date(Math.max(now, Date.parse(value)));
  return `${minimum.getFullYear()}-${String(minimum.getMonth() + 1).padStart(2, "0")}-${String(minimum.getDate()).padStart(2, "0")}`;
}
type FormAction = "extend_deadline" | "request_deadline" | "reject_deadline";

export function GrantDeadlinePanel({ detail, people, busy, now, onPerform }: {
  readonly detail: GrantDetail;
  readonly people: readonly WorkspacePerson[];
  readonly busy: boolean;
  readonly now: number;
  readonly onPerform: (action?: GrantAction) => Promise<GrantDetail>;
}) {
  const [form, setForm] = useState<{ action: FormAction; revision: number; requestId?: string }>();
  const [dueAt, setDueAt] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const submitting = useRef(false);
  const reasonHelpId = useId();
  const pending = detail.pendingDeadlineRequest;
  const expired = Boolean(pending && Date.parse(pending.dueAt) <= now);
  const history = detail.deadlineRequests?.filter(request => request.status !== "pending") ?? [];
  const can = (action: string) => detail.allowedActions.includes(action);
  const person = (id: string) => people.find(item => item.id === id)?.name ?? "Сотрудник недоступен";
  const open = (action: FormAction) => {
    setForm({ action, revision: detail.revision, requestId: pending?.id });
    setDueAt(""); setReason(""); setError("");
  };
  const perform = async (action?: GrantAction) => {
    if (busy || submitting.current) return;
    submitting.current = true; setError("");
    try {
      const saved = await onPerform(action);
      setUncertain(false);
      if (action) { setForm(undefined); setDueAt(""); setReason(""); }
      else setForm(current => current && (current.action !== "reject_deadline" || saved.pendingDeadlineRequest?.id === current.requestId)
        ? { ...current, revision: saved.revision } : undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить действие.");
      setUncertain(true);
    } finally { submitting.current = false; }
  };
  if (!pending && !history.length && !can("extend_deadline") && !can("request_deadline")) return null;
  const stale = Boolean(form && form.revision !== detail.revision);
  const allowed = Boolean(form && can(form.action));
  const validDate = form?.action === "reject_deadline" || (Number.isFinite(Date.parse(dueAt))
    && Date.parse(dueAt) > Math.max(now, Date.parse(detail.dueAt)));
  return <section className="grant-section grant-deadline-panel" aria-label="Срок и продление">
    <div className="grant-deadline-heading"><div><h3>Срок и продление</h3><p>Текущий срок: <strong>{date(detail.dueAt)}</strong></p></div>
      {!form && !uncertain && <div className="grants-actions">
        {can("extend_deadline") ? <Button disabled={busy} onClick={() => open("extend_deadline")}>Продлить срок</Button>
          : can("request_deadline") ? <Button disabled={busy} onClick={() => open("request_deadline")}>Запросить продление</Button> : null}
      </div>}
    </div>
    {pending && <div className="grant-deadline-request">
      <span className="grants-status">Запрос ожидает решения</span>
      <p>{person(pending.requestedByUserId)} · <time dateTime={pending.createdAt}>{date(pending.createdAt)}</time></p>
      <dl className="grant-deadline-dates"><div><dt>Текущий срок</dt><dd>{date(detail.dueAt)}</dd></div>
        <div><dt>Предлагаемый срок</dt><dd>{date(pending.dueAt)}</dd></div></dl>
      <p className="grants-preserve">{pending.reason}</p>
      {expired && <WorkspaceNotice tone="warning">Предложенный срок уже истёк; одобрить его нельзя.</WorkspaceNotice>}
      {!form && !uncertain && <div className="grants-actions">
        {can("approve_deadline") && <Button appearance="primary" disabled={busy || expired} onClick={() => void perform({
          action: "approve_deadline", expectedRevision: detail.revision, requestId: pending.id,
        })}>Одобрить продление</Button>}
        {can("reject_deadline") && <Button disabled={busy} onClick={() => open("reject_deadline")}>Отклонить запрос</Button>}
      </div>}
    </div>}
    {form && <form className="grant-deadline-form" aria-label={form.action === "extend_deadline" ? "Продление срока" : form.action === "request_deadline" ? "Запрос продления" : "Отклонение запроса"}
      onSubmit={event => {
        event.preventDefault();
        if (!allowed || !validDate || reason.trim().length < 3 || uncertain || stale) return;
        if (form.action !== "reject_deadline" && Date.parse(dueAt) <= Date.now()) {
          setError("Укажите будущий срок."); return;
        }
        void perform({ action: form.action, expectedRevision: form.revision, text: reason.trim(),
          ...(form.action === "reject_deadline" ? { requestId: form.requestId } : { dueAt: new Date(dueAt).toISOString() }),
        });
      }}>
      {form.action !== "reject_deadline" && <div><span>Новый срок *</span>
        <WorkspaceDateTimePicker ariaLabel="Новый срок гранта" value={dueAt} onChange={setDueAt} min={minimumDate(detail.dueAt, now)} disabled={busy || uncertain || stale} required />
        <small>Выберите будущую дату позже текущего срока.</small></div>}
      <label><span>{form.action === "reject_deadline" ? "Причина отклонения *" : "Причина продления *"}</span>
        <textarea rows={3} minLength={3} maxLength={2000} aria-describedby={reasonHelpId} value={reason} onChange={event => setReason(event.target.value)} disabled={busy || uncertain || stale} required /></label>
      <small id={reasonHelpId}>Не менее 3 символов.</small>
      {!allowed && <WorkspaceNotice tone="warning">Действие больше недоступно. Обновите состояние заявки.</WorkspaceNotice>}
      {stale && <WorkspaceNotice tone="warning">Заявка изменилась. Проверьте состояние перед отправкой; введённая причина сохранена.</WorkspaceNotice>}
      <div className="grants-actions"><Button type="submit" appearance="primary" disabled={busy || !allowed || !validDate || reason.trim().length < 3 || uncertain || stale}>
        {form.action === "extend_deadline" ? "Подтвердить продление" : form.action === "request_deadline" ? "Отправить запрос" : "Подтвердить отклонение"}
      </Button><Button disabled={busy} onClick={() => { setForm(undefined); setError(""); }}>Отмена</Button></div>
    </form>}
    {error && <WorkspaceNotice tone="error" role="alert">{error}</WorkspaceNotice>}
    {(uncertain || stale || (form && !allowed)) && <Button disabled={busy} onClick={() => void perform()}>Проверить состояние</Button>}
    {history.length > 0 && <details className="grant-deadline-history"><summary>История запросов · {history.length}</summary>
      <ol>{history.map(request => <li key={request.id}><strong>{labels[request.status]}</strong>
        <p>{person(request.requestedByUserId)} · {date(request.createdAt)}</p>
        <p>Предложено: {date(request.oldDueAt)} → {date(request.dueAt)}</p><p className="grants-preserve">{request.reason}</p>
        {request.decidedByUserId && request.decidedAt && <small>{person(request.decidedByUserId)} · {date(request.decidedAt)}</small>}
        {request.decisionReason && <p className="grants-preserve">{request.decisionReason}</p>}
      </li>)}</ol></details>}
  </section>;
}
