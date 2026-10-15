import { useState } from "react";
import { Button, Input } from "@fluentui/react-components";
import type {
  TaskPlan, TaskPlanImportConfirm, TaskPlanImportPreview, WorkspacePerson, WorkspaceTask,
} from "@yuksalish/contracts";

import { ApiHttpError, confirmTaskPlanImport, previewTaskPlanImport } from "./workspace-api";
import { WorkspaceSelect } from "./WorkspaceSelect";

type ReviewRow = {
  title: string;
  source: string;
  warning: string | null;
  mode: "create" | "link" | "skip";
  assigneeId: string;
  coAssigneeIds: string[];
  observerIds: string[];
  dueDate: string;
  dueDateHint: string | null;
  taskId: string;
  assigneeHint: string | null;
  coexecutorsHint: string | null;
  groupKey: string | null;
  deadlineText: string | null;
  deadlineNeedsReview: boolean;
  deadlineManuallyReviewed: boolean;
  responsibleText: string | null;
  executorsText: string | null;
  section: string | null;
  greenCompletion: boolean;
  description: string;
  checklist: string[];
  historicalCompleted: boolean;
};

function rowIssue(row: ReviewRow, annualWorkPlan: boolean): string | null {
  if (row.mode === "skip") return null;
  if (!row.title.trim()) return "Укажите название задачи";
  if (row.mode === "link") return row.taskId ? null : "Выберите существующую задачу";
  if (!row.assigneeId) return annualWorkPlan
    ? "Выберите основного исполнителя из «Бажарувчи»"
    : "Выберите ответственного за задачу";
  return null;
}

function pastReviewedDate(value: string): boolean {
  return Boolean(value) && new Date(`${value}T23:59:59+05:00`).getTime() < Date.now();
}

function initialDescription(row: TaskPlanImportPreview["rows"][number]): string {
  const parts = [row.completedWorkText?.trim() ?? ""];
  if (row.originalTitle) parts.push(`Полное название из плана:\n${row.originalTitle}`);
  if (row.deadlineText && (row.deadlineNeedsReview || !row.dueDateHint)) {
    parts.push(`Муддати в документе:\n${row.deadlineText}`);
  }
  return parts.filter(Boolean).join("\n\n").slice(0, 20_000);
}

function matchingPersonId(hint: string, people: readonly WorkspacePerson[]): string | null {
  const match = hint.match(/^\s*([\p{L}])\s*\.\s*([\p{L}-]+)\s*$/u);
  const wordsInHint = hint.toLocaleLowerCase().match(/[\p{L}-]+/gu) ?? [];
  if (!match && wordsInHint.length < 2) return null;
  const initial = match?.[1]?.toLocaleLowerCase();
  const surname = match?.[2]?.toLocaleLowerCase();
  const matching = people.filter((person) => {
    const words: string[] = person.name.toLocaleLowerCase().match(/[\p{L}-]+/gu) ?? [];
    return match
      ? words.includes(surname ?? "") && words.some((word) => word !== surname && word.startsWith(initial ?? ""))
      : wordsInHint.every((word) => words.includes(word));
  });
  return matching.length === 1 ? matching[0]?.id ?? null : null;
}

function personHints(hint: string): string[] {
  return hint.split(/[;,\n]+/).flatMap((part) => {
    const abbreviated = part.match(/[\p{L}]\s*\.\s*[\p{L}-]+/gu) ?? [];
    return abbreviated.length ? abbreviated : [part.trim()];
  }).filter(Boolean);
}

function suggestedCoAssignees(hint: string, people: readonly WorkspacePerson[]): string[] {
  return [...new Set(personHints(hint).map((name) => matchingPersonId(name, people))
    .filter((id): id is string => Boolean(id)))];
}

interface TaskPlanImportViewProps {
  readonly token: string;
  readonly currentUserId: string;
  readonly people: readonly WorkspacePerson[];
  readonly tasks: readonly WorkspaceTask[];
  readonly onImported: (plan: TaskPlan) => Promise<void>;
  readonly onClose: () => void;
}

function errorText(error: unknown): string {
  return error instanceof ApiHttpError || error instanceof Error ? error.message : "Не удалось обработать план";
}

export function TaskPlanImportView({
  token, currentUserId, people, tasks, onImported, onClose,
}: TaskPlanImportViewProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TaskPlanImportPreview | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [groupParticipants, setGroupParticipants] = useState<Record<string, string[]>>({});
  const [expandedParticipantsRow, setExpandedParticipantsRow] = useState<number | null>(null);
  const [expandedObserversRow, setExpandedObserversRow] = useState<number | null>(null);
  const [filteredIssueIndices, setFilteredIssueIndices] = useState<number[] | null>(null);
  const [participantsReviewed, setParticipantsReviewed] = useState(false);
  const [operationId, setOperationId] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"work" | "regional" | "other">("work");
  const [ownerId, setOwnerId] = useState(currentUserId);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<TaskPlan | null>(null);
  const activePeople = people.filter((person) => person.status === undefined || person.status === "active");
  const groups = [...new Map(rows.filter((row) => row.groupKey).map((row) => [
    row.groupKey!, row.coexecutorsHint ?? "",
  ])).entries()];
  const hasStructuredAssignments = rows.some((row) => row.groupKey);
  const rowIssues = rows.flatMap((row, index) => {
    const issue = rowIssue(row, Boolean(preview?.annualWorkPlan));
    return issue ? [{ index, issue }] : [];
  });
  const showOnlyUnresolved = filteredIssueIndices !== null;
  const visibleRows = rows.map((row, index) => ({ row, index })).filter(({ index }) =>
    !showOnlyUnresolved || filteredIssueIndices?.includes(index));

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  async function analyze() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await previewTaskPlanImport(token, file);
      setPreview(result);
      setRows(result.rows.map((row) => {
        const annualExecutorHints = result.annualWorkPlan
          ? personHints(row.executorsText ?? row.coexecutorsHint ?? "") : [];
        const assigneeId = result.annualWorkPlan
          ? matchingPersonId(annualExecutorHints[0] ?? "", activePeople) ?? ""
          : row.assigneeHint ? matchingPersonId(row.assigneeHint, activePeople) ?? ""
            : row.groupKey ? "" : currentUserId;
        const coAssigneeIds = result.annualWorkPlan
          ? [...new Set(annualExecutorHints.slice(1).map((hint) => matchingPersonId(hint, activePeople))
            .filter((id): id is string => Boolean(id) && id !== assigneeId))]
          : row.coexecutorsHint
            ? suggestedCoAssignees(row.coexecutorsHint, activePeople).filter((id) => id !== assigneeId) : [];
        const dueDate = row.dueDateHint ?? "";
        return {
          ...row, mode: "create", assigneeId,
          coAssigneeIds,
          observerIds: result.annualWorkPlan && row.responsibleText
            ? suggestedCoAssignees(row.responsibleText, activePeople)
              .filter((id) => id !== assigneeId && !coAssigneeIds.includes(id)) : [],
          dueDate, dueDateHint: row.dueDateHint ?? null,
          taskId: "", assigneeHint: row.assigneeHint ?? null,
          coexecutorsHint: row.coexecutorsHint ?? null, groupKey: row.groupKey ?? null,
          deadlineText: row.deadlineText ?? null,
          deadlineNeedsReview: row.deadlineNeedsReview ?? false,
          deadlineManuallyReviewed: false,
          responsibleText: row.responsibleText ?? null,
          executorsText: row.executorsText ?? null,
          section: row.section ?? null,
          greenCompletion: row.greenCompletion ?? false,
          description: initialDescription(row), checklist: [...(row.mechanismItems ?? [])],
          historicalCompleted: Boolean(result.annualWorkPlan && row.greenCompletion
            && !row.deadlineNeedsReview && pastReviewedDate(dueDate)),
        };
      }));
      setGroupParticipants(Object.fromEntries([...new Map(result.rows.filter((row) => row.groupKey)
        .map((row) => [row.groupKey!, row.coexecutorsHint ?? ""]))].map(([key, hint]) => [
        key, suggestedCoAssignees(hint, activePeople),
      ])));
      setParticipantsReviewed(false);
      setExpandedParticipantsRow(null);
      setExpandedObserversRow(null);
      setFilteredIssueIndices(null);
      setTitle(result.suggestedTitle);
      setOperationId(crypto.randomUUID());
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview || !operationId || busy) return;
    const included = rows.filter((row) => row.mode !== "skip");
    if (!title.trim()) {
      setError("Укажите название плана.");
      return;
    }
    if (included.length === 0) {
      setError("Включите хотя бы один пункт плана.");
      return;
    }
    if (rowIssues.length > 0) {
      const first = rowIssues[0];
      if (!first) return;
      setFilteredIssueIndices(rowIssues.map(({ index }) => index));
      setError(`Пункт ${first.index + 1}: ${first.issue}. Всего требуют заполнения: ${rowIssues.length}. В списке показаны только эти пункты.`);
      return;
    }
    if ((hasStructuredAssignments || preview.annualWorkPlan) && !participantsReviewed) {
      setError(preview.annualWorkPlan
        ? "Проверьте исполнителей и наблюдателей по строкам документа, затем подтвердите проверку."
        : "Проверьте ответственного и соисполнителей по строкам документа, затем подтвердите проверку.");
      return;
    }
    const duplicateRoleIndex = rows.findIndex((row) => row.mode === "create"
      && row.coAssigneeIds.includes(row.assigneeId));
    if (duplicateRoleIndex !== -1) {
      setError(`Пункт ${duplicateRoleIndex + 1}: ответственный не может быть соисполнителем этой задачи.`);
      return;
    }
    const duplicateObserverIndex = rows.findIndex((row) => row.mode === "create"
      && row.observerIds.some((id) => id === row.assigneeId || row.coAssigneeIds.includes(id)));
    if (duplicateObserverIndex !== -1) {
      setError(`Пункт ${duplicateObserverIndex + 1}: сотрудник не может одновременно исполнять и наблюдать эту задачу.`);
      return;
    }
    const longStepIndex = rows.findIndex((row) => row.mode === "create"
      && row.checklist.some((step) => step.length > 500));
    if (longStepIndex !== -1) {
      setError(`Пункт ${longStepIndex + 1}: один шаг плана выполнения длиннее 500 символов.`);
      return;
    }
    if (included.some((row) => row.mode === "create" && row.historicalCompleted
      && (!row.greenCompletion || !pastReviewedDate(row.dueDate)
        || (row.deadlineNeedsReview && !row.deadlineManuallyReviewed)))) {
      setError("Завершённой можно отметить только зелёную строку с проверенным прошедшим сроком.");
      return;
    }
    if (periodStart && periodEnd && periodEnd < periodStart) {
      setError("Конец периода не может быть раньше начала.");
      return;
    }
    const payload: TaskPlanImportConfirm = {
      operationId,
      annualWorkPlan: Boolean(preview.annualWorkPlan),
      plan: { title: title.trim(), kind, periodStart: periodStart || null, periodEnd: periodEnd || null,
        ownerUserId: ownerId },
      items: included.map((row) => ({
        title: row.title.trim(), source: row.source,
        mode: row.mode === "link" ? "link" : "create",
        taskId: row.mode === "link" ? row.taskId : null,
        assigneeId: row.mode === "create" ? row.assigneeId : null,
        coAssigneeIds: row.mode === "create" ? row.coAssigneeIds : [],
        observerIds: row.mode === "create" ? row.observerIds : [],
        description: row.mode === "create" ? row.description : "",
        checklist: row.mode === "create" ? row.checklist : [],
        historicalCompleted: row.mode === "create" && row.historicalCompleted,
        dueAt: row.mode === "create" && row.dueDate
          ? new Date(`${row.dueDate}T18:00:00+05:00`).toISOString() : null,
      })),
    };
    setBusy(true);
    setError("");
    try {
      const plan = await confirmTaskPlanImport(token, payload);
      setDone(plan);
      await onImported(plan);
    } catch (reason) {
      setError(`${errorText(reason)}. Идентификатор импорта сохранён: повторная отправка не создаст дублей.`);
    } finally {
      setBusy(false);
    }
  }

  return <section className="task-plan-import" aria-label="Импорт плана">
    <div className="task-plan-import-heading"><div><h3>Импорт плана из документа</h3><p>PDF с текстом, DOCX, XLSX или TXT до 10 МБ. Обработка на сервере Workspace, без внешнего ИИ. Документ не сохраняется.</p></div><Button appearance="subtle" onClick={onClose} disabled={busy}>Закрыть</Button></div>
    {done ? <div role="status">План «{done.title}» сохранён. Созданные и привязанные задачи: {done.taskIds.length}. <Button onClick={onClose}>Готово</Button></div> : <>
      <div className="task-plan-import-upload">
        <label>Файл плана <input type="file" accept=".pdf,.docx,.xlsx,.txt" disabled={busy} onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setPreview(null); setRows([]); setGroupParticipants({});
          setParticipantsReviewed(false); setExpandedParticipantsRow(null);
          setExpandedObserversRow(null); setFilteredIssueIndices(null);
          setOperationId(""); setError("");
        }} /></label>
        <Button appearance="secondary" disabled={!file || busy} onClick={() => void analyze()}>{busy && !preview ? "Разбираем…" : "Разобрать документ"}</Button>
      </div>
      {preview ? <>
        <p>Найдено {rows.length} возможных пунктов. Удалите лишние, уточните названия, исполнителей и сроки. Ничего не создаётся до подтверждения.</p>
        {preview.annualWorkPlan ? <p className="task-plan-import-annual-note">Годовой иш режа: «Бажарувчи» → основной исполнитель и соисполнители, «Масъул» → наблюдатели, механизм → план выполнения, выполненные работы → описание. Прошедшие сроки исключаются из оценки эффективности. Зелёные пункты с точным прошедшим сроком предложены как завершённые — проверьте их перед сохранением.</p> : null}
        <div className="task-plan-import-fields">
          <label>Название плана<Input value={title} maxLength={240} onChange={(_, data) => setTitle(data.value)} /></label>
          <label>Постановщик плана<WorkspaceSelect value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            {!activePeople.some((person) => person.id === currentUserId) ? <option value={currentUserId}>Текущий пользователь</option> : null}
            {activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </WorkspaceSelect></label>
          <label>Вид<WorkspaceSelect value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="work">Иш режа</option><option value="regional">Региональный план</option><option value="other">Другой план</option></WorkspaceSelect></label>
          <label>Начало периода<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
          <label>Конец периода<input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
        </div>
        {(hasStructuredAssignments || preview.annualWorkPlan) ? <section className="task-plan-import-assignments" aria-label="Назначения из документа">
          <h4>Данные из плана</h4>
          <p>Исполнители и наблюдатели предлагаются отдельно для каждого пункта. Неясные имена, отделы и сроки проверьте вручную; отделы не превращаются в сотрудников.</p>
          {!preview.annualWorkPlan ? <div className="task-plan-import-groups">{groups.map(([groupKey, hint]) => <div key={groupKey}>
            <strong>{groupKey}</strong><span>В документе: {hint || "не указаны"}</span>
            <label>Набор соисполнителей для массового назначения по строке
              <WorkspaceSelect multiple value={groupParticipants[groupKey] ?? []} onChange={(event) => {
                setGroupParticipants((current) => ({ ...current, [groupKey]: event.currentTarget.selectedOptions.map((option) => option.value) }));
              }}>{activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</WorkspaceSelect>
            </label>
            <Button appearance="secondary" onClick={() => {
              const selected = groupParticipants[groupKey] ?? [];
              setRows((current) => current.map((row) => row.groupKey === groupKey && row.mode === "create"
                ? { ...row, coAssigneeIds: selected.filter((id) => id !== row.assigneeId) } : row));
              setParticipantsReviewed(false);
            }}>Применить к пунктам этой строки</Button>
          </div>)}</div> : null}
          <label className="task-plan-import-review"><input type="checkbox" checked={participantsReviewed} onChange={(event) => setParticipantsReviewed(event.target.checked)} />{preview.annualWorkPlan
            ? "Я проверил исполнителей и наблюдателей для каждого включённого пункта; отделы и неясные имена сопоставлены вручную или сознательно не назначены."
            : "Я проверил ответственного и соисполнителей для каждого включённого пункта; отделы и неясные имена сопоставлены вручную или сознательно не назначены."}</label>
        </section> : null}
        {rowIssues.length > 0 ? <div className="task-plan-import-issue-summary" role="status">
          <strong>Требуют заполнения: {rowIssues.length} из {rows.filter((row) => row.mode !== "skip").length} пунктов</strong>
          <span>Номера: {rowIssues.slice(0, 20).map(({ index }) => index + 1).join(", ")}{rowIssues.length > 20 ? ` и ещё ${rowIssues.length - 20}` : ""}. Нераспознанные имена из документа нужно сопоставить вручную.</span>
          <Button appearance="secondary" aria-pressed={showOnlyUnresolved} onClick={() => setFilteredIssueIndices(showOnlyUnresolved ? null : rowIssues.map(({ index }) => index))}>{showOnlyUnresolved ? "Показать все пункты" : "Показать только незаполненные"}</Button>
        </div> : showOnlyUnresolved ? <Button appearance="secondary" onClick={() => setFilteredIssueIndices(null)}>Все пункты заполнены · показать план целиком</Button> : null}
        <div className="task-plan-import-rows">{visibleRows.map(({ row, index }) => <fieldset key={`${row.source}-${index}`} className={rowIssue(row, Boolean(preview.annualWorkPlan)) ? "task-plan-import-row-needs-attention" : undefined}>
          <legend>Пункт {index + 1} · {row.source}</legend>
          {rowIssue(row, Boolean(preview.annualWorkPlan)) ? <p className="task-plan-import-row-issue">{rowIssue(row, Boolean(preview.annualWorkPlan))}</p> : null}
          {row.warning ? <p className="task-plan-import-warning">{row.warning}</p> : null}
          {row.groupKey ? <p>В документе: ответственный — {row.assigneeHint ?? "не указан"}; срок — {row.dueDateHint ?? "не указан или не распознан"}.</p> : null}
          {preview.annualWorkPlan ? <p className="task-plan-import-source">{row.section ? `${row.section} · ` : ""}Масъул: {row.responsibleText || "не указан"} · Бажарувчи: {row.executorsText || "не указан"} · Муддати: {row.deadlineText || "не указан"}{row.deadlineNeedsReview ? " · срок требует проверки" : ""}</p> : null}
          <label>Действие<WorkspaceSelect value={row.mode} onChange={(event) => updateRow(index, { mode: event.target.value as ReviewRow["mode"] })}><option value="create">Создать задачу</option><option value="link">Привязать существующую</option><option value="skip">Не включать</option></WorkspaceSelect></label>
          {row.mode !== "skip" ? <label>Название задачи<Input value={row.title} maxLength={240} onChange={(_, data) => updateRow(index, { title: data.value })} /></label> : null}
          {row.mode === "create" ? <><label>{preview.annualWorkPlan ? "Основной исполнитель («Бажарувчи»)" : "Ответственный / исполнитель"}<WorkspaceSelect value={row.assigneeId} onChange={(event) => { updateRow(index, { assigneeId: event.target.value, coAssigneeIds: row.coAssigneeIds.filter((id) => id !== event.target.value), observerIds: row.observerIds.filter((id) => id !== event.target.value) }); setParticipantsReviewed(false); }}><option value="">Выберите сотрудника</option>{activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</WorkspaceSelect></label><label>Срок, если указан в плане<input type="date" value={row.dueDate} onChange={(event) => updateRow(index, { dueDate: event.target.value, deadlineManuallyReviewed: Boolean(event.target.value), historicalCompleted: row.historicalCompleted && pastReviewedDate(event.target.value) })} /></label>
            {preview.annualWorkPlan ? <><label className="task-plan-import-wide">План выполнения · {row.checklist.length} пунктов<textarea value={row.checklist.join("\n")} onChange={(event) => updateRow(index, { checklist: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) })} rows={Math.min(5, Math.max(2, row.checklist.length))} /></label><label className="task-plan-import-wide">Описание и ожидаемый результат<textarea value={row.description} onChange={(event) => updateRow(index, { description: event.target.value })} rows={3} maxLength={20_000} /></label>{row.greenCompletion ? <label className="task-plan-import-completed"><input type="checkbox" checked={row.historicalCompleted} disabled={!pastReviewedDate(row.dueDate) || (row.deadlineNeedsReview && !row.deadlineManuallyReviewed)} onChange={(event) => updateRow(index, { historicalCompleted: event.target.checked })} />Создать как завершённую (зелёный пункт, срок прошёл)</label> : null}</> : null}
            <div className="task-plan-import-participants">
              <span>Соисполнители: {row.coAssigneeIds.length
                ? row.coAssigneeIds.map((id) => activePeople.find((person) => person.id === id)?.name ?? id).join(", ")
                : "не выбраны"}</span>
              <Button appearance="secondary" aria-expanded={expandedParticipantsRow === index} onClick={() => setExpandedParticipantsRow((current) => current === index ? null : index)}>Изменить соисполнителей пункта {index + 1}</Button>
              {expandedParticipantsRow === index ? <label>Соисполнители пункта {index + 1}
                <WorkspaceSelect multiple value={row.coAssigneeIds} onChange={(event) => {
                  const coAssigneeIds = event.currentTarget.selectedOptions.map((option) => option.value).filter((id) => id !== row.assigneeId);
                  updateRow(index, { coAssigneeIds, observerIds: row.observerIds.filter((id) => !coAssigneeIds.includes(id)) });
                  setParticipantsReviewed(false);
                }}>{activePeople.map((person) => <option key={person.id} value={person.id} disabled={person.id === row.assigneeId}>{person.name}</option>)}</WorkspaceSelect>
              </label> : null}
            </div>
            {preview.annualWorkPlan ? <div className="task-plan-import-participants">
              <span>Наблюдатели («Масъул»): {row.observerIds.length
                ? row.observerIds.map((id) => activePeople.find((person) => person.id === id)?.name ?? id).join(", ")
                : "не выбраны"}</span>
              <Button appearance="secondary" aria-expanded={expandedObserversRow === index} onClick={() => setExpandedObserversRow((current) => current === index ? null : index)}>Изменить наблюдателей пункта {index + 1}</Button>
              {expandedObserversRow === index ? <label>Наблюдатели пункта {index + 1}<WorkspaceSelect multiple value={row.observerIds} onChange={(event) => {
                updateRow(index, { observerIds: event.currentTarget.selectedOptions.map((option) => option.value)
                  .filter((id) => id !== row.assigneeId && !row.coAssigneeIds.includes(id)) });
                setParticipantsReviewed(false);
              }}>{activePeople.map((person) => <option key={person.id} value={person.id}
                disabled={person.id === row.assigneeId || row.coAssigneeIds.includes(person.id)}>{person.name}</option>)}</WorkspaceSelect></label> : null}
            </div> : null}</> : null}
          {row.mode === "link" ? <label>Существующая задача<WorkspaceSelect value={row.taskId} onChange={(event) => updateRow(index, { taskId: event.target.value })}><option value="">Выберите задачу</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</WorkspaceSelect></label> : null}
        </fieldset>)}</div>
        <div className="task-plan-import-footer"><Button appearance="primary" disabled={busy || rows.every((row) => row.mode === "skip")} onClick={() => void confirm()}>{busy ? "Сохраняем…" : "Подтвердить и создать план"}</Button><Button disabled={busy} onClick={onClose}>Отмена</Button></div>
      </> : null}
    </>}
    {error ? <p className="task-plan-error" role="alert">{error}</p> : null}
  </section>;
}
