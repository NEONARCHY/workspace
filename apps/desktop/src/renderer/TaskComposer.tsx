import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type {
  TaskCycleInput,
  TaskParticipantRole,
  WorkspacePerson,
  WorkspaceTask,
  WorkspaceTaskCreateInput,
} from "@yuksalish/contracts";
import {
  Avatar,
  Button,
  Checkbox,
  DialogSurface,
  Input,
  Textarea,
} from "@fluentui/react-components";
import {
  Add20Regular,
  Calendar20Regular,
  CheckmarkCircle20Regular,
  Delete20Regular,
  People20Regular,
} from "@fluentui/react-icons";

import { RecordComposer, RecordSection, RecordSummary } from "./RecordComposer";
import { PersonPicker } from "./PersonPicker";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { workspacePlatform } from "./platform-adapter";

type DraftParticipant = NonNullable<WorkspaceTaskCreateInput["participants"]>[number];
type DraftDependency = NonNullable<WorkspaceTaskCreateInput["dependencies"]>[number];

interface TaskComposerProps {
  readonly open: boolean;
  readonly people: readonly WorkspacePerson[];
  readonly tasks: readonly WorkspaceTask[];
  readonly currentUserId: string;
  readonly initialTitle?: string;
  readonly initialDescription?: string;
  readonly sourceLabel?: string;
  readonly onClose: () => void;
  readonly onSubmit: (
    payload: WorkspaceTaskCreateInput,
  ) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
}

const priorityLabels: Readonly<Record<WorkspaceTask["priority"], string>> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  urgent: "Срочный",
};

const cycleLabels: Readonly<Record<TaskCycleInput["scheduleKind"], string>> = {
  daily: "Каждые несколько дней",
  weekly: "Каждые несколько недель",
  monthly: "Каждые несколько месяцев",
  calendar: "По выбранным дням",
};

function dateTimeLabel(value: string): string {
  if (!value) return "Без срока";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })
    : "Проверьте дату";
}

export function TaskComposer({
  open,
  people,
  tasks,
  currentUserId,
  initialTitle = "",
  initialDescription = "",
  sourceLabel,
  onClose,
  onSubmit,
}: TaskComposerProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [project, setProject] = useState("");
  const [assigneeId, setAssigneeId] = useState(currentUserId);
  const [priority, setPriority] = useState<WorkspaceTask["priority"]>("normal");
  const [dueAt, setDueAt] = useState("");
  const [participants, setParticipants] = useState<readonly DraftParticipant[]>([]);
  const [participantId, setParticipantId] = useState("");
  const [participantRole, setParticipantRole] = useState<TaskParticipantRole>("co_assignee");
  const [checklist, setChecklist] = useState<readonly string[]>([]);
  const [checklistTitle, setChecklistTitle] = useState("");
  const [dependencies, setDependencies] = useState<readonly DraftDependency[]>([]);
  const [dependencyId, setDependencyId] = useState("");
  const [dependencyKind, setDependencyKind] = useState<"blocks" | "relates">("blocks");
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [cycleKind, setCycleKind] = useState<TaskCycleInput["scheduleKind"]>("weekly");
  const [cycleInterval, setCycleInterval] = useState("1");
  const [cycleNextRun, setCycleNextRun] = useState("");
  const [cycleCalendarRule, setCycleCalendarRule] = useState<"weekdays" | "month_days">("weekdays");
  const [cycleWeekdays, setCycleWeekdays] = useState<readonly number[]>([0]);
  const [cycleMonthDays, setCycleMonthDays] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const draftKey = `task:${currentUserId}`;
  const persistDraft = !initialTitle && !initialDescription && !sourceLabel;
  const draftReady = useRef(false);
  const draftEdited = useRef(false);

  useEffect(() => {
    const bridge = workspacePlatform;
    if (!persistDraft) return;
    let active = true;
    void bridge.loadDraft(draftKey).then((saved) => {
      if (!active || draftEdited.current || !saved) return;
      try {
        const value = JSON.parse(saved) as Record<string, unknown>;
        if (typeof value.title === "string") setTitle(value.title);
        if (typeof value.description === "string") setDescription(value.description);
        if (typeof value.project === "string") setProject(value.project);
        if (typeof value.assigneeId === "string") setAssigneeId(value.assigneeId);
        if (["low", "normal", "high", "urgent"].includes(String(value.priority))) setPriority(value.priority as WorkspaceTask["priority"]);
        if (typeof value.dueAt === "string") setDueAt(value.dueAt);
        if (Array.isArray(value.participants)) setParticipants(value.participants as DraftParticipant[]);
        if (Array.isArray(value.checklist)) setChecklist(value.checklist as string[]);
        if (Array.isArray(value.dependencies)) setDependencies(value.dependencies as DraftDependency[]);
        if (typeof value.repeatEnabled === "boolean") setRepeatEnabled(value.repeatEnabled);
        if (["daily", "weekly", "monthly", "calendar"].includes(String(value.cycleKind))) setCycleKind(value.cycleKind as TaskCycleInput["scheduleKind"]);
        if (typeof value.cycleInterval === "string") setCycleInterval(value.cycleInterval);
        if (typeof value.cycleNextRun === "string") setCycleNextRun(value.cycleNextRun);
        if (value.cycleCalendarRule === "weekdays" || value.cycleCalendarRule === "month_days") setCycleCalendarRule(value.cycleCalendarRule);
        if (Array.isArray(value.cycleWeekdays)) setCycleWeekdays(value.cycleWeekdays as number[]);
        if (typeof value.cycleMonthDays === "string") setCycleMonthDays(value.cycleMonthDays);
        void bridge.clearDraft(draftKey).catch(() => undefined);
      } catch { /* A damaged local draft must not block task creation. */ }
    }).catch(() => undefined).finally(() => { draftReady.current = true; });
    return () => { active = false; };
  }, [draftKey, persistDraft]);

  useEffect(() => {
    if (!persistDraft || !draftReady.current || !draftEdited.current) return;
    const snapshot = JSON.stringify({
      title, description, project, assigneeId, priority, dueAt, participants,
      checklist, dependencies, repeatEnabled, cycleKind, cycleInterval,
      cycleNextRun, cycleCalendarRule, cycleWeekdays, cycleMonthDays,
    });
    const save = () => { void workspacePlatform.saveDraft(draftKey, snapshot).catch(() => undefined); };
    const timer = window.setTimeout(() => {
      save();
    }, 350);
    window.addEventListener("yuksalish:prepare-web-update", save);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("yuksalish:prepare-web-update", save);
    };
  }, [draftKey, persistDraft, title, description, project, assigneeId, priority, dueAt, participants,
    checklist, dependencies, repeatEnabled, cycleKind, cycleInterval, cycleNextRun,
    cycleCalendarRule, cycleWeekdays, cycleMonthDays]);

  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people],
  );
  const tasksById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const assignee = peopleById.get(assigneeId);
  const availableParticipants = people.filter(
    (person) =>
      person.id !== assigneeId
      && !participants.some((participant) => participant.userId === person.id),
  );
  const availableDependencies = tasks.filter(
    (task) => !dependencies.some((dependency) => dependency.dependsOnTaskId === task.id),
  );

  const addParticipant = () => {
    if (!participantId || participantId === assigneeId) return;
    setParticipants((current) => [
      ...current.filter((participant) => participant.userId !== participantId),
      { userId: participantId, role: participantRole },
    ]);
    setParticipantId("");
  };

  const addChecklistItem = () => {
    const value = checklistTitle.trim();
    if (!value) return;
    setChecklist((current) => [...current, value]);
    setChecklistTitle("");
  };

  const addDependency = () => {
    if (!dependencyId) return;
    setDependencies((current) => [
      ...current.filter((dependency) => dependency.dependsOnTaskId !== dependencyId),
      { dependsOnTaskId: dependencyId, dependencyKind },
    ]);
    setDependencyId("");
  };

  const buildCycle = (): TaskCycleInput | undefined => {
    if (!repeatEnabled) return undefined;
    const interval = Number(cycleInterval);
    const monthDays = [...new Set(
      cycleMonthDays.split(/[\s,;]+/).filter(Boolean).map(Number),
    )].filter((day) => Number.isInteger(day) && day >= 1 && day <= 31)
      .sort((left, right) => left - right);
    return {
      title: title.trim(),
      scheduleKind: cycleKind,
      interval,
      calendarRule: cycleKind === "calendar" ? cycleCalendarRule : null,
      weekdays: cycleKind === "calendar" && cycleCalendarRule === "weekdays"
        ? cycleWeekdays
        : [],
      monthDays: cycleKind === "calendar" && cycleCalendarRule === "month_days"
        ? monthDays
        : [],
      timezone: "Asia/Tashkent",
      nextRunAt: cycleNextRun ? new Date(cycleNextRun).toISOString() : null,
      isEnabled: true,
    };
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      setError("Укажите название задачи.");
      return;
    }
    if (!assigneeId) {
      setError("Выберите ответственного сотрудника.");
      return;
    }
    if (dueAt) {
      const dueTime = new Date(dueAt).getTime();
      if (!Number.isFinite(dueTime)) {
        setError("Проверьте срок задачи.");
        return;
      }
      if (dueTime <= Date.now()) {
        setError("Для новой задачи укажите будущий срок.");
        return;
      }
    }
    if (repeatEnabled) {
      const interval = Number(cycleInterval);
      if (!Number.isInteger(interval) || interval < 1 || interval > 365) {
        setError("Интервал повторения должен быть от 1 до 365.");
        return;
      }
      if (cycleNextRun && new Date(cycleNextRun).getTime() <= Date.now()) {
        setError("Ближайшее повторение должно быть в будущем.");
        return;
      }
      if (
        cycleKind === "calendar"
        && cycleCalendarRule === "weekdays"
        && cycleWeekdays.length === 0
      ) {
        setError("Выберите хотя бы один день недели.");
        return;
      }
      if (
        cycleKind === "calendar"
        && cycleCalendarRule === "month_days"
        && !cycleMonthDays.split(/[\s,;]+/).some((value) => {
          const day = Number(value);
          return Number.isInteger(day) && day >= 1 && day <= 31;
        })
      ) {
        setError("Укажите хотя бы одно число месяца от 1 до 31.");
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      const created = await onSubmit({
        title: title.trim(),
        description: description.trim(),
        project: project.trim() || "Без проекта",
        assigneeId,
        priority,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        participants,
        checklist: checklist.map((item) => ({ title: item })),
        dependencies,
        cycle: buildCycle(),
      });
      if (created === undefined) {
        setError("Не удалось добавить задачу. Проверьте подключение и повторите.");
      } else if (persistDraft) {
        void workspacePlatform.clearDraft(draftKey).catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => { if (!data.open && !busy) onClose(); }}>
      <DialogSurface className="record-composer-dialog task-composer-dialog" aria-labelledby="task-composer-title">
        <form
          className="record-composer task-composer"
          noValidate
          aria-busy={busy}
          onChangeCapture={() => { draftEdited.current = true; }}
          onSubmit={(event) => void submit(event)}
        >
          <RecordComposer
            title="Новая задача"
            titleId="task-composer-title"
            eyebrow="Задачи / Создание"
            busy={busy}
            error={error}
            submitLabel="Добавить задачу"
            submitDisabled={!title.trim() || !assigneeId}
            hint="Задача и все её правила сохранятся одним действием."
            onClose={onClose}
            aside={(
              <>
                <RecordSummary title="Предварительный просмотр">
                  <div className="task-composer-preview">
                    <span className={`task-priority priority-${priority}`}>
                      {priorityLabels[priority]} приоритет
                    </span>
                    <strong>{title.trim() || "Название новой задачи"}</strong>
                    <p>{description.trim() || "Добавьте ожидаемый результат и важные детали."}</p>
                    <dl className="record-summary-facts">
                      <div><dt>Ответственный</dt><dd>{assignee?.name ?? "Не выбран"}</dd></div>
                      <div><dt>Проект</dt><dd>{project.trim() || "Без проекта"}</dd></div>
                      <div><dt>Срок</dt><dd>{dateTimeLabel(dueAt)}</dd></div>
                    </dl>
                  </div>
                </RecordSummary>
                <RecordSummary title="Что произойдёт">
                  <ul className="task-composer-rule-summary">
                    <li><People20Regular aria-hidden="true" /><span>Участники получат доступ к карточке и её чату.</span></li>
                    <li><CheckmarkCircle20Regular aria-hidden="true" /><span>Готовый результат отправится постановщику на проверку.</span></li>
                    <li><Calendar20Regular aria-hidden="true" /><span>{repeatEnabled ? `Новая задача будет появляться: ${cycleLabels[cycleKind].toLocaleLowerCase("ru")}.` : "Задача создастся без автоматического повторения."}</span></li>
                  </ul>
                </RecordSummary>
                {sourceLabel ? <RecordSummary title="Источник"><p>{sourceLabel}</p></RecordSummary> : null}
              </>
            )}
          >
            <RecordSection title="Основная информация" description="Опишите результат так, чтобы его можно было однозначно проверить.">
              <div className="record-field-grid">
                <label className="record-field-wide">
                  <span>Название <b aria-hidden="true">*</b></span>
                  <Input
                    autoFocus
                    aria-label="Название задачи"
                    maxLength={240}
                    value={title}
                    onChange={(_, data) => setTitle(data.value)}
                  />
                  <small>{title.length}/240</small>
                </label>
                <label className="record-field-wide">
                  <span>Описание и ожидаемый результат</span>
                  <Textarea
                    aria-label="Описание новой задачи"
                    maxLength={20_000}
                    resize="vertical"
                    value={description}
                    onChange={(_, data) => setDescription(data.value)}
                  />
                </label>
                <label>
                  <span>Проект</span>
                  <Input
                    aria-label="Проект новой задачи"
                    maxLength={96}
                    placeholder="Без проекта"
                    value={project}
                    onChange={(_, data) => setProject(data.value)}
                  />
                </label>
                <label>
                  <span>Ответственный <b aria-hidden="true">*</b></span>
                  <PersonPicker
                    label="Ответственный новой задачи"
                    people={people}
                    disabled={busy}
                    value={assigneeId}
                    onChange={(next) => {
                      setAssigneeId(next);
                      setParticipants((current) => current.filter((item) => item.userId !== next));
                    }}
                  />
                </label>
                <label>
                  <span>Срок</span>
                  <input
                    aria-label="Срок новой задачи"
                    type="datetime-local"
                    value={dueAt}
                    onChange={(event) => setDueAt(event.target.value)}
                  />
                  <small>Для новой задачи можно выбрать только будущее время.</small>
                </label>
                <label>
                  <span>Приоритет</span>
                  <select
                    aria-label="Приоритет новой задачи"
                    value={priority}
                    onChange={(event) => setPriority(event.target.value as WorkspaceTask["priority"])}
                  >
                    {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </div>
            </RecordSection>

            <RecordSection collapsible summary={participants.length ? `${participants.length} участников` : "Добавить соисполнителей и наблюдателей"} title="Команда" description="Соисполнители работают с задачей, наблюдатели следят за ходом работы.">
              <div className="task-composer-add-row participant-add-row">
                <PersonPicker label="Участник новой задачи" people={availableParticipants} value={participantId} onChange={setParticipantId} disabled={busy} />
                <select aria-label="Роль участника новой задачи" value={participantRole} onChange={(event) => setParticipantRole(event.target.value as TaskParticipantRole)}>
                  <option value="co_assignee">Соисполнитель</option>
                  <option value="observer">Наблюдатель</option>
                </select>
                <Button type="button" icon={<Add20Regular />} disabled={!participantId} onClick={addParticipant}>Добавить</Button>
              </div>
              {participants.length ? <div className="task-composer-chip-list">
                {participants.map((participant) => {
                  const person = peopleById.get(participant.userId);
                  return <div className="task-composer-person-chip" key={participant.userId}>
                    <Avatar name={person?.name ?? "Сотрудник"} size={28} />
                    <span><strong>{person?.name ?? "Сотрудник"}</strong><small>{participant.role === "co_assignee" ? "Соисполнитель" : "Наблюдатель"}</small></span>
                    <button type="button" aria-label={`Убрать участника ${person?.name ?? ""}`} onClick={() => setParticipants((current) => current.filter((item) => item.userId !== participant.userId))}><Delete20Regular /></button>
                  </div>;
                })}
              </div> : <p className="task-composer-empty">Дополнительные участники не выбраны.</p>}
            </RecordSection>

            <RecordSection collapsible summary={checklist.length ? `${checklist.length} пунктов чек-листа` : "Разделить результат на понятные шаги"} title="План выполнения" description="Чек-лист делает объём работы понятным до начала выполнения.">
              <div className="task-composer-add-row">
                <Input
                  aria-label="Новый пункт чек-листа при создании"
                  placeholder="Например, проверить исходные данные"
                  value={checklistTitle}
                  onChange={(_, data) => setChecklistTitle(data.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addChecklistItem();
                    }
                  }}
                />
                <Button type="button" icon={<Add20Regular />} disabled={!checklistTitle.trim()} onClick={addChecklistItem}>Добавить пункт</Button>
              </div>
              {checklist.length ? <ol className="task-composer-checklist">
                {checklist.map((item, index) => <li key={`${item}-${index}`}><span>{index + 1}</span><strong>{item}</strong><button type="button" aria-label={`Удалить пункт ${item}`} onClick={() => setChecklist((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Delete20Regular /></button></li>)}
              </ol> : <p className="task-composer-empty">Чек-лист можно оставить пустым.</p>}
            </RecordSection>

            <RecordSection collapsible summary={dependencies.length ? `${dependencies.length} связанных задач` : "Связать с другими задачами"} title="Зависимости" description="Укажите задачи, которые блокируют начало или связаны с этой работой.">
              <div className="task-composer-add-row dependency-add-row">
                <select aria-label="Зависимость новой задачи" value={dependencyId} onChange={(event) => setDependencyId(event.target.value)}>
                  <option value="">Выберите задачу</option>
                  {availableDependencies.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                </select>
                <select aria-label="Тип зависимости новой задачи" value={dependencyKind} onChange={(event) => setDependencyKind(event.target.value as "blocks" | "relates")}>
                  <option value="blocks">Блокирует выполнение</option>
                  <option value="relates">Связанная задача</option>
                </select>
                <Button type="button" icon={<Add20Regular />} disabled={!dependencyId} onClick={addDependency}>Связать</Button>
              </div>
              {dependencies.length ? <div className="task-composer-dependencies">
                {dependencies.map((dependency) => <div key={dependency.dependsOnTaskId}><span><strong>{tasksById.get(dependency.dependsOnTaskId)?.title ?? "Задача"}</strong><small>{dependency.dependencyKind === "blocks" ? "Блокирует выполнение" : "Связанная задача"}</small></span><button type="button" aria-label="Убрать зависимость" onClick={() => setDependencies((current) => current.filter((item) => item.dependsOnTaskId !== dependency.dependsOnTaskId))}><Delete20Regular /></button></div>)}
              </div> : <p className="task-composer-empty">Зависимостей нет.</p>}
            </RecordSection>

            <RecordSection collapsible summary={repeatEnabled ? "Автоматическое повторение включено" : "Не повторяется"} title="Правило повторения" description="Для регулярной работы система создаст следующую задачу автоматически.">
              <Checkbox checked={repeatEnabled} label="Повторять эту задачу" onChange={(_, data) => setRepeatEnabled(data.checked === true)} />
              {repeatEnabled ? <div className="record-field-grid task-cycle-create">
                <label>
                  <span>Расписание</span>
                  <select aria-label="Расписание новой задачи" value={cycleKind} onChange={(event) => setCycleKind(event.target.value as TaskCycleInput["scheduleKind"])}>
                    {Object.entries(cycleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                {cycleKind !== "calendar" ? <label>
                  <span>Интервал</span>
                  <Input aria-label="Интервал новой задачи" min={1} max={365} type="number" value={cycleInterval} onChange={(_, data) => setCycleInterval(data.value)} />
                </label> : <label>
                  <span>Календарное правило</span>
                  <select aria-label="Календарное правило новой задачи" value={cycleCalendarRule} onChange={(event) => setCycleCalendarRule(event.target.value as "weekdays" | "month_days")}>
                    <option value="weekdays">Дни недели</option>
                    <option value="month_days">Числа месяца</option>
                  </select>
                </label>}
                <label className="record-field-wide">
                  <span>Ближайший запуск</span>
                  <input aria-label="Ближайшее повторение новой задачи" type="datetime-local" value={cycleNextRun} onChange={(event) => setCycleNextRun(event.target.value)} />
                  <small>Если не указывать дату, система рассчитает её автоматически.</small>
                </label>
                {cycleKind === "calendar" && cycleCalendarRule === "weekdays" ? <fieldset className="record-field-wide cycle-calendar-rule">
                  <legend>Дни недели</legend>
                  <div className="cycle-weekday-picker">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((label, day) => <label key={label}><input type="checkbox" checked={cycleWeekdays.includes(day)} onChange={() => setCycleWeekdays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort())} /><span>{label}</span></label>)}</div>
                </fieldset> : null}
                {cycleKind === "calendar" && cycleCalendarRule === "month_days" ? <label className="record-field-wide">
                  <span>Числа месяца</span>
                  <Input aria-label="Числа месяца новой задачи" placeholder="Например: 1, 10, 25" value={cycleMonthDays} onChange={(_, data) => setCycleMonthDays(data.value)} />
                </label> : null}
              </div> : null}
            </RecordSection>
          </RecordComposer>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
