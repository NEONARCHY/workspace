import { useState } from "react";

import type { TaskPlan, TaskPlanWrite, WorkspacePerson, WorkspaceTask } from "@yuksalish/contracts";
import { Button, Input } from "@fluentui/react-components";

import { WorkspaceSelect } from "./WorkspaceSelect";
import { TaskPlanImportView } from "./TaskPlanImportView";

const kindLabels: Readonly<Record<TaskPlan["kind"], string>> = {
  work: "Иш режа",
  regional: "Региональный план",
  other: "Другой план",
};

interface TaskPlansViewProps {
  readonly plans: readonly TaskPlan[];
  readonly tasks: readonly WorkspaceTask[];
  readonly people?: readonly WorkspacePerson[];
  readonly token?: string;
  readonly currentUserId?: string;
  readonly onImported?: (plan: TaskPlan) => Promise<void>;
  readonly loading: boolean;
  readonly error: string;
  readonly onRetry: () => void;
  readonly onCreate: (payload: TaskPlanWrite) => Promise<void>;
  readonly onSelect: (planId: string) => void;
}

export function TaskPlansView({
  plans, tasks, people = [], token, currentUserId, onImported, loading, error, onRetry, onCreate, onSelect,
}: TaskPlansViewProps) {
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TaskPlan["kind"]>("work");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const taskNames = new Map(tasks.map((task) => [task.id, task.title]));

  async function save() {
    if (!title.trim() || saving) return;
    if (periodStart && periodEnd && periodEnd < periodStart) {
      setSaveError("Конец периода не может быть раньше начала.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await onCreate({ title: title.trim(), kind, periodStart: periodStart || null, periodEnd: periodEnd || null });
      setTitle("");
      setKind("work");
      setPeriodStart("");
      setPeriodEnd("");
      setCreating(false);
    } catch {
      setSaveError("Не удалось сохранить план. Проверьте доступ и повторите.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="task-plans-workspace" aria-label="Планы задач">
    <div className="task-plans-heading">
      <div><h2>Планы</h2><p>Одна задача может входить в несколько планов. Региональный план — вид, без выбора региона.</p></div>
      <div className="task-plans-actions">
        <Button appearance="secondary" onClick={onRetry} disabled={loading}>Обновить</Button>
        {token && currentUserId && onImported ? <Button appearance="secondary" onClick={() => { setCreating(false); setImporting((value) => !value); }}>{importing ? "Закрыть импорт" : "Импортировать план"}</Button> : null}
        <Button appearance="primary" onClick={() => setCreating((value) => !value)}>{creating ? "Закрыть форму" : "Новый план"}</Button>
      </div>
    </div>
    {importing && token && currentUserId && onImported ? <TaskPlanImportView token={token} currentUserId={currentUserId} people={people} tasks={tasks} onImported={onImported} onClose={() => setImporting(false)} /> : null}
    {creating ? <div className="task-plan-form" role="region" aria-label="Новый план">
      <label>Название<Input value={title} maxLength={240} onChange={(_, data) => setTitle(data.value)} placeholder="Например, иш режа на 2026 год" /></label>
      <label>Вид<WorkspaceSelect value={kind} onChange={(event) => setKind(event.target.value as TaskPlan["kind"])}>
        {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </WorkspaceSelect></label>
      <label>Начало периода <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
      <label>Конец периода <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
      {saveError ? <p className="task-plan-error" role="alert">{saveError}</p> : null}
      <div className="task-plans-actions"><Button appearance="primary" disabled={saving || !title.trim()} onClick={() => void save()}>{saving ? "Сохраняем…" : "Сохранить план"}</Button><Button appearance="subtle" disabled={saving} onClick={() => setCreating(false)}>Отмена</Button></div>
    </div> : null}
    {loading ? <p role="status">Загружаем планы…</p> : error ? <div className="task-plan-error" role="alert">{error} <Button appearance="secondary" onClick={onRetry}>Повторить</Button></div> : plans.length === 0 ? <p className="task-plan-empty">Планов пока нет. Создайте первый план, затем привяжите задачи в их карточках.</p> : <div className="task-plan-grid">
      {plans.map((plan) => <article className="task-plan-card" key={plan.id}>
        <span className="task-plan-kind">{kindLabels[plan.kind]}</span>
        <h3>{plan.title}</h3>
        <p>{plan.periodStart || plan.periodEnd ? `${plan.periodStart ?? "Начало не указано"} — ${plan.periodEnd ?? "Конец не указан"}` : "Период не указан"}</p>
        <span>{plan.taskIds.length} доступных задач</span>
        {plan.taskIds.length ? <ul>{plan.taskIds.slice(0, 3).map((id) => <li key={id}>{taskNames.get(id) ?? "Задача"}</li>)}</ul> : null}
        <Button appearance="secondary" onClick={() => onSelect(plan.id)}>Показать задачи</Button>
      </article>)}
    </div>}
  </div>;
}
