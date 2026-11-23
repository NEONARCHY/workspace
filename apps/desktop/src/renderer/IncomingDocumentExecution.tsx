import { lazy, Suspense, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { CheckmarkCircle20Regular, Clock20Regular, Document20Regular, DismissCircle20Regular, Send20Regular } from "@fluentui/react-icons";
import type { IncomingDocumentDetail, TaskReturnReason, TaskStatus, WorkspaceAttachment, WorkspacePerson } from "@yuksalish/contracts";
import { AttachmentPanel } from "./AttachmentPanel";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { ProfileAvatar } from "./ProfileAvatar";
import { TaskReturnDialog } from "./TaskReturnDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { acceptWorkspaceTaskResult, downloadWorkspaceAttachment, loadIncomingDocument, loadOfficeFilePreview, returnWorkspaceTaskForRevision, submitWorkspaceTaskResult, uploadWorkspaceAttachment } from "./workspace-api";
import { saveReferentBlob } from "./AIReferentFiles";
import { isTaskOverdue } from "./task-deadline";

const ExternalFileViewer = lazy(() => import("./FileViewer").then(module => ({ default: module.ExternalFileViewer })));
const labels: Readonly<Record<TaskStatus, string>> = {
  new: "Назначено", in_progress: "В работе", overdue: "В работе", awaiting_review: "На проверке",
  completed: "Исполнено", cancelled: "Отменено",
};
const returnReasons: Readonly<Record<string, string>> = {
  incomplete_result: "Результат неполный", requirements_not_met: "Требования не выполнены",
  corrections_required: "Нужны исправления", other: "Другая причина",
};

export function IncomingDocumentStatus({ status }: { readonly status?: TaskStatus }) {
  const Icon = status === "completed" ? CheckmarkCircle20Regular : status === "cancelled" ? DismissCircle20Regular
    : status === "awaiting_review" ? Send20Regular : status ? Clock20Regular : Document20Regular;
  return <span className={`incoming-status incoming-status--${status ?? "unassigned"}`}>
    <Icon aria-hidden="true" />{status ? labels[status] : "Без поручения"}
  </span>;
}

export function IncomingDocumentExecution({ token, detail, people, now, onSaved }: {
  readonly token: string; readonly detail: IncomingDocumentDetail; readonly people: readonly WorkspacePerson[];
  readonly now: number; readonly onSaved: (detail: IncomingDocumentDetail) => void;
}) {
  const execution = detail.document.execution;
  const data = detail.executionDetail;
  const [draft, setDraft] = useState(data?.resultText ?? "");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [returnOpen, setReturnOpen] = useState(false);
  const [preview, setPreview] = useState<WorkspaceAttachment>();
  const lock = useRef(false);
  if (!execution) return null;
  const locked = busy || uncertain;
  const refresh = async () => {
    const current = await loadIncomingDocument(token, detail.document.id);
    onSaved(current);
    return current;
  };
  // A failed write can have committed. Re-read explicitly before enabling another write.
  const mutate = async (action: () => Promise<unknown>) => {
    if (lock.current || uncertain) return false;
    lock.current = true; setBusy(true); setError("");
    try {
      await action();
      await refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить исполнение.");
      setUncertain(true);
      return false;
    } finally { lock.current = false; setBusy(false); }
  };
  const reconcile = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await refresh(); setUncertain(false); setError(""); setReturnOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось проверить состояние."); }
    finally { lock.current = false; setBusy(false); }
  };
  const person = (id: string, fallback: string) => {
    const found = people.find(item => item.id === id);
    return <span className="incoming-person" key={id}>
      {found ? <ProfileAvatar person={found} token={token} size={28} /> : null}<span>{found?.name ?? fallback}</span>
    </span>;
  };
  const phase = execution.status === "completed" ? 3 : execution.status === "awaiting_review" ? 2 : 1;
  const returnResult = (reason: TaskReturnReason, text: string) => mutate(() => returnWorkspaceTaskForRevision(token, execution.taskId, reason, text));
  return <section className="incoming-document-execution" aria-label="Исполнение письма" aria-busy={busy}>
    <div className="incoming-section-heading"><h3>Исполнение</h3><IncomingDocumentStatus status={execution.status} /></div>
    {execution.status !== "cancelled" ? <ol className="incoming-progress" aria-label="Этап исполнения">
      {["Назначено", "На проверке", "Исполнено"].map((label, index) => <li key={label} data-reached={phase >= index + 1}
        aria-current={phase === index + 1 ? "step" : undefined}><span aria-hidden="true">{phase > index + 1 ? "✓" : index + 1}</span>{label}</li>)}
    </ol> : null}
    <div className="incoming-responsibility">
      <div><small>Ответственный</small>{person(execution.assigneeId, execution.assigneeName)}</div>
      <div className={isTaskOverdue(execution, now) ? "incoming-deadline incoming-deadline--overdue" : "incoming-deadline"}>
        <small>Срок исполнения</small><strong>{(execution.dueAt ? new Date(execution.dueAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "Не указан")}</strong>
        {isTaskOverdue(execution, now) ? <span>Срок истёк</span> : null}
      </div>
    </div>
    {data?.coAssigneeIds.length ? <div className="incoming-coassignees"><small>Соисполнители</small>
      <div>{data.coAssigneeIds.map(id => person(id, "Сотрудник"))}</div></div> : null}
    {data ? <>
      <details className="incoming-instruction"><summary>Поручение и контекст</summary><p>{data.description}</p></details>
      {data.latestReturn && execution.status !== "completed" ? <WorkspaceNotice tone="warning">
        <strong>{returnReasons[data.latestReturn.reasonCode] ?? "Замечания к результату"}</strong>
        {data.latestReturn.reasonText ? <p>{data.latestReturn.reasonText}</p> : null}
      </WorkspaceNotice> : null}
      <section className="incoming-result" aria-label="Результат исполнения">
        <div className="incoming-section-heading"><h3>Результат исполнения</h3>
          {execution.status === "completed" ? <span className="incoming-result-caption">Принят постановщиком</span> : null}</div>
        {data.resultText ? <p className="incoming-result-text">{data.resultText}</p>
          : <p className="incoming-document-help">Результат ещё не представлен.</p>}
        {data.canSubmit ? <form className="incoming-result-form" onSubmit={event => {
          event.preventDefault(); if (draft.trim()) void mutate(() => submitWorkspaceTaskResult(token, execution.taskId, draft.trim()));
        }}>
          <label htmlFor={`incoming-result-${detail.document.id}`}>Отчёт об исполнении</label>
          <textarea id={`incoming-result-${detail.document.id}`} rows={4} maxLength={10000} required
            value={draft} disabled={locked} onChange={event => setDraft(event.target.value)} placeholder="Что сделано и какой результат получен" />
          <Button type="submit" appearance="primary" icon={<Send20Regular />} disabled={locked || !draft.trim()}>Отправить на проверку</Button>
        </form> : null}
        <AttachmentPanel title="Материалы исполнения" attachments={data.files} canUpload={data.canSubmit && !locked}
          onLoad={(file, signal) => downloadWorkspaceAttachment(token, file.id, signal)}
          onDownload={file => setPreview(file)} onUpload={async files => {
            await mutate(async () => { for (const file of files) await uploadWorkspaceAttachment(token, "task", execution.taskId, file); });
          }} />
        {data.canAccept || data.canReturn ? <div className="incoming-document-actions">
          {data.canAccept ? <Button appearance="primary" disabled={locked} icon={<CheckmarkCircle20Regular />}
            onClick={() => void mutate(() => acceptWorkspaceTaskResult(token, execution.taskId))}>Принять результат</Button> : null}
          {data.canReturn ? <Button disabled={locked} onClick={() => setReturnOpen(true)}>На доработку</Button> : null}
        </div> : null}
      </section>
    </> : <WorkspaceNotice>Для просмотра результата и материалов нужен доступ к поручению в разделе «Задачи».</WorkspaceNotice>}
    {error ? <WorkspaceNotice tone="error" actions={uncertain ? <Button disabled={busy} onClick={() => void reconcile()}>Проверить состояние</Button> : undefined}>
      {error}{uncertain ? " Проверьте состояние перед повторным действием. Введённый текст сохранён." : ""}
    </WorkspaceNotice> : null}
    <TaskReturnDialog open={returnOpen} taskTitle={detail.document.subject} onClose={() => setReturnOpen(false)} onSubmit={returnResult} />
    {preview ? <Suspense fallback={<LoadingSkeleton layout="rows" rows={3} label="Открываем материал" />}>
      <ExternalFileViewer attachment={preview} onClose={() => setPreview(undefined)}
        onLoad={(file, signal) => downloadWorkspaceAttachment(token, file.id, signal)}
        onLoadOffice={(file, sheet, offset, signal) => loadOfficeFilePreview(token, file.id, sheet, offset, signal)}
        onDownload={async file => saveReferentBlob(await downloadWorkspaceAttachment(token, file.id), file.fileName)} />
    </Suspense> : null}
  </section>;
}
