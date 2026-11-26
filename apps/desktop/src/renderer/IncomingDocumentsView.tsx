import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, DialogBody, DialogContent, DialogSurface, DialogTitle, useRestoreFocusTarget } from "@fluentui/react-components";
import { Document20Regular } from "@fluentui/react-icons";
import type { IncomingDocument, IncomingDocumentDetail, IncomingDocumentFile, IncomingDocumentFilter, IncomingDocumentPage, WorkspaceDepartment, WorkspacePerson } from "@yuksalish/contracts";
import { Input } from "./WorkspaceInput";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";
import { russianDateTimeFormatter } from "./date-time-format";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { PersonPicker } from "./PersonPicker";
import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";
import { assignIncomingDocument, downloadIncomingDocumentFile, loadIncomingDocument, loadIncomingDocuments, previewIncomingDocumentFile } from "./workspace-api";
import { saveReferentBlob } from "./AIReferentFiles";
import { IncomingDocumentExecution, IncomingDocumentStatus } from "./IncomingDocumentExecution";
import { ProfileAvatar } from "./ProfileAvatar";
import { IncomingDocumentActivity } from "./IncomingDocumentActivity";
import { isTaskOverdue } from "./task-deadline";
import { useTaskDeadlineClock } from "./useTaskDeadlineClock";
import { focusWorkspaceDialog, WorkspaceDialog } from "./WorkspaceDialog";
import "./incoming-documents.css";

const ExternalFileViewer = lazy(() => import("./FileViewer").then(module => ({ default: module.ExternalFileViewer })));
const filters: Readonly<Record<IncomingDocumentFilter, string>> = {
  all: "Все письма", unassigned: "Без поручения", active: "На исполнении", review: "На проверке",
  completed: "Исполненные", overdue: "Просроченные",
};
const assignmentInstructions = ["Ижро учун", "Тезкор", "Маълумот учун", "Таклиф киритиш учун"] as const;

function DocumentPerson({ id, name, people, token }: {
  readonly id: string; readonly name: string; readonly people: readonly WorkspacePerson[]; readonly token: string;
}) {
  const person = people.find(item => item.id === id) ?? { id, name };
  return <span className="incoming-document-person">
    <ProfileAvatar person={person} token={token} size={28} aria-hidden />
    <span>{person.name}</span>
  </span>;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "Не указан";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid Date" : russianDateTimeFormatter({ dateStyle: "short", timeStyle: "short" }).format(date);
}

const IncomingDocumentRows = memo(function IncomingDocumentRows({ documents, selectedId, people, token, now, onSelect }: {
  readonly documents: readonly IncomingDocument[]; readonly selectedId?: string;
  readonly people: readonly WorkspacePerson[]; readonly token: string; readonly now: number;
  readonly onSelect: (document: IncomingDocument) => void;
}) {
  return documents.map(document => <button type="button" className="incoming-document-row"
    key={document.id} aria-pressed={document.id === selectedId} onClick={() => onSelect(document)}>
    <span className="incoming-document-row-meta"><strong>№ {document.number}</strong><IncomingDocumentStatus status={document.execution?.status} /></span>
    <strong>{document.subject}</strong><span>{document.sender || "Отправитель не указан"}</span>
    <span className="incoming-document-row-date">В Workspace: {document.addedAt ? <time dateTime={document.addedAt}>{dateLabel(document.addedAt)}</time> : "Дата не передана"}</span>
    {document.execution ? <span className="incoming-document-row-execution">
      <DocumentPerson id={document.execution.assigneeId} name={document.execution.assigneeName} people={people} token={token} />
      <small data-overdue={isTaskOverdue(document.execution, now)}>{dateLabel(document.execution.dueAt)}{isTaskOverdue(document.execution, now) ? " · Срок истёк" : ""}</small>
    </span> : null}
  </button>);
});

function errorLabel(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось загрузить данные.";
}

function DocumentViewer({ token, documentId, file, onClose }: {
  readonly token: string; readonly documentId: string; readonly file: IncomingDocumentFile; readonly onClose: () => void;
}) {
  const [text, setText] = useState<string>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const plainText = /\.txt$/i.test(file.name);
  const tooLarge = file.byteSize > 1024 * 1024;
  const previewError = tooLarge ? "Текстовый файл больше 1 МБ. Скачайте его для просмотра." : error;
  useEffect(() => {
    if (!plainText || tooLarge) return;
    const controller = new AbortController();
    let active = true;
    void downloadIncomingDocumentFile(token, documentId, file.id, controller.signal)
      .then(blob => blob.text()).then(value => { if (active) setText(value); })
      .catch(cause => { if (active) setError(errorLabel(cause)); });
    return () => { active = false; controller.abort(); };
  }, [token, documentId, file.id, plainText, tooLarge]);
  const attachment = { id: file.id, fileName: file.name.split("/").at(-1) || file.name,
    byteSize: file.byteSize, contentType: "application/octet-stream" };
  if (plainText) return <WorkspaceDialog open onAfterOpen={() => focusWorkspaceDialog(surface.current)}
    onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DialogSurface ref={surface} className="incoming-text-preview"><DialogBody>
      <DialogTitle action={<Button onClick={onClose}>Закрыть</Button>}>{attachment.fileName}</DialogTitle>
      <DialogContent>{previewError ? <WorkspaceNotice tone="error">{previewError}</WorkspaceNotice> : text === undefined
        ? <LoadingSkeleton layout="rows" rows={3} label="Читаем текст письма" /> : <pre>{text}</pre>}
        <Button disabled={saving} onClick={() => {
          setSaving(true);
          void downloadIncomingDocumentFile(token, documentId, file.id).then(blob => saveReferentBlob(blob, attachment.fileName))
            .catch(cause => setError(errorLabel(cause))).finally(() => setSaving(false));
        }}>Скачать</Button>
      </DialogContent>
    </DialogBody></DialogSurface>
  </WorkspaceDialog>;
  return <Suspense fallback={<LoadingSkeleton layout="rows" rows={3} label="Открываем документ" />}>
    <ExternalFileViewer attachment={attachment} onClose={onClose}
      onLoad={(_file, signal) => downloadIncomingDocumentFile(token, documentId, file.id, signal)}
      onLoadOffice={(_file, sheet, offset, signal) => previewIncomingDocumentFile(token, documentId, file.id, sheet, offset, signal)}
      onDownload={async () => saveReferentBlob(await downloadIncomingDocumentFile(token, documentId, file.id), attachment.fileName)} />
  </Suspense>;
}

function AssignmentForm({ token, detail, people, departments, onSaved, onRefreshed, onCancel }: {
  readonly token: string; readonly detail: IncomingDocumentDetail; readonly people: readonly WorkspacePerson[];
  readonly onSaved: (detail: IncomingDocumentDetail) => void; readonly onCancel: () => void;
  readonly onRefreshed: (detail: IncomingDocumentDetail) => void;
  readonly departments?: readonly WorkspaceDepartment[];
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
  const hasInstruction = assignmentInstructions.some(value => value === instruction);
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
    if (submitting.current || locked || !hasInstruction || !assigneeId || !dueAt) return;
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
    <header className="incoming-assignment-heading"><h3>Поручение по письму</h3>
      <p className="incoming-document-help">Выберите действие, назначьте ответственного и срок.</p></header>
    <div className="incoming-document-field">
      <label htmlFor="incoming-instruction">Что нужно сделать</label>
      <WorkspaceSelect id="incoming-instruction" aria-label="Что нужно сделать" value={instruction} disabled={locked} required
        onChange={event => setInstruction(event.target.value)}>
        <option value="" disabled>Выберите действие</option>
        {assignmentInstructions.map(value => <option value={value} key={value}>{value}</option>)}
      </WorkspaceSelect>
    </div>
    <div className="incoming-assignment-fields">
    <div className="incoming-document-field"><span>Основной исполнитель</span>
      <PersonPicker people={available} departments={departments} token={token} value={assigneeId} label="Основной исполнитель" disabled={locked}
        onChange={id => { setAssigneeId(id); setCoAssigneeIds(current => current.filter(value => value !== id)); }} />
    </div>
    <div className="incoming-document-field"><span>Срок исполнения</span>
      <WorkspaceDateTimePicker value={dueAt} onChange={setDueAt} ariaLabel="Срок исполнения" required disabled={locked} />
    </div>
    </div>
    <section className="incoming-assignment-team" aria-label="Команда исполнения">
    <div className="incoming-section-heading"><span>Соисполнители</span><small>Необязательно</small></div>
    <PersonPicker departments={departments} people={available.filter(person => person.id !== assigneeId && !coAssigneeIds.includes(person.id))}
      token={token} value="" label="Добавить соисполнителя" emptyLabel="Добавить соисполнителя" disabled={locked}
      onChange={id => setCoAssigneeIds(current => [...current, id])} />
    {coAssigneeIds.length ? <ul className="incoming-document-participants" aria-label="Соисполнители">
      {coAssigneeIds.map(id => <li key={id}>
        <DocumentPerson id={id} name="Сотрудник" people={people} token={token} />
        <Button appearance="subtle" disabled={locked} aria-label={`Убрать соисполнителя ${people.find(person => person.id === id)?.name ?? "Сотрудник"}`}
          onClick={() => setCoAssigneeIds(current => current.filter(value => value !== id))}>Убрать</Button></li>)}
    </ul> : null}
    </section>
    <p className="incoming-document-help">После подтверждения будет создано поручение. Перечисленные выше документы скопируются в его карточку.</p>
    {!detail.document.canAssign ? <WorkspaceNotice tone="warning">Назначение этого письма больше недоступно. Выбранные настройки сохранены в форме.</WorkspaceNotice> : null}
    {error ? <WorkspaceNotice tone="error" actions={reconcile ? <Button disabled={busy} onClick={() => void checkState()}>Проверить состояние</Button> : undefined}>{error}</WorkspaceNotice> : null}
    <div className="incoming-document-actions">
      <Button appearance="primary" type="submit" disabled={locked || !hasInstruction || !assigneeId || !dueAt}>Создать поручение</Button>
      <Button disabled={busy || reconcile} onClick={onCancel}>Отмена</Button>
    </div>
  </form>;
}

const DocumentCard = memo(function DocumentCard({ token, detail, people, departments, now, onSaved, onOpenTask }: {
  readonly token: string; readonly detail: IncomingDocumentDetail; readonly people: readonly WorkspacePerson[];
  readonly onSaved: (detail: IncomingDocumentDetail) => void; readonly onOpenTask?: (taskId: string) => Promise<void>;
  readonly now: number;
  readonly departments?: readonly WorkspaceDepartment[];
}) {
  const [assigning, setAssigning] = useState(false);
  const [preview, setPreview] = useState<IncomingDocumentFile>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const document = detail.document;
  const restoreFocusTarget = useRestoreFocusTarget();
  const execution = document.execution;
  const openTask = async () => {
    if (!execution || !onOpenTask) return;
    setBusy(true); setError("");
    try { await onOpenTask(execution.taskId); }
    catch (reason) { setError(errorLabel(reason)); }
    finally { setBusy(false); }
  };
  return <article className="incoming-document-card" aria-label={`Письмо № ${document.number}`}>
    <div className="incoming-section-heading"><span className="incoming-document-eyebrow">Входящее № {document.number}</span><IncomingDocumentStatus status={execution?.status} /></div>
    <h2>{document.subject}</h2><p>{document.sender || "Отправитель не указан"}</p>
    <dl><div><dt>Получено</dt><dd>{dateLabel(document.receivedAt)}</dd></div>
      <div><dt>Добавлено в Workspace</dt><dd>{dateLabel(document.addedAt)}</dd></div>
      {document.registeredAt ? <div><dt>Регистрация в источнике</dt><dd>{dateLabel(document.registeredAt)}</dd></div> : null}
      <div><dt>Канал</dt><dd>{document.source === "exat" ? "E-XAT" : document.source === "webmail" ? "Электронная почта" : "Импорт"}</dd></div></dl>
    {execution ? <IncomingDocumentExecution token={token} detail={detail} people={people} now={now} onSaved={onSaved} /> : null}
    <details className="incoming-originals" open={!execution}>
    <summary>Документы письма <span>{detail.files.length}</span></summary>
    {detail.files.length ? <ul className="incoming-document-files">{detail.files.map(file => <li key={file.id}>
      <span className="incoming-original-file-icon" aria-hidden="true"><Document20Regular /></span>
      <span className="incoming-original-file-copy">{file.name.split("/").at(-1)}<small>{Math.max(1, Math.round(file.byteSize / 1024))} КБ</small></span>
      <Button {...restoreFocusTarget} onClick={() => setPreview(file)} aria-label={`Открыть ${file.name.split("/").at(-1)}`}>Открыть</Button>
    </li>)}</ul> : <WorkspaceNotice tone={document.filesExpected ? "warning" : "info"}>
      {document.filesExpected ? "Оригиналы ещё не переданы референтом. Обновите карточку после загрузки файлов." : "Вложения к этому письму не переданы."}
    </WorkspaceNotice>}
    </details>
    {execution ? <>
      {document.canOpenTask && onOpenTask ? <div className="incoming-advanced-action"><Button appearance="subtle" disabled={busy} onClick={() => void openTask()}>Открыть поручение</Button></div> : null}
    </> : assigning ? <AssignmentForm token={token} detail={detail} people={people} departments={departments}
      onSaved={next => { setAssigning(false); onSaved(next); }} onRefreshed={onSaved} onCancel={() => setAssigning(false)} />
      : <section className="incoming-document-execution"><h3>Исполнение пока не назначено</h3>
        {document.canAssign ? <Button appearance="primary" disabled={document.filesExpected && !detail.files.length}
          onClick={() => setAssigning(true)}>Назначить исполнение</Button>
          : <p className="incoming-document-help">Назначение доступно сотруднику с правами на это письмо и создание поручений.</p>}
      </section>}
    {error ? <WorkspaceNotice tone="error">{error}</WorkspaceNotice> : null}
    <IncomingDocumentActivity token={token} detail={detail} />
    {preview ? <DocumentViewer token={token} documentId={document.id} file={preview} onClose={() => setPreview(undefined)} /> : null}
  </article>;
});

export function IncomingDocumentsView({ token, people, departments, onOpenTask, personal = false, refreshKey }: {
  readonly token: string; readonly people: readonly WorkspacePerson[]; readonly onOpenTask?: (taskId: string) => Promise<void>;
  readonly personal?: boolean; readonly refreshKey?: string;
  readonly departments?: readonly WorkspaceDepartment[];
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
    void loadIncomingDocuments(token, query, filter, offset, controller.signal, personal)
      .then(next => { if (active) { setPage(next); setError(""); } })
      .catch(reason => { if (active) { setPage(undefined); setError(errorLabel(reason)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [token, query, filter, offset, revision, personal, refreshKey]);
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    let active = true;
    void loadIncomingDocument(token, selectedId, controller.signal)
      .then(next => { if (active) { setDetail(next); setDetailError(""); } })
      .catch(reason => { if (active) setDetailError(errorLabel(reason)); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [token, selectedId, detailRevision, refreshKey]);
  const refresh = useCallback(() => {
    setLoading(true); setRevision(current => current + 1);
    if (selectedId) { setDetailLoading(true); setDetailRevision(current => current + 1); }
  }, [selectedId]);
  const select = useCallback((document: IncomingDocument) => {
    if (document.id === selectedId) return;
    setDetail(undefined); setDetailError(""); setDetailLoading(true); setSelectedId(document.id);
  }, [selectedId]);
  const acceptDetail = useCallback((next: IncomingDocumentDetail) => { setDetail(next); setRevision(current => current + 1); }, []);
  return <section className="workspace-view workspace-queue incoming-documents" aria-label="Документооборот Workspace">
    <WorkspaceSectionHeader motif="messages" className="incoming-documents-header"><div>
      <h1>{personal ? "Мои письма" : "Входящие письма"}</h1>
      <p>{personal ? "Поручения по письмам с вашим участием — сроки, документы и результаты." : "Письма референта, исполнители и контроль сроков."}</p></div>
      <Button disabled={loading || detailLoading} onClick={refresh}>Обновить</Button></WorkspaceSectionHeader>
    <div className="incoming-documents-controls">
      <label>Поиск по письмам<Input value={search} placeholder="Номер, тема или отправитель" onChange={event => setSearch(event.target.value)} /></label>
      <label>Исполнение<WorkspaceSelect value={filter} onChange={event => { setFilter(event.target.value as IncomingDocumentFilter); setOffset(0); setLoading(true); }}>
        {Object.entries(filters).filter(([value]) => !personal || value !== "unassigned")
          .map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </WorkspaceSelect></label>
      <span className="incoming-document-count" aria-live="polite">{page ? `Найдено: ${page.total}` : "—"}</span>
    </div>
    <div className="incoming-documents-body">
      <div className="incoming-documents-list" aria-busy={loading}>
        {loading ? <LoadingSkeleton layout="rows" rows={5} label="Загружаем письма" />
          : error ? <WorkspaceNotice tone="error" actions={<Button onClick={refresh}>Повторить</Button>}>{error}</WorkspaceNotice>
            : page?.documents.length ? <IncomingDocumentRows documents={page.documents} selectedId={selectedId} people={people} token={token} now={now} onSelect={select} /> : <p className="incoming-document-empty">Писем по выбранным условиям нет.</p>}
        {page && page.total > page.limit ? <nav className="incoming-document-actions" aria-label="Страницы входящих писем">
          <Button disabled={loading || offset === 0} onClick={() => { setLoading(true); setOffset(current => Math.max(0, current - page.limit)); }}>Назад</Button>
          <span>{Math.floor(offset / page.limit) + 1} / {Math.max(1, Math.ceil(page.total / page.limit))}</span>
          <Button disabled={loading || offset + page.limit >= page.total} onClick={() => { setLoading(true); setOffset(current => current + page.limit); }}>Далее</Button>
        </nav> : null}
      </div>
      <div className="incoming-documents-detail" aria-busy={detailLoading}>
        {detailError ? <WorkspaceNotice tone="error" actions={<Button onClick={refresh}>Повторить</Button>}>{detailError}</WorkspaceNotice> : null}
        {detailLoading && !detail ? <LoadingSkeleton layout="rows" rows={6} label="Открываем письмо" />
          : detail ? <DocumentCard key={detail.document.id} token={token} detail={detail} people={people} departments={departments} now={now} onOpenTask={onOpenTask}
              onSaved={acceptDetail} />
              : !detailError ? <p className="incoming-document-empty">Выберите письмо, чтобы открыть документы и исполнение.</p> : null}
      </div>
    </div>
  </section>;
}
