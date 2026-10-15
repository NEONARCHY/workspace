import { WorkspaceNotice } from "./WorkspaceNotice";
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
  readonly onUpdate?: (planId: string, payload: TaskPlanWrite) => Promise<void>;
  readonly onStatusChange?: (planId: string, status: TaskPlan["status"]) => Promise<void>;
  readonly onSelect: (planId: string) => void;
}

export function TaskPlansView({
  plans, tasks, people = [], token, currentUserId, onImported, loading, error, onRetry,
  onCreate, onUpdate, onStatusChange, onSelect,
}: TaskPlansViewProps) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TaskPlan["kind"]>("work");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [ownerId, setOwnerId] = useState(currentUserId ?? "");
  const [search, setSearch] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [statusConfirmId, setStatusConfirmId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState("");
  const taskNames = new Map(tasks.map((task) => [task.id, task.title]));
  const activePeople = people.filter((person) => !person.status || person.status === "active");
  const personNames = new Map(people.map((person) => [person.id, person.name]));
  const currentRole = people.find((person) => person.id === currentUserId)?.role;
  const visiblePlans = plans.filter((plan) => (showCompleted || plan.status !== "completed")
    && (!search.trim() || `${plan.title} ${personNames.get(plan.ownerUserId) ?? ""}`
      .toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))));

  function resetForm() {
    setTitle(""); setKind("work"); setPeriodStart(""); setPeriodEnd("");
    setOwnerId(currentUserId ?? ""); setSaveError("");
    setCreating(false); setEditingId(null);
  }

  function startEdit(plan: TaskPlan) {
    setTitle(plan.title); setKind(plan.kind);
    setPeriodStart(plan.periodStart ?? ""); setPeriodEnd(plan.periodEnd ?? "");
    setOwnerId(plan.ownerUserId); setSaveError("");
    setCreating(false); setImporting(false); setEditingId(plan.id);
  }

  function canEdit(plan: TaskPlan) {
    return Boolean(currentUserId && (plan.ownerUserId === currentUserId
      || plan.createdByUserId === currentUserId || currentRole === "admin"
      || currentRole === "superadmin"));
  }

  async function save() {
    if (!title.trim() || saving) return;
    if (periodStart && periodEnd && periodEnd < periodStart) {
      setSaveError("Конец периода не может быть раньше начала.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const payload: TaskPlanWrite = {
        title: title.trim(), kind, periodStart: periodStart || null, periodEnd: periodEnd || null,
        ...(ownerId && (!editingId || plans.find((plan) => plan.id === editingId)?.ownerUserId !== ownerId)
          ? { ownerUserId: ownerId } : {}),
      };
      if (editingId) {
        if (!onUpdate) throw new Error("Plan editing is unavailable");
        await onUpdate(editingId, payload);
      } else {
        await onCreate(payload);
      }
      resetForm();
    } catch {
      setSaveError("Не удалось сохранить план. Проверьте доступ и повторите.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(plan: TaskPlan, status: TaskPlan["status"]) {
    if (!onStatusChange || statusBusyId) return;
    setStatusBusyId(plan.id); setStatusError("");
    try {
      await onStatusChange(plan.id, status);
      setStatusConfirmId(null);
    } catch {
      setStatusError(`Не удалось изменить состояние плана «${plan.title}». Повторите попытку.`);
    } finally {
      setStatusBusyId(null);
    }
  }

  return <div className="task-plans-workspace" aria-label="Планы задач">
    <div className="task-plans-heading">
      <div><h2>Планы</h2><p>Одна задача может входить в несколько планов. Региональный план — вид, без выбора региона.</p></div>
      <div className="task-plans-actions">
        <Button appearance="secondary" onClick={onRetry} disabled={loading}>Обновить</Button>
        {token && currentUserId && onImported ? <Button appearance="secondary" onClick={() => { resetForm(); setImporting((value) => !value); }}>{importing ? "Закрыть импорт" : "Импортировать план"}</Button> : null}
        <Button appearance="primary" onClick={() => {
          if (creating) resetForm(); else { resetForm(); setImporting(false); setCreating(true); }
        }}>{creating ? "Закрыть форму" : "Новый план"}</Button>
      </div>
    </div>
    {importing && token && currentUserId && onImported ? <TaskPlanImportView token={token} currentUserId={currentUserId} people={people} tasks={tasks} onImported={onImported} onClose={() => setImporting(false)} /> : null}
    {creating || editingId ? <div className="task-plan-form" role="region" aria-label={editingId ? "Изменить план" : "Новый план"}>
      <label>Название<Input value={title} maxLength={240} onChange={(_, data) => setTitle(data.value)} placeholder="Например, иш режа на 2026 год" /></label>
      <label>Постановщик<WorkspaceSelect value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
        {!currentUserId ? <option value="">Текущий пользователь</option> : null}
        {currentUserId && !activePeople.some((person) => person.id === currentUserId)
          ? <option value={currentUserId}>Текущий пользователь</option> : null}
        {editingId && ownerId !== currentUserId && !activePeople.some((person) => person.id === ownerId)
          ? <option value={ownerId}>{personNames.get(ownerId) ?? "Сотрудник"} (недоступен для новых назначений)</option> : null}
        {activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </WorkspaceSelect></label>
      <label>Вид<WorkspaceSelect value={kind} onChange={(event) => setKind(event.target.value as TaskPlan["kind"])}>
        {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </WorkspaceSelect></label>
      <label>Начало периода <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
      <label>Конец периода <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
      {saveError ? <WorkspaceNotice tone="error" className="task-plan-error" role="alert">{saveError}</WorkspaceNotice> : null}
      <div className="task-plans-actions"><Button appearance="primary" disabled={saving || !title.trim()} onClick={() => void save()}>{saving ? "Сохраняем…" : "Сохранить план"}</Button><Button appearance="subtle" disabled={saving} onClick={resetForm}>Отмена</Button></div>
    </div> : null}
    <div className="task-plan-filters">
      <label>Поиск планов<Input value={search} onChange={(_, data) => setSearch(data.value)} placeholder="Название или постановщик" /></label>
      <label className="task-plan-completed-toggle"><input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} />Показать завершённые планы</label>
    </div>
    {statusError ? <WorkspaceNotice tone="error" className="task-plan-error" role="alert">{statusError}</WorkspaceNotice> : null}
    {loading ? <p role="status">Загружаем планы…</p> : error ? <WorkspaceNotice tone="error" className="task-plan-error" role="alert" actions={<><Button appearance="secondary" onClick={onRetry}>Повторить</Button></>}>{error} </WorkspaceNotice> : visiblePlans.length === 0 ? <p className="task-plan-empty">{plans.length === 0 ? "Планов пока нет. Создайте первый план, затем привяжите задачи в их карточках." : "По выбранным условиям планов нет."}</p> : <div className="task-plan-grid">
      {visiblePlans.map((plan) => <article className="task-plan-card" key={plan.id}>
        <div className="task-plan-card-meta"><span className="task-plan-kind">{kindLabels[plan.kind]}</span><span className="task-plan-status">{plan.status === "completed" ? "Завершённый" : "Активный"}</span></div>
        <h3>{plan.title}</h3>
        <p>Постановщик: {personNames.get(plan.ownerUserId) ?? "Сотрудник"}</p>
        <p>{plan.periodStart || plan.periodEnd ? `${plan.periodStart ?? "Начало не указано"} — ${plan.periodEnd ?? "Конец не указан"}` : "Период не указан"}</p>
        <span>{plan.taskIds.length} доступных задач</span>
        {plan.taskIds.length ? <ul>{plan.taskIds.slice(0, 3).map((id) => <li key={id}>{taskNames.get(id) ?? "Задача"}</li>)}</ul> : null}
        <div className="task-plan-card-actions">
          <Button appearance="secondary" onClick={() => onSelect(plan.id)}>Показать задачи</Button>
          {canEdit(plan) && onUpdate ? <Button appearance="subtle" disabled={saving} onClick={() => startEdit(plan)}>Изменить</Button> : null}
          {canEdit(plan) && onStatusChange ? <Button appearance="subtle" disabled={statusBusyId === plan.id} onClick={() => {
            if (plan.status === "active") setStatusConfirmId(plan.id);
            else void changeStatus(plan, "active");
          }}>{plan.status === "active" ? "Завершить план" : "Вернуть в активные"}</Button> : null}
        </div>
        {statusConfirmId === plan.id ? <div className="task-plan-status-confirm" role="group" aria-label={`Завершение плана ${plan.title}`}>
          <p>Задачи останутся в «Задачах» и сохранят связь с планом.</p>
          <Button appearance="primary" disabled={statusBusyId === plan.id} onClick={() => void changeStatus(plan, "completed")}>{statusBusyId === plan.id ? "Сохраняем…" : "Подтвердить завершение"}</Button>
          <Button appearance="subtle" disabled={statusBusyId === plan.id} onClick={() => setStatusConfirmId(null)}>Отмена</Button>
        </div> : null}
      </article>)}
    </div>}
  </div>;
}
