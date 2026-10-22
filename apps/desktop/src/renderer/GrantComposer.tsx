import { useState, type FormEvent } from "react";
import { Button, DialogSurface, Textarea } from "@fluentui/react-components";
import { Add20Regular, Delete20Regular } from "@fluentui/react-icons";
import type { GrantFields, WorkspaceDepartment, WorkspacePerson } from "@yuksalish/contracts";
import { RecordComposer, RecordSection, RecordSummary } from "./RecordComposer";
import { Input } from "./WorkspaceInput";
import { PersonPicker } from "./PersonPicker";
import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";
import { GrantParticipant } from "./GrantParticipant";
import { WorkspaceFileDropzone } from "./WorkspaceFileDropzone";
import { GRANT_SOURCE_FILES_HINT, validateGrantSourceFiles } from "./grant-source-files";
import "./record-composer.css";

interface Props {
  readonly fields: GrantFields;
  readonly onChange: (fields: GrantFields) => void;
  readonly onSubmit: (fields: GrantFields) => void;
  readonly onClose: () => void;
  readonly editing: boolean;
  readonly busy: boolean;
  readonly error: string;
  readonly token: string;
  readonly people: readonly WorkspacePerson[];
  readonly departments: readonly WorkspaceDepartment[];
  readonly initiatorId: string;
  readonly chairId?: string | null;
  readonly leaderId?: string | null;
  readonly workflowVersion?: 1 | 2;
  readonly authorId?: string | null;
  readonly files?: readonly File[];
  readonly onFilesChange?: (files: readonly File[]) => void;
}

export function GrantComposer({ fields, onChange, onSubmit, onClose, editing, busy, error,
  token, people, departments, initiatorId, chairId, leaderId, workflowVersion = 2, authorId,
  files = [], onFilesChange }: Props) {
  const [participantId, setParticipantId] = useState("");
  const [checklistTitle, setChecklistTitle] = useState("");
  const [validationError, setValidationError] = useState("");
  const activePeople = people.filter((person) => (person.status ?? "active") === "active");
  const person = (id: string | null | undefined) => people.find((item) => item.id === id);
  const availablePeople = activePeople.filter((item) => item.id !== fields.assigneeId && !fields.coAssigneeIds.includes(item.id));
  const addChecklistItem = () => {
    const title = checklistTitle.trim();
    if (!title || fields.checklist.includes(title) || fields.checklist.length >= 100) return;
    onChange({ ...fields, checklist: [...fields.checklist, title] }); setChecklistTitle("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    try { validateGrantSourceFiles(files); } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Проверьте выбранные файлы."); return;
    }
    if (fields.title.trim().length < 3 || !fields.assigneeId) {
      setValidationError("Введите название от трёх символов и выберите ответственного."); return;
    }
    if (!fields.dueAt || !Number.isFinite(new Date(fields.dueAt).getTime()) || new Date(fields.dueAt).getTime() <= Date.now()) {
      setValidationError("Укажите срок в будущем."); return;
    }
    if (checklistTitle.trim()) {
      setValidationError("Добавьте набранный пункт в чек-лист или очистите его поле."); return;
    }
    setValidationError(""); onSubmit(fields);
  };
  return <DialogSurface className="record-composer-dialog grant-composer-dialog" aria-labelledby="grant-editor-title">
    <form className="record-composer grant-composer" noValidate aria-busy={busy} onSubmit={submit}>
      <RecordComposer title={editing ? "Редактирование заявки" : "Новая заявка на грант"} titleId="grant-editor-title"
        eyebrow={editing ? "Гранты / Изменение" : "Гранты / Создание"} busy={busy} error={validationError || error}
        submitLabel={editing ? "Сохранить заявку" : "Отправить на запуск"}
        submitDisabled={fields.title.trim().length < 3 || !fields.assigneeId || !fields.dueAt}
        hint={editing ? "Изменения сохранятся только после подтверждения." : "Инициатива направится председателю. Работа начнётся только после разрешения запуска."}
        onClose={onClose} aside={<>
          <RecordSummary title="Предварительный просмотр">
            <div className="grant-composer-preview"><strong>{fields.title.trim() || "Название нового гранта"}</strong>
              <p>{fields.description.trim() || "Опишите ожидаемый результат и необходимые материалы."}</p>
              <GrantParticipant person={person(authorId ?? chairId)} label={authorId ? "Постановщик" : "Постановщик после разрешения запуска"} token={token} />
              <GrantParticipant person={person(initiatorId)} label="Инициатор" token={token} />
              {fields.assigneeId && <GrantParticipant person={person(fields.assigneeId)} label="Ответственный" token={token} />}
              <dl className="record-summary-facts"><div><dt>Срок</dt><dd>{fields.dueAt && Number.isFinite(new Date(fields.dueAt).getTime()) ? new Date(fields.dueAt).toLocaleString("ru-RU", {dateStyle: "medium", timeStyle: "short"}) : "Не указан"}</dd></div>
                <div><dt>Соисполнители</dt><dd>{fields.coAssigneeIds.length}</dd></div><div><dt>Чек-лист</dt><dd>{fields.checklist.length} пунктов</dd></div>
                {!editing && <div><dt>Файлы для ознакомления</dt><dd>{files.length}</dd></div>}</dl>
            </div>
          </RecordSummary>
          <RecordSummary title="Маршрут заявки">
            <div className="grant-composer-preview">
              {workflowVersion === 2 && !editing && <GrantParticipant person={person(chairId)} label="Разрешает запуск · постановщик после запуска" token={token} />}
              <p>Готовый результат проверяют последовательно:</p>
              {workflowVersion === 1 && <GrantParticipant person={person(authorId)} label="Постановщик" token={token} />}
              <GrantParticipant person={person(leaderId)} label={workflowVersion === 2 ? "Заместитель" : "Руководитель"} token={token} />
              <GrantParticipant person={person(chairId)} label="Окончательное принятие" token={token} />
              <p>Участники, переписка и история остаются внутри этой заявки.</p>
            </div>
          </RecordSummary>
        </>}>
        <RecordSection title="Основная информация" description="Что нужно подготовить для подачи на грант и как проверить результат.">
          <div className="record-field-grid">
            <label className="record-field-wide"><span>Название гранта *</span><Input autoFocus aria-label="Название гранта *" maxLength={240} value={fields.title} onChange={(_, data) => onChange({ ...fields, title: data.value })} /></label>
            <label className="record-field-wide"><span>Описание и ожидаемый результат</span><Textarea aria-label="Описание и ожидаемый результат" rows={5} maxLength={12000} resize="vertical" value={fields.description} onChange={(_, data) => onChange({ ...fields, description: data.value })} /></label>
            <label><span>Ответственный *</span><PersonPicker label="Ответственный гранта" people={activePeople} departments={departments} token={token} value={fields.assigneeId} disabled={busy} onChange={(assigneeId) => onChange({ ...fields, assigneeId, coAssigneeIds: fields.coAssigneeIds.filter((id) => id !== assigneeId) })} /></label>
            <label><span>Срок *</span><WorkspaceDateTimePicker ariaLabel="Срок *" required disabled={busy} value={fields.dueAt} onChange={(dueAt) => onChange({ ...fields, dueAt })} /><small>Выберите будущую дату и время.</small></label>
          </div>
        </RecordSection>
        <RecordSection title="Команда" description="Найдите соисполнителей. У каждого будет доступ к карточке и её чату.">
          <div className="grant-composer-add-row"><PersonPicker label="Добавить соисполнителя гранта" people={availablePeople} departments={departments} token={token} value={participantId} disabled={busy} onChange={setParticipantId} />
            <Button type="button" icon={<Add20Regular />} disabled={busy || fields.coAssigneeIds.length >= 100 || !availablePeople.some((item) => item.id === participantId)} onClick={() => { onChange({ ...fields, coAssigneeIds: [...fields.coAssigneeIds, participantId] }); setParticipantId(""); }}>Добавить сотрудника</Button></div>
          <div className="grant-team-roster" aria-label="Выбранная команда гранта">
            {fields.assigneeId && <GrantParticipant person={person(fields.assigneeId)} label="Ответственный" token={token} />}
            {fields.coAssigneeIds.map((id) => <div className="grant-composer-person-chip" key={id}><GrantParticipant person={person(id)} label="Соисполнитель" token={token} size={28} />
              <Button type="button" appearance="subtle" icon={<Delete20Regular />} disabled={busy} aria-label={`Убрать участника ${person(id)?.name ?? "Сотрудник"}`} onClick={() => onChange({ ...fields, coAssigneeIds: fields.coAssigneeIds.filter((item) => item !== id) })} /></div>)}
            {!fields.coAssigneeIds.length && <p>Соисполнители пока не добавлены.</p>}
          </div>
        </RecordSection>
        {!editing && onFilesChange && <RecordSection title="Материалы для ознакомления" description="Прикрепите условия конкурса, бюджет и другие исходные документы.">
          <WorkspaceFileDropzone label="Перетащите файлы сюда" hint={GRANT_SOURCE_FILES_HINT} actionLabel="Выбрать файлы" ariaLabel="Файлы для ознакомления" multiple disabled={busy} files={files} showSelectedFiles={false} onFiles={(selected) => {
            const next = [...files, ...selected];
            try { validateGrantSourceFiles(next); setValidationError(""); onFilesChange(next); }
            catch (error) { setValidationError(error instanceof Error ? error.message : "Проверьте файлы."); }
          }} />
          <ul className="grant-source-file-list">{files.map((file, index) => <li key={`${file.name}-${index}`}><span><strong>{file.name}</strong><small>{Math.max(1, Math.ceil(file.size / 1024))} КБ · загрузится при отправке</small></span>
            <Button type="button" appearance="subtle" icon={<Delete20Regular />} disabled={busy} aria-label={`Убрать файл ${file.name}`} onClick={() => { onFilesChange(files.filter((_, itemIndex) => itemIndex !== index)); setValidationError(""); }} /></li>)}</ul>
        </RecordSection>}
        <RecordSection title="План выполнения" description="Разделите результат на понятные шаги. Чек-лист можно оставить пустым.">
          <div className="grant-composer-add-row"><Input aria-label="Новый пункт чек-листа гранта" maxLength={500} value={checklistTitle} onChange={(_, data) => setChecklistTitle(data.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addChecklistItem(); } }} />
            <Button type="button" icon={<Add20Regular />} disabled={!checklistTitle.trim() || fields.checklist.includes(checklistTitle.trim()) || fields.checklist.length >= 100} onClick={addChecklistItem}>Добавить пункт</Button></div>
          <ol className="grant-composer-checklist">{fields.checklist.map((title, index) => <li key={`${title}-${index}`}><span>{index + 1}</span><strong>{title}</strong><Button type="button" appearance="subtle" icon={<Delete20Regular />} aria-label={`Удалить пункт ${title}`} onClick={() => onChange({ ...fields, checklist: fields.checklist.filter((_, itemIndex) => itemIndex !== index) })} /></li>)}</ol>
        </RecordSection>
      </RecordComposer>
    </form>
  </DialogSurface>;
}
