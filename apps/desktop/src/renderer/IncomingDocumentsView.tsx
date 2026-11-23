import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import type { IncomingDocument, IncomingDocumentDetail, IncomingDocumentFile, IncomingDocumentFilter, IncomingDocumentPage, TaskStatus, WorkspacePerson } from "@yuksalish/contracts";
import { Input } from "./WorkspaceInput";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { PersonPicker } from "./PersonPicker";
import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";
import { assignIncomingDocument, downloadIncomingDocumentFile, loadIncomingDocument, loadIncomingDocuments, previewIncomingDocumentFile } from "./workspace-api";
import { saveReferentBlob } from "./AIReferentFiles";
import { ProfileAvatar } from "./ProfileAvatar";
import { isTaskOverdue } from "./task-deadline";
import { useTaskDeadlineClock } from "./useTaskDeadlineClock";
import "./incoming-documents.css";

const ExternalFileViewer = lazy(() => import("./FileViewer").then(module => ({ default: module.ExternalFileViewer })));
const statusNames: Readonly<Record<TaskStatus, string>> = {
  new: "Назначено", in_progress: "В работе", overdue: "Просрочено", awaiting_review: "На проверке",
  completed: "Исполнено", cancelled: "Отменено",
};
const filters: Readonly<Record<IncomingDocumentFilter, string>> = {
  all: "Все письма", unassigned: "Без поручения", active: "На исполнении", review: "На проверке",
  completed: "Исполненные", overdue: "Просроченные",
};

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "Не указан";
}

function errorLabel(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось загрузить данные.";
}

function DocumentViewer({ token, documentId, file, onClose }: {
  readonly token: string; readonly documentId: string; readonly file: IncomingDocumentFile; readonly onClose: () => void;
}) {
  const attachment = { id: file.id, fileName: file.name.split("/").at(-1) || file.name,
    byteSize: file.byteSize, contentType: "application/octet-stream" };
  return <Suspense fallback={<LoadingSkeleton layout="rows" rows={3} label="Открываем документ" />}>
    <ExternalFileViewer attachment={attachment} onClose={onClose}
      onLoad={(_file, signal) => downloadIncomingDocumentFile(token, documentId, file.id, signal)}
      onLoadOffice={(_file, sheet, offset, signal) => previewIncomingDocumentFile(token, documentId, file.id, sheet, offset, signal)}
      onDownload={async () => saveReferentBlob(await downloadIncomingDocumentFile(token, documentId, file.id), attachment.fileName)} />
  </Suspense>;
}

function AssignmentForm({ token, detail, people, onSaved, onRefreshed, onCancel }: {
  readonly token: string; readonly detail: IncomingDocumentDetail; readonly people: readonly WorkspacePerson[];
  readonly onSaved: (detail: IncomingDocumentDetail) => void; readonly onCancel: () => void;
  readonly onRefreshed: (detail: IncomingDocumentDetail) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [coAssigneeIds, setCoAssigneeIds] = useState<readonly string[]>([]);
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [reconcile, setReconcile] = useState(false);
  const [error, setError] = useState("");
  const operationId = useRef<string | null>(null);
  const submitting = useRef(false);
  const locked = busy || reconcile || !detail.document.canAssign;
  const available = people.filter(person => person.status === "active");
  const checkState = async () => {
    setBusy(true);
    try {
      const current = await loadIncomingDocument(token, detail.document.id);
      if (current.document.execution) {
        onSaved(current);
      } else {
        onRefreshed(current);
        setReconcile(false); setError(""); operationId.current = null;
      }
    } catch (reason) { setError(errorLabel(reason)); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (submitting.current || locked || !instruction.trim() || !assigneeId || !dueAt) return;
    submitting.current = true; setBusy(true); setError("");
    operationId.current ??= crypto.randomUUID();
    try {
      onSaved(await assignIncomingDocument(token, detail.document.id, {
        operationId: operationId.current, expectedRevision: detail.document.revision,
        instruction: instruction.trim(), assigneeId, coAssigneeIds, fileIds: detail.files.map(file => file.id),
        dueAt: new Date(dueAt).toISOString(),
      }));
    } catch (reason) { setError(errorLabel(reason)); setReconcile(true); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <form className="incoming-document-assignment" aria-label="Назначение исполнения"
    onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3>Поручение по письму</h3>
    <label htmlFor="incoming-instruction">Что нужно сделать</label>
    <textarea id="incoming-instruction" value={instruction} disabled={locked} required maxLength={10_000}
      rows={4} onChange={event => setInstruction(event.target.value)} />
    <div className="incoming-document-field"><span>Основной исполнитель</span>
      <PersonPicker people={available} token={token} value={assigneeId} label="Основной исполнитель" disabled={locked}
        onChange={id => { setAssigneeId(id); setCoAssigneeIds(current => current.filter(value => value !== id)); }} />
    </div>
    <PersonPicker people={available.filter(person => person.id !== assigneeId && !coAssigneeIds.includes(person.id))}
      token={token} value="" label="Добавить соисполнителя" emptyLabel="Добавить соисполнителя" disabled={locked}
      onChange={id => setCoAssigneeIds(current => [...current, id])} />
    {coAssigneeIds.length ? <ul className="incoming-document-participants" aria-label="Соисполнители">
      {coAssigneeIds.map(id => <li key={id}><span>{people.find(person => person.id === id)?.name ?? "Сотрудник"}</span>
        <Button appearance="subtle" disabled={locked} aria-label={`Убрать соисполнителя ${people.find(person => person.id === id)?.name ?? "Сотрудник"}`}
          onClick={() => setCoAssigneeIds(current => current.filter(value => value !== id))}>Убрать</Button></li>)}
    </ul> : null}
    <div className="incoming-document-field"><span>Срок исполнения</span>
      <WorkspaceDateTimePicker value={dueAt} onChange={setDueAt} ariaLabel="Срок исполнения" required disabled={locked} />
    </div>
    <p className="incoming-document-help">После подтверждения будет создано поручение. Перечисленные выше документы скопируются в его карточку.</p>
    {!detail.document.canAssign ? <WorkspaceNotice tone="warning">Назначение этого письма больше недоступно. Введённый текст сохранён в форме.</WorkspaceNotice> : null}
    {error ? <WorkspaceNotice tone="error" actions={reconcile ? <Button disabled={busy} onClick={() => void checkState()}>Проверить состояние</Button> : undefined}>{error}</WorkspaceNotice> : null}
    <div className="incoming-document-actions">
      <Button appearance="primary" type="submit" disabled={locked || !instruction.trim() || !assigneeId || !dueAt}>Создать поручение</Button>
      <Button disabled={busy || reconcile} onClick={onCancel}>Отмена</Button>
    </div>
  </form>;
}

function DocumentCard({ token, detail, people, now, onSaved, onOpenTask }: {
  readonly token: string; readonly detail: IncomingDocumentDetail; readonly people: readonly WorkspacePerson[];
  readonly onSaved: (detail: IncomingDocumentDetail) => void; readonly onOpenTask?: (taskId: string) => Promise<void>;
  readonly now: number;
}) {
  const [assigning, setAssigning] = useState(false);
  const [preview, setPreview] = useState<IncomingDocumentFile>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const document = detail.document;
  const execution = document.execution;
  const assignee = people.find(person => person.id === execution?.assigneeId);
  const openTask = async () => {
    if (!execution || !onOpenTask) return;
    setBusy(true); setError("");
    try { await onOpenTask(execution.taskId); }
    catch (reason) { setError(errorLabel(reason)); }
    finally { setBusy(false); }
  };
  return <article className="incoming-document-card" aria-label={`Письмо № ${document.number}`}>
    <span className="incoming-document-eyebrow">Входящее № {document.number}</span>
    <h2>{document.subject}</h2><p>{document.sender || "Отправитель не указан"}</p>
    <dl><div><dt>Получено</dt><dd>{dateLabel(document.receivedAt)}</dd></div>
      <div><dt>Канал</dt><dd>{document.source === "exat" ? "E-XAT" : document.source === "webmail" ? "Электронная почта" : "Импорт"}</dd></div></dl>
    <h3>Документы письма</h3>
    {detail.files.length ? <ul className="incoming-document-files">{detail.files.map(file => <li key={file.id}>
      <span>{file.name.split("/").at(-1)}<small>{Math.max(1, Math.round(file.byteSize / 1024))} КБ</small></span>
      <Button onClick={() => setPreview(file)} aria-label={`Открыть ${file.name.split("/").at(-1)}`}>Открыть</Button>
    </li>)}</ul> : <WorkspaceNotice tone={document.filesExpected ? "warning" : "info"}>
      {document.filesExpected ? "Оригиналы ещё не переданы референтом. Обновите карточку после загрузки файлов." : "Вложения к этому письму не переданы."}
    </WorkspaceNotice>}
    {execution ? <section className="incoming-document-execution" aria-label="Исполнение письма">
      <h3>Исполнение</h3><strong>{statusNames[execution.status]}</strong>
      <div className="incoming-document-assignee">{assignee ? <ProfileAvatar person={assignee} token={token} size={32} /> : null}
        <span>{execution.assigneeName}</span></div>
      <p>Срок: {dateLabel(execution.dueAt)}{isTaskOverdue(execution, now) ? " · Срок истёк" : ""}</p>
      <p className="incoming-document-help">Соисполнители, отчёт с файлами и решение по результату доступны в карточке поручения.</p>
      {document.canOpenTask && onOpenTask ? <Button appearance="primary" disabled={busy} onClick={() => void openTask()}>Открыть поручение</Button>
        : <WorkspaceNotice>Для открытия поручения нужен доступ к задачам.</WorkspaceNotice>}
    </section> : assigning ? <AssignmentForm token={token} detail={detail} people={people}
      onSaved={next => { setAssigning(false); onSaved(next); }} onRefreshed={onSaved} onCancel={() => setAssigning(false)} />
      : <section className="incoming-document-execution"><h3>Исполнение пока не назначено</h3>
        {document.canAssign ? <Button appearance="primary" disabled={document.filesExpected && !detail.files.length}
          onClick={() => setAssigning(true)}>Назначить исполнение</Button>
          : <p className="incoming-document-help">Назначение доступно сотруднику с правами на это письмо и создание поручений.</p>}
      </section>}
    {error ? <WorkspaceNotice tone="error">{error}</WorkspaceNotice> : null}
    {preview ? <DocumentViewer token={token} documentId={document.id} file={preview} onClose={() => setPreview(undefined)} /> : null}
  </article>;
}

export function IncomingDocumentsView({ token, people, onOpenTask }: {
  readonly token: string; readonly people: readonly WorkspacePerson[]; readonly onOpenTask?: (taskId: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<IncomingDocumentFilter>("all");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<IncomingDocumentPage>();
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<IncomingDocumentDetail>();
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const executions = useMemo(() => page?.documents.flatMap(document => document.execution ? [document.execution] : []) ?? [], [page]);
  const now = useTaskDeadlineClock(executions);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search.trim() !== query) { setLoading(true); setQuery(search.trim()); setOffset(0); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, query]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void loadIncomingDocuments(token, query, filter, offset, controller.signal)
      .then(next => { if (active) { setPage(next); setError(""); } })
      .catch(reason => { if (active) { setPage(undefined); setError(errorLabel(reason)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [token, query, filter, offset, revision]);
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    let active = true;
    void loadIncomingDocument(token, selectedId, controller.signal)
      .then(next => { if (active) { setDetail(next); setDetailError(""); } })
      .catch(reason => { if (active) { setDetail(undefined); setDetailError(errorLabel(reason)); } })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [token, selectedId, detailRevision]);
  const refresh = useCallback(() => {
    setLoading(true); setRevision(current => current + 1);
    if (selectedId) { setDetailLoading(true); setDetailRevision(current => current + 1); }
  }, [selectedId]);
  const select = (document: IncomingDocument) => {
    if (document.id === selectedId) return;
    setDetail(undefined); setDetailError(""); setDetailLoading(true); setSelectedId(document.id);
  };
  return <section className="incoming-documents" aria-label="Документооборот Workspace">
    <header className="incoming-documents-header"><div><span className="incoming-document-eyebrow">Документооборот · поручения</span>
      <h1>Входящие письма</h1><p>Письма референта, исполнители и контроль сроков.</p></div>
      <Button disabled={loading || detailLoading} onClick={refresh}>Обновить</Button></header>
    <div className="incoming-documents-controls">
      <label>Поиск по письмам<Input value={search} placeholder="Номер, тема или отправитель" onChange={event => setSearch(event.target.value)} /></label>
      <label>Исполнение<WorkspaceSelect value={filter} onChange={event => { setFilter(event.target.value as IncomingDocumentFilter); setOffset(0); setLoading(true); }}>
        {Object.entries(filters).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </WorkspaceSelect></label>
      <span className="incoming-document-count" aria-live="polite">{page ? `Найдено: ${page.total}` : "—"}</span>
    </div>
    <div className="incoming-documents-body">
      <div className="incoming-documents-list" aria-busy={loading}>
        {loading ? <LoadingSkeleton layout="rows" rows={5} label="Загружаем письма" />
          : error ? <WorkspaceNotice tone="error" actions={<Button onClick={refresh}>Повторить</Button>}>{error}</WorkspaceNotice>
            : page?.documents.length ? page.documents.map(document => <button type="button" className="incoming-document-row"
              key={document.id} aria-pressed={document.id === selectedId} onClick={() => select(document)}>
              <span className="incoming-document-row-meta"><strong>№ {document.number}</strong><span>{document.execution ? statusNames[document.execution.status] : "Без поручения"}</span></span>
              <strong>{document.subject}</strong><span>{document.sender || "Отправитель не указан"}</span>
              {document.execution ? <small>{document.execution.assigneeName} · {dateLabel(document.execution.dueAt)}{isTaskOverdue(document.execution, now) ? " · Срок истёк" : ""}</small> : null}
            </button>) : <p className="incoming-document-empty">Писем по выбранным условиям нет.</p>}
        {page && page.total > page.limit ? <nav className="incoming-document-actions" aria-label="Страницы входящих писем">
          <Button disabled={loading || offset === 0} onClick={() => { setLoading(true); setOffset(current => Math.max(0, current - page.limit)); }}>Назад</Button>
          <span>{Math.floor(offset / page.limit) + 1} / {Math.max(1, Math.ceil(page.total / page.limit))}</span>
          <Button disabled={loading || offset + page.limit >= page.total} onClick={() => { setLoading(true); setOffset(current => current + page.limit); }}>Далее</Button>
        </nav> : null}
      </div>
      <div className="incoming-documents-detail" aria-busy={detailLoading}>
        {detailLoading ? <LoadingSkeleton layout="rows" rows={6} label="Открываем письмо" />
          : detailError ? <WorkspaceNotice tone="error" actions={<Button onClick={refresh}>Повторить</Button>}>{detailError}</WorkspaceNotice>
            : detail ? <DocumentCard key={detail.document.id} token={token} detail={detail} people={people} now={now} onOpenTask={onOpenTask}
              onSaved={next => { setDetail(next); setRevision(current => current + 1); }} />
              : <p className="incoming-document-empty">Выберите письмо, чтобы открыть документы и исполнение.</p>}
      </div>
    </div>
  </section>;
}
