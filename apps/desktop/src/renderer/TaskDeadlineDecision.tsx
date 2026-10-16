import { useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import type { TaskDeadlineRequest, WorkspacePerson, WorkspaceTask } from "@yuksalish/contracts";
import { WorkspaceNotice } from "./WorkspaceNotice";

export function TaskDeadlineDecision({ task, request, people, canDecide, onDecide, onResolved }: {
  readonly task: WorkspaceTask;
  readonly request: TaskDeadlineRequest;
  readonly people: readonly WorkspacePerson[];
  readonly canDecide: boolean;
  readonly onDecide?: (task: WorkspaceTask, requestId: string, approved: boolean) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onResolved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const decide = async (approved: boolean) => {
    if (!onDecide || locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const updated = await onDecide(task, request.id, approved);
      if (updated) onResolved();
      else setError("Решение не сохранено. Обновите задачу и повторите попытку.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить решение.");
    } finally { locked.current = false; setBusy(false); }
  };
  return <section className="detail-section task-deadline-decision" aria-label="Запрос на перенос срока">
    <h3>Запрос на перенос срока</h3>
    <p><strong>{people.find((person) => person.id === request.requesterUserId)?.name ?? "Исполнитель"}</strong> просит изменить срок выполнения этой задачи.</p>
    <dl className="task-deadline-decision-dates">
      <div><dt>Текущий срок</dt><dd>{new Date(request.oldDueAt).toLocaleString("ru-RU")}</dd></div>
      <div><dt>Предлагаемый срок</dt><dd>{new Date(request.proposedDueAt).toLocaleString("ru-RU")}</dd></div>
    </dl>
    <p className="task-deadline-decision-reason">{request.reason}</p>
    {canDecide && onDecide ? <div className="task-editor-actions">
      <Button appearance="primary" disabled={busy} onClick={() => void decide(true)}>Согласовать перенос срока</Button>
      <Button appearance="secondary" disabled={busy} onClick={() => void decide(false)}>Отказать в переносе</Button>
    </div> : <p>Ожидает решения постановщика.</p>}
    {error ? <WorkspaceNotice tone="error" role="alert">{error}</WorkspaceNotice> : null}
  </section>;
}
