import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type {
  TaskCycleInput,
  TaskParticipantRole,
  WorkspacePerson,
  WorkspaceDepartment,
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
  Search20Regular,
} from "@fluentui/react-icons";
import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";
import { SlidingSegmented } from "./SlidingSegmented";

import { RecordComposer, RecordSection, RecordSummary } from "./RecordComposer";
import { PersonPicker } from "./PersonPicker";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { workspacePlatform } from "./platform-adapter";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { DepartmentIcon } from "./DepartmentIcon";
import { employeeScope, type EmployeeScope } from "./employee-scope";

type DraftParticipant = NonNullable<WorkspaceTaskCreateInput["participants"]>[number];
type DraftDependency = NonNullable<WorkspaceTaskCreateInput["dependencies"]>[number];

interface TaskComposerProps {
  readonly open: boolean;
  readonly people: readonly WorkspacePerson[];
  readonly departments?: readonly WorkspaceDepartment[];
  readonly tasks: readonly WorkspaceTask[];
  readonly currentUserId: string;
  readonly initialTitle?: string;
  readonly initialDescription?: string;
  readonly initialAssigneeName?: string;
  readonly initialDueAt?: string;
  readonly sourceLabel?: string;
  readonly calendarEventId?: string;
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
  departments = [],
  tasks,
  currentUserId,
  initialTitle = "",
  initialDescription = "",
  initialAssigneeName,
  initialDueAt = "",
  sourceLabel,
  calendarEventId,
  onClose,
  onSubmit,
}: TaskComposerProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [project, setProject] = useState("");
  const [assigneeId, setAssigneeId] = useState(() => people.find((person) =>
    person.name.toLocaleLowerCase("ru-RU") === initialAssigneeName?.toLocaleLowerCase("ru-RU"),
  )?.id ?? currentUserId);
  const [priority, setPriority] = useState<WorkspaceTask["priority"]>("normal");
  const [dueAt, setDueAt] = useState(initialDueAt);
  const [participants, setParticipants] = useState<readonly DraftParticipant[]>([]);
  const [participantId, setParticipantId] = useState("");
  const [participantRole, setParticipantRole] = useState<TaskParticipantRole>("co_assignee");
  const [departmentId, setDepartmentId] = useState("");
  const [teamMode, setTeamMode] = useState<"people" | "departments">("people");
  const [teamScope, setTeamScope] = useState<EmployeeScope>("central");
  const [teamSearch, setTeamSearch] = useState("");
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
  const activePeople = people.filter((person) => !person.status || person.status === "active");
  const availableParticipants = activePeople.filter(
    (person) =>
      person.id !== assigneeId
      && !participants.some((participant) => participant.userId === person.id),
  );
  const teamQuery = teamSearch.trim().toLocaleLowerCase("ru");
  const filteredTeamPeople = availableParticipants.filter((person) =>
    employeeScope(person.departmentId, departments) === teamScope
    && `${person.name} ${person.jobTitle ?? ""}`.toLocaleLowerCase("ru").includes(teamQuery),
  );
  const filteredTeamDepartments = departments.filter((department) =>
    employeeScope(department.id, departments) === teamScope
    && department.assignedUsersCount > 0
    && `${department.name} ${department.code}`.toLocaleLowerCase("ru").includes(teamQuery),
  );
  const selectedDepartment = departments.find((department) => department.id === departmentId);
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

  const addDepartment = (asResponsible = false) => {
    const department = departments.find((item) => item.id === departmentId);
    if (!department) return;
    const activeIds = (department.memberIds ?? []).filter((id) => activePeople.some((person) => person.id === id));
    if (!activeIds.length) { setError("В этом отделе пока нет активных сотрудников."); return; }
    const coordinatorId = asResponsible
      ? (department.leadUserId && activeIds.includes(department.leadUserId) ? department.leadUserId : activeIds[0]!)
      : assigneeId;
    if (asResponsible) setAssigneeId(coordinatorId);
    setParticipants((current) => {
      const next = new Map(current.map((item) => [item.userId, item]));
      for (const userId of activeIds) if (userId !== coordinatorId) next.set(userId, { userId, role: asResponsible ? "co_assignee" : participantRole });
      next.delete(coordinatorId);
      return [...next.values()];
    });
    setDepartmentId(""); setError("");
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
        calendarEventId,
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
                      <div><dt>Ответственный</dt><dd>{assignee ? <EmployeeProfileLink userId={assignee.id} personName={assignee.name}>{assignee.name}</EmployeeProfileLink> : "Не выбран"}</dd></div>
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
                    people={activePeople}
                    departments={departments}
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
                  <WorkspaceDateTimePicker ariaLabel="Срок новой задачи" value={dueAt} onChange={setDueAt} />
                  <small>Для новой задачи можно выбрать только будущее время.</small>
                </label>
                <label>
                  <span>Приоритет</span>
                  <WorkspaceSelect
                    aria-label="Приоритет новой задачи"
                    variant="priority"
                    value={priority}
                    onChange={(event) => setPriority(event.target.value as WorkspaceTask["priority"])}
                  >
                    {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </WorkspaceSelect>
                </label>
              </div>
            </RecordSection>

            <RecordSection collapsible summary={participants.length ? `Дополнительно: ${participants.length}` : "Добавить соисполнителей и наблюдателей"} title="Команда" description="Добавьте людей или целый отдел к задаче.">
              <div className="task-team-builder">
                <div className="task-team-lead">
                  <Avatar name={assignee?.name ?? "Ответственный"} size={36} color="colorful" aria-hidden="true" />
                  <div><span className="task-team-lead-label">Ответственный за задачу</span><strong>{assignee?.name ?? "Не выбран"}</strong></div>
                  <p>Остальных можно добавить по одному или целым отделом.</p>
                </div>
                <SlidingSegmented className="task-team-modes" role="group" aria-label="Способ добавления участников">
                  <button type="button" aria-pressed={teamMode === "people"} onClick={() => { setTeamMode("people"); setTeamSearch(""); setDepartmentId(""); }}>Сотрудники</button>
                  {departments.length ? <button type="button" aria-pressed={teamMode === "departments"} onClick={() => { setTeamMode("departments"); setTeamSearch(""); setParticipantId(""); }}>Отдел целиком</button> : null}
                </SlidingSegmented>
                <div className="task-team-picker">
                  <div className="task-team-picker-toolbar">
                    <Input contentBefore={<Search20Regular />} aria-label={teamMode === "people" ? "Найти сотрудника для задачи" : "Найти отдел для задачи"} placeholder={teamMode === "people" ? "Имя или должность" : "Название отдела или подразделения"} value={teamSearch} onChange={(_, data) => { setTeamSearch(data.value); setParticipantId(""); setDepartmentId(""); }} />
                    <SlidingSegmented className="task-team-scopes" role="group" aria-label="Контур команды">
                      <button type="button" aria-pressed={teamScope === "central"} onClick={() => { setTeamScope("central"); setParticipantId(""); setDepartmentId(""); }}>Центральный аппарат</button>
                      <button type="button" aria-pressed={teamScope === "regional"} onClick={() => { setTeamScope("regional"); setParticipantId(""); setDepartmentId(""); }}>Регионы</button>
                    </SlidingSegmented>
                  </div>
                  {teamMode === "people" ? <>
                    <div className="task-team-options" role="group" aria-label="Доступные сотрудники">
                      {filteredTeamPeople.length ? filteredTeamPeople.map((person) => <button type="button" key={person.id} className="task-team-option" aria-pressed={participantId === person.id} onClick={() => setParticipantId(person.id)}>
                        <Avatar name={person.name} size={32} color="colorful" aria-hidden="true" />
                        <span className="task-team-option-copy"><strong>{person.name}</strong><small>{person.jobTitle || "Должность не указана"}</small></span>
                        <span className="task-team-option-state" aria-hidden="true">{participantId === person.id ? "Выбран" : "Выбрать"}</span>
                      </button>) : <p className="task-team-no-results">{teamQuery ? "По вашему запросу никого не нашли." : "В этом списке нет доступных сотрудников."}</p>}
                    </div>
                    <div className="task-team-actions">
                      <label className="task-team-role"><span>Добавить как</span><WorkspaceSelect aria-label="Роль участника новой задачи" value={participantRole} onChange={(event) => setParticipantRole(event.target.value as TaskParticipantRole)}>
                        <option value="co_assignee">Соисполнитель</option>
                        <option value="observer">Наблюдатель</option>
                      </WorkspaceSelect></label>
                      <Button type="button" appearance="primary" icon={<Add20Regular />} disabled={!participantId} onClick={addParticipant}>Добавить сотрудника</Button>
                    </div>
                  </> : <>
                    <div className="task-team-options" role="group" aria-label="Доступные отделы и подразделения">
                      {filteredTeamDepartments.length ? filteredTeamDepartments.map((department) => <button type="button" key={department.id} className="task-team-option" aria-pressed={departmentId === department.id} onClick={() => setDepartmentId(department.id)}>
                        <span className="task-team-department-icon" aria-hidden="true"><DepartmentIcon iconKey={department.iconKey} /></span>
                        <span className="task-team-option-copy"><strong>{department.name}</strong><small>{department.assignedUsersCount} сотрудников</small></span>
                        <span className="task-team-option-state" aria-hidden="true">{departmentId === department.id ? "Выбран" : "Выбрать"}</span>
                      </button>) : <p className="task-team-no-results">{teamQuery ? "Отдел не найден. Попробуйте другое название." : "В этом контуре пока нет отделов с сотрудниками."}</p>}
                    </div>
                    <div className="task-team-department-actions">
                      <div><strong>{selectedDepartment?.name ?? "Выберите отдел из списка"}</strong><p>{selectedDepartment ? "Можно добавить сотрудников или назначить отдел ответственным за задачу." : "Состав отдела появится в задаче после выбора действия."}</p></div>
                      <label className="task-team-role"><span>Роль при добавлении</span><WorkspaceSelect aria-label="Роль участников отдела" value={participantRole} onChange={(event) => setParticipantRole(event.target.value as TaskParticipantRole)}>
                        <option value="co_assignee">Соисполнители</option>
                        <option value="observer">Наблюдатели</option>
                      </WorkspaceSelect></label>
                      <div className="task-team-department-buttons">
                        <Button type="button" disabled={!departmentId} onClick={() => addDepartment(false)}>Добавить участников</Button>
                        <Button type="button" appearance="primary" disabled={!departmentId} onClick={() => addDepartment(true)}>Назначить отдел ответственным</Button>
                      </div>
                      <small>Главное лицо отдела станет ответственным; если оно не назначено — первый активный сотрудник. Остальные будут соисполнителями.</small>
                    </div>
                  </>}
                </div>
                <div className="task-team-roster-heading"><strong>Дополнительные участники</strong><span>{participants.length ? `Добавлено: ${participants.length}` : "Пока никого нет"}</span></div>
              {participants.length ? <div className="task-composer-chip-list">
                {participants.map((participant) => {
                  const person = peopleById.get(participant.userId);
                  return <div className="task-composer-person-chip" key={participant.userId}>
                    <EmployeeProfileLink userId={person?.id} personName={person?.name ?? "Сотрудник"}><Avatar name={person?.name ?? "Сотрудник"} size={28} /><span className="task-composer-person-info"><strong>{person?.name ?? "Сотрудник"}</strong><small>{participant.role === "co_assignee" ? "Соисполнитель" : "Наблюдатель"}</small></span></EmployeeProfileLink>
                    <button type="button" aria-label={`Убрать участника ${person?.name ?? ""}`} onClick={() => setParticipants((current) => current.filter((item) => item.userId !== participant.userId))}><Delete20Regular /></button>
                  </div>;
                })}
              </div> : <p className="task-team-empty">Выберите сотрудника или отдел выше. Дополнительные участники здесь появятся сразу.</p>}
              </div>
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
                <WorkspaceSelect aria-label="Зависимость новой задачи" value={dependencyId} onChange={(event) => setDependencyId(event.target.value)}>
                  <option value="">Выберите задачу</option>
                  {availableDependencies.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                </WorkspaceSelect>
                <WorkspaceSelect aria-label="Тип зависимости новой задачи" value={dependencyKind} onChange={(event) => setDependencyKind(event.target.value as "blocks" | "relates")}>
                  <option value="blocks">Блокирует выполнение</option>
                  <option value="relates">Связанная задача</option>
                </WorkspaceSelect>
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
                  <WorkspaceSelect aria-label="Расписание новой задачи" value={cycleKind} onChange={(event) => setCycleKind(event.target.value as TaskCycleInput["scheduleKind"])}>
                    {Object.entries(cycleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </WorkspaceSelect>
                </label>
                {cycleKind !== "calendar" ? <label>
                  <span>Интервал</span>
                  <Input aria-label="Интервал новой задачи" min={1} max={365} type="number" value={cycleInterval} onChange={(_, data) => setCycleInterval(data.value)} />
                </label> : <label>
                  <span>Календарное правило</span>
                  <WorkspaceSelect aria-label="Календарное правило новой задачи" value={cycleCalendarRule} onChange={(event) => setCycleCalendarRule(event.target.value as "weekdays" | "month_days")}>
                    <option value="weekdays">Дни недели</option>
                    <option value="month_days">Числа месяца</option>
                  </WorkspaceSelect>
                </label>}
                <label className="record-field-wide">
                  <span>Ближайший запуск</span>
                  <WorkspaceDateTimePicker ariaLabel="Ближайшее повторение новой задачи" value={cycleNextRun} onChange={setCycleNextRun} />
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
