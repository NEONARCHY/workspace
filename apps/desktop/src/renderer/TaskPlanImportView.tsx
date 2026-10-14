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
  dueDate: string;
  taskId: string;
  assigneeHint: string | null;
  coexecutorsHint: string | null;
  groupKey: string | null;
};

function matchingPersonId(hint: string, people: readonly WorkspacePerson[]): string | null {
  const match = hint.match(/([\p{L}])\s*\.\s*([\p{L}-]+)/u);
  if (!match) return null;
  const initial = match[1]?.toLocaleLowerCase();
  const surname = match[2]?.toLocaleLowerCase();
  const matching = people.filter((person) => {
    const words: string[] = person.name.toLocaleLowerCase().match(/[\p{L}-]+/gu) ?? [];
    return words.includes(surname ?? "") && words.some((word) => word !== surname && word.startsWith(initial ?? ""));
  });
  return matching.length === 1 ? matching[0]?.id ?? null : null;
}

function suggestedCoAssignees(hint: string, people: readonly WorkspacePerson[]): string[] {
  const names = hint.match(/[\p{L}]\s*\.\s*[\p{L}-]+/gu) ?? [];
  return [...new Set(names.map((name) => matchingPersonId(name, people)).filter((id): id is string => Boolean(id)))];
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
  const [participantsReviewed, setParticipantsReviewed] = useState(false);
  const [operationId, setOperationId] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"work" | "regional" | "other">("work");
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
        const assigneeId = row.groupKey
          ? row.assigneeHint ? matchingPersonId(row.assigneeHint, activePeople) ?? "" : ""
          : currentUserId;
        return {
          ...row, mode: "create", assigneeId,
          coAssigneeIds: row.coexecutorsHint
            ? suggestedCoAssignees(row.coexecutorsHint, activePeople).filter((id) => id !== assigneeId) : [],
          dueDate: "", taskId: "", assigneeHint: row.assigneeHint ?? null,
          coexecutorsHint: row.coexecutorsHint ?? null, groupKey: row.groupKey ?? null,
        };
      }));
      setGroupParticipants(Object.fromEntries([...new Map(result.rows.filter((row) => row.groupKey)
        .map((row) => [row.groupKey!, row.coexecutorsHint ?? ""]))].map(([key, hint]) => [
        key, suggestedCoAssignees(hint, activePeople),
      ])));
      setParticipantsReviewed(false);
      setExpandedParticipantsRow(null);
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
    if (!title.trim() || included.length === 0 || included.some((row) => !row.title.trim())
      || included.some((row) => row.mode === "link" && !row.taskId)
      || included.some((row) => row.mode === "create" && !row.assigneeId)) {
      setError("Укажите название плана и проверьте каждый включённый пункт.");
      return;
    }
    if (hasStructuredAssignments && !participantsReviewed) {
      setError("Проверьте ответственного и соисполнителей по строкам документа, затем подтвердите проверку.");
      return;
    }
    const duplicateRoleIndex = rows.findIndex((row) => row.mode === "create"
      && row.coAssigneeIds.includes(row.assigneeId));
    if (duplicateRoleIndex !== -1) {
      setError(`Пункт ${duplicateRoleIndex + 1}: ответственный не может быть соисполнителем этой задачи.`);
      return;
    }
    if (periodStart && periodEnd && periodEnd < periodStart) {
      setError("Конец периода не может быть раньше начала.");
      return;
    }
    const payload: TaskPlanImportConfirm = {
      operationId,
      plan: { title: title.trim(), kind, periodStart: periodStart || null, periodEnd: periodEnd || null },
      items: included.map((row) => ({
        title: row.title.trim(), source: row.source,
        mode: row.mode === "link" ? "link" : "create",
        taskId: row.mode === "link" ? row.taskId : null,
        assigneeId: row.mode === "create" ? row.assigneeId : null,
        coAssigneeIds: row.mode === "create" ? row.coAssigneeIds : [],
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
          setOperationId(""); setError("");
        }} /></label>
        <Button appearance="secondary" disabled={!file || busy} onClick={() => void analyze()}>{busy && !preview ? "Разбираем…" : "Разобрать документ"}</Button>
      </div>
      {preview ? <>
        <p>Найдено {rows.length} возможных пунктов. Удалите лишние, уточните названия, исполнителей и сроки. Ничего не создаётся до подтверждения.</p>
        <div className="task-plan-import-fields">
          <label>Название плана<Input value={title} maxLength={240} onChange={(_, data) => setTitle(data.value)} /></label>
          <label>Вид<WorkspaceSelect value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="work">Иш режа</option><option value="regional">Региональный план</option><option value="other">Другой план</option></WorkspaceSelect></label>
          <label>Начало периода<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
          <label>Конец периода<input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
        </div>
        {hasStructuredAssignments ? <section className="task-plan-import-assignments" aria-label="Назначения из документа">
          <h4>Назначения из недельного плана</h4>
          <p>Ответственный из заголовка предложен для пунктов обеих рабочих колонок. Если сотрудник не найден однозначно, выберите его ниже — автору плана задача автоматически не назначается. Ответственного и соисполнителей можно изменить отдельно у каждой задачи. Названия отделов не превращаются в сотрудников автоматически.</p>
          <p>В заголовке: {rows.find((row) => row.assigneeHint)?.assigneeHint ?? "ответственный не указан"}</p>
          <label>Ответственный для всех новых задач
            <WorkspaceSelect value={rows.find((row) => row.mode === "create")?.assigneeId ?? ""} onChange={(event) => {
              setRows((current) => current.map((row) => row.mode === "create"
                ? { ...row, assigneeId: event.target.value } : row));
              setParticipantsReviewed(false);
            }}><option value="">Выберите сотрудника</option>{activePeople.map((person) =>
              <option key={person.id} value={person.id}>{person.name}</option>)}</WorkspaceSelect>
          </label>
          <div className="task-plan-import-groups">{groups.map(([groupKey, hint]) => <div key={groupKey}>
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
          </div>)}</div>
          <label className="task-plan-import-review"><input type="checkbox" checked={participantsReviewed} onChange={(event) => setParticipantsReviewed(event.target.checked)} />Я проверил ответственного и соисполнителей для каждого включённого пункта; отделы и неясные имена сопоставлены вручную или сознательно не назначены.</label>
        </section> : null}
        <div className="task-plan-import-rows">{rows.map((row, index) => <fieldset key={`${row.source}-${index}`}>
          <legend>Пункт {index + 1} · {row.source}</legend>
          {row.warning ? <p className="task-plan-import-warning">{row.warning}</p> : null}
          <label>Действие<WorkspaceSelect value={row.mode} onChange={(event) => updateRow(index, { mode: event.target.value as ReviewRow["mode"] })}><option value="create">Создать задачу</option><option value="link">Привязать существующую</option><option value="skip">Не включать</option></WorkspaceSelect></label>
          {row.mode !== "skip" ? <label>Название задачи<Input value={row.title} maxLength={240} onChange={(_, data) => updateRow(index, { title: data.value })} /></label> : null}
          {row.mode === "create" ? <><label>Ответственный / исполнитель<WorkspaceSelect value={row.assigneeId} onChange={(event) => { updateRow(index, { assigneeId: event.target.value, coAssigneeIds: row.coAssigneeIds.filter((id) => id !== event.target.value) }); setParticipantsReviewed(false); }}><option value="">Выберите сотрудника</option>{activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</WorkspaceSelect></label><label>Срок, если указан в плане<input type="date" value={row.dueDate} onChange={(event) => updateRow(index, { dueDate: event.target.value })} /></label>
            <div className="task-plan-import-participants">
              <span>Соисполнители: {row.coAssigneeIds.length
                ? row.coAssigneeIds.map((id) => activePeople.find((person) => person.id === id)?.name ?? id).join(", ")
                : "не выбраны"}</span>
              <Button appearance="secondary" aria-expanded={expandedParticipantsRow === index} onClick={() => setExpandedParticipantsRow((current) => current === index ? null : index)}>Изменить соисполнителей пункта {index + 1}</Button>
              {expandedParticipantsRow === index ? <label>Соисполнители пункта {index + 1}
                <WorkspaceSelect multiple value={row.coAssigneeIds} onChange={(event) => {
                  updateRow(index, { coAssigneeIds: event.currentTarget.selectedOptions.map((option) => option.value).filter((id) => id !== row.assigneeId) });
                  setParticipantsReviewed(false);
                }}>{activePeople.map((person) => <option key={person.id} value={person.id} disabled={person.id === row.assigneeId}>{person.name}</option>)}</WorkspaceSelect>
              </label> : null}
            </div></> : null}
          {row.mode === "link" ? <label>Существующая задача<WorkspaceSelect value={row.taskId} onChange={(event) => updateRow(index, { taskId: event.target.value })}><option value="">Выберите задачу</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</WorkspaceSelect></label> : null}
        </fieldset>)}</div>
        <div className="task-plan-import-footer"><Button appearance="primary" disabled={busy || rows.every((row) => row.mode === "skip")} onClick={() => void confirm()}>{busy ? "Сохраняем…" : "Подтвердить и создать план"}</Button><Button disabled={busy} onClick={onClose}>Отмена</Button></div>
      </> : null}
    </>}
    {error ? <p className="task-plan-error" role="alert">{error}</p> : null}
  </section>;
}
