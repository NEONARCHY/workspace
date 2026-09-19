import { useMemo, useState, type ReactNode } from "react";

import type { WorkspaceTask } from "@yuksalish/contracts";
import { Button } from "@fluentui/react-components";
import { ChevronLeft24Regular, ChevronRight24Regular } from "@fluentui/react-icons";

interface TaskCalendarViewProps {
  readonly tasks: readonly WorkspaceTask[];
  readonly onSelect: (taskId: string) => void;
  readonly actions?: ReactNode;
}

const weekdayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function validDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function TaskCalendarView({ tasks, onSelect, actions }: TaskCalendarViewProps) {
  const [month, setMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const todayKey = localDateKey(new Date());
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const monthLabel = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(month);
  const days = useMemo(() => {
    const firstWeekday = (month.getDay() + 6) % 7;
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const visibleDayCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    return Array.from({ length: visibleDayCount }, (_unused, index) => (
      new Date(month.getFullYear(), month.getMonth(), index - firstWeekday + 1)
    ));
  }, [month]);
  const tasksByDay = useMemo(() => {
    const grouped = new Map<string, WorkspaceTask[]>();
    for (const task of tasks) {
      const dueAt = validDate(task.dueAt);
      if (!dueAt) continue;
      const key = localDateKey(dueAt);
      grouped.set(key, [...(grouped.get(key) ?? []), task]);
    }
    for (const values of grouped.values()) {
      values.sort((left, right) => (
        new Date(left.dueAt ?? 0).getTime() - new Date(right.dueAt ?? 0).getTime()
      ));
    }
    return grouped;
  }, [tasks]);
  const unscheduled = tasks.filter((task) => !validDate(task.dueAt));
  const selectedKey = localDateKey(selectedDay);
  const selectedTasks = tasksByDay.get(selectedKey) ?? [];

  return (
    <div className="task-calendar-shell calendar-view task-calendar-embedded">
      <div className="calendar-main">
      <header className="calendar-toolbar">
        <div className="calendar-title">
          <span>Рабочий календарь</span>
          <h1>Календарь задач</h1>
          <p>{monthLabel}</p>
        </div>
        <div className="calendar-toolbar-actions">
          <div className="calendar-month-navigation" aria-label="Навигация по месяцам задач">
          <Button
            appearance="subtle"
            icon={<ChevronLeft24Regular />}
            aria-label="Предыдущий месяц задач"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          />
          <Button
            appearance="subtle"
            onClick={() => {
              const today = new Date();
              setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
              setSelectedDay(today);
            }}
          >
            Сегодня
          </Button>
          <Button
            appearance="subtle"
            icon={<ChevronRight24Regular />}
            aria-label="Следующий месяц задач"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          />
          </div>
          {actions}
        </div>
      </header>
      <div className="calendar-board task-calendar-board">
        <div className="calendar-weekdays" aria-hidden="true">
          {weekdayLabels.map((label) => <span key={label}>{label}</span>)}
        </div>
        <div
          className="calendar-grid task-calendar-grid"
          role="grid"
          aria-label={`Календарь задач: ${monthLabel}`}
          style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(0, 1fr))` }}
        >
          {days.map((day) => {
            const key = localDateKey(day);
            const dayTasks = tasksByDay.get(key) ?? [];
            return (
              <div
                className={`calendar-day task-calendar-day ${day.getMonth() === month.getMonth() ? "" : "muted"} ${key === todayKey ? "today" : ""} ${key === selectedKey ? "selected" : ""}`}
                key={key}
                role="gridcell"
                tabIndex={0}
                aria-label={`${day.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}: ${dayTasks.length} задач`}
                aria-selected={key === selectedKey}
                onClick={() => setSelectedDay(day)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedDay(day);
                  }
                }}
              >
                <div className="calendar-day-header">
                  <span className="calendar-day-number">{day.getDate()}</span>
                  {key === todayKey ? <span className="calendar-today-label">Сегодня</span> : null}
                  {dayTasks.length > 0 ? <span className="calendar-day-count">{dayTasks.length}</span> : null}
                </div>
                <div className="calendar-day-events">
                  {dayTasks.slice(0, 4).map((task) => (
                    <button
                      className={`calendar-event-pill task task-calendar-item status-${task.status} priority-${task.priority}`}
                      type="button"
                      key={task.id}
                      aria-label={`Открыть задачу: ${task.title}`}
                      onClick={(event) => { event.stopPropagation(); onSelect(task.id); }}
                    >
                      <span>{new Date(task.dueAt ?? 0).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
                      <strong>{task.title}</strong>
                    </button>
                  ))}
                  {dayTasks.length > 4 ? <span className="calendar-more-events">Ещё {dayTasks.length - 4}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </div>
      <aside className="calendar-side" aria-label="Задачи выбранного дня">
        <div className="calendar-side-heading calendar-day-heading">
          <span>Выбранный день</span>
          <h2>{selectedDay.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</h2>
          <p>{selectedTasks.length ? `${selectedTasks.length} задач по сроку` : "На этот день задач нет"}</p>
        </div>
        <div className="calendar-day-summary">
          <span>{selectedDay.getDate()}</span><p>{selectedDay.toLocaleDateString("ru-RU", { weekday: "long" })}</p><strong>{selectedTasks.length}</strong>
        </div>
        <div className="calendar-day-agenda">
          {selectedTasks.map((task) => <button className={`calendar-agenda-card task status-${task.status}`} type="button" key={task.id} onClick={() => onSelect(task.id)}>
            <span className="calendar-agenda-time">{new Date(task.dueAt ?? 0).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
            <strong>{task.title}</strong><small>{task.project || "Без проекта"}</small>
          </button>)}
        </div>
        {unscheduled.length ? <section className="task-calendar-unscheduled" aria-label="Задачи без срока">
          <div><strong>Без срока</strong><span>{unscheduled.length}</span></div>
          <div>{unscheduled.map((task) => <button type="button" key={task.id} onClick={() => onSelect(task.id)}><strong>{task.title}</strong><span>{task.project || "Без проекта"}</span></button>)}</div>
        </section> : null}
      </aside>
    </div>
  );
}
