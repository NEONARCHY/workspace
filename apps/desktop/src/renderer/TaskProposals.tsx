import { useEffect, useRef, useState } from "react";
import type { TaskProposal, WorkspacePerson, WorkspaceTask } from "@yuksalish/contracts";
import { Button, DialogSurface, Textarea } from "@fluentui/react-components";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { RecordSection } from "./RecordComposer";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { decideTaskProposal, loadTaskProposals } from "./workspace-api";

const labels: Record<TaskProposal["status"], string> = {
  pending: "Ожидает подтверждения", approved: "Постановка подтверждена",
  rejected: "Отклонена", cancelled: "Отозвана",
};
const priorityLabels = { low: "Низкий", normal: "Обычный", high: "Высокий", urgent: "Срочный" };
const dateLabel = (date?: string | null) => date ? new Date(date).toLocaleString("ru-RU") : "Без срока";

export function TaskProposals({ token, currentUserId, people, tasks, revision, focusId, onRefresh, onOpenTask }: {
  readonly token: string;
  readonly currentUserId: string;
  readonly people: readonly WorkspacePerson[];
  readonly tasks: readonly WorkspaceTask[];
  readonly revision: number;
  readonly focusId?: string;
  readonly onRefresh?: () => Promise<void>;
  readonly onOpenTask: (id: string) => void;
}) {
  const [proposals, setProposals] = useState<readonly TaskProposal[]>([]);
  const [selectedId, setSelectedId] = useState(focusId ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const requestSequence = useRef(0);
  useEffect(() => {
    let active = true;
    const sequence = ++requestSequence.current;
    void loadTaskProposals(token).then((items) => {
      if (active && sequence === requestSequence.current) { setProposals(items); setLoaded(true); setError(""); }
    }).catch((cause: unknown) => {
      if (active && sequence === requestSequence.current) { setLoaded(true); setError(cause instanceof Error ? cause.message : "Не удалось загрузить заявки"); }
    });
    return () => { active = false; };
  }, [token, tasks, revision, retry]);
  const selected = proposals.find((item) => item.id === selectedId);
  const person = (id: string) => people.find((item) => item.id === id)?.name ?? "Сотрудник";
  const pending = proposals.filter((item) => item.status === "pending");
  const decide = async (action: "approve" | "reject" | "cancel") => {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try {
      const updated = await decideTaskProposal(token, selected.id, action, reason);
      ++requestSequence.current;
      setProposals((items) => items.map((item) => item.id === updated.id ? updated : item));
      setReason("");
      if (onRefresh) {
        try { await onRefresh(); }
        catch { setError("Решение сохранено. Не удалось обновить список задач — обновите раздел."); }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить решение");
    } finally { setBusy(false); }
  };
  return <section className="record-section task-proposals" aria-label="Заявки на постановку задач">
    <details open={Boolean(focusId && proposals.some((item) => item.id === focusId))}>
      <summary>Заявки на постановку · {pending.length} ожидают подтверждения</summary>
      <p>Входящие заявки и ваши предложения. До подтверждения это не рабочие задачи.</p>
      {!loaded ? <p role="status">Загружаем заявки…</p> : !proposals.length ? <p>Заявок пока нет.</p> : null}
      <div className="task-composer-dependencies">{proposals.map((item) => <div key={item.id}>
        <span><strong>{item.task.title}</strong><small>{labels[item.status]} · {person(item.creatorUserId)} → {person(item.authorUserId)}</small></span>
        <Button onClick={() => { setSelectedId(item.id); setReason(""); setError(""); }}>Открыть заявку</Button>
      </div>)}</div>
    </details>
    {error ? <WorkspaceNotice tone="error" role="alert" actions={<Button onClick={() => setRetry((value) => value + 1)}>Обновить заявки</Button>}>{error}</WorkspaceNotice> : null}
    <WorkspaceDialog open={Boolean(selected)} onOpenChange={(_, data) => { if (!data.open && !busy) setSelectedId(""); }}>
      <DialogSurface className="record-composer-dialog" aria-label="Заявка на постановку задачи">
        {selected ? <div className="record-composer">
          <header className="record-composer-header"><div><span className="record-eyebrow">{labels[selected.status]}</span><h2>{selected.task.title}</h2></div>
            <Button disabled={busy} onClick={() => setSelectedId("")}>Закрыть заявку</Button></header>
          <div className="record-composer-body"><div className="record-composer-fields">
            <RecordSection title="Постановка">
              <dl className="record-summary-facts">
                <div><dt>Подготовил и будет исполнять</dt><dd>{person(selected.creatorUserId)}</dd></div>
                <div><dt>Постановщик после одобрения</dt><dd>{person(selected.authorUserId)}</dd></div>
                <div><dt>Отправлено</dt><dd>{dateLabel(selected.createdAt)}</dd></div>
                <div><dt>Срок</dt><dd>{dateLabel(selected.task.dueAt)}</dd></div>
                <div><dt>Приоритет</dt><dd>{priorityLabels[selected.task.priority ?? "normal"]}</dd></div>
                <div><dt>Проект</dt><dd>{selected.task.project ?? "Без проекта"}</dd></div>
              </dl>
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{selected.task.description || "Описание не добавлено."}</p>
            </RecordSection>
            <RecordSection title="Участники">
              {selected.task.participants?.length ? <ul>{selected.task.participants.map((item) => <li key={item.userId}>
                {person(item.userId)} · {item.role === "co_assignee" ? "Соисполнитель" : "Наблюдатель"}
              </li>)}</ul> : <p>Дополнительных участников нет.</p>}
            </RecordSection>
            <RecordSection title="План выполнения">
              {selected.task.checklist?.length ? <ol>{selected.task.checklist.map((item, index) => <li key={index}>{item.title}</li>)}</ol> : <p>Чек-лист не добавлен.</p>}
            </RecordSection>
            <RecordSection title="Зависимости">
              {selected.task.dependencies?.length ? <ul>{selected.task.dependencies.map((item) => <li key={item.dependsOnTaskId}>
                {tasks.find((task) => task.id === item.dependsOnTaskId)?.title ?? "Связанная задача"} · {item.dependencyKind === "blocks" ? "Блокирует" : "Связана"}
              </li>)}</ul> : <p>Зависимостей нет.</p>}
            </RecordSection>
            <RecordSection title="Повторение">
              {selected.task.cycle ? <>
                <p>{({ daily: "Дни", weekly: "Недели", monthly: "Месяцы", calendar: "Календарное правило" })[selected.task.cycle.scheduleKind]} · интервал {selected.task.cycle.interval}</p>
                <p>Ближайший запуск: {selected.task.cycle.nextRunAt ? dateLabel(selected.task.cycle.nextRunAt) : "Рассчитается после одобрения"} · {selected.task.cycle.timezone ?? "Asia/Tashkent"}</p>
                {selected.task.cycle.scheduleKind === "calendar" ? <p>{selected.task.cycle.calendarRule === "weekdays"
                  ? (selected.task.cycle.weekdays ?? []).map((day) => ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][day]).join(", ")
                  : (selected.task.cycle.monthDays ?? []).join(", ")}</p> : null}
              </> : <p>Не повторяется.</p>}
            </RecordSection>
            {selected.status === "pending" && selected.authorUserId === currentUserId ? <RecordSection title="Решение постановщика">
              <p>Подтверждая, вы ставите эту задачу от своего имени со всеми указанными условиями.</p>
              <Textarea aria-label="Причина отклонения заявки" placeholder="Причина обязательна для отклонения" value={reason} disabled={busy} onChange={(_, data) => setReason(data.value)} />
            </RecordSection> : null}
            {selected.reason ? <RecordSection title="Причина решения"><p>{selected.reason}</p></RecordSection> : null}
          </div></div>
          <footer className="record-composer-footer">
            {error ? <WorkspaceNotice tone="error" role="alert">{error}</WorkspaceNotice> : null}
            <span>{selected.decidedAt ? `Решение: ${dateLabel(selected.decidedAt)}` : "Пока не подтверждено, не учитывается в эффективности."}</span>
            <div>{selected.status === "pending" ? selected.authorUserId === currentUserId ? <>
              <Button disabled={busy || !reason.trim()} onClick={() => void decide("reject")}>Отклонить</Button>
              <Button appearance="primary" disabled={busy} onClick={() => void decide("approve")}>Подтвердить постановку</Button>
            </> : <Button disabled={busy} onClick={() => void decide("cancel")}>Отозвать заявку</Button> : null}
            {selected.taskId && tasks.some((task) => task.id === selected.taskId) ? <Button onClick={() => { onOpenTask(selected.taskId!); setSelectedId(""); }}>Открыть задачу</Button> : null}</div>
          </footer>
        </div> : null}
      </DialogSurface>
    </WorkspaceDialog>
  </section>;
}
