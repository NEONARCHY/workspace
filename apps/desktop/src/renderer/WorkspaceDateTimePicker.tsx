import { useEffect, useMemo, useRef, useState } from "react";

import { Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import {
  CalendarLtr20Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  Clock20Regular,
} from "@fluentui/react-icons";

type PickerMode = "date" | "datetime" | "time";

interface WorkspaceDateTimePickerProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly mode?: PickerMode;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly min?: string;
}

const monthNames = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
] as const;
const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

function two(value: number) {
  return String(value).padStart(2, "0");
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${two(value.getMonth() + 1)}-${two(value.getDate())}`;
}

function datePart(value: string) {
  return value.includes("T") ? value.split("T")[0] ?? "" : value;
}

function timePart(value: string) {
  if (value.includes("T")) return (value.split("T")[1] ?? "").slice(0, 5);
  return /^\d{2}:\d{2}$/.test(value) ? value : "";
}

function validDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const result = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(result.getTime()) ? undefined : result;
}

function initialMonth(value: string, min?: string) {
  return validDate(datePart(value)) ?? validDate(datePart(min ?? "")) ?? new Date();
}

function displayValue(value: string, mode: PickerMode) {
  if (!value) return mode === "date" ? "Выберите дату" : mode === "time" ? "Выберите время" : "Выберите дату и время";
  if (mode === "time") return value;
  const date = validDate(datePart(value));
  if (!date) return value;
  const formatted = date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
  return mode === "datetime" && timePart(value) ? `${formatted}, ${timePart(value)}` : formatted;
}

function calendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - offset);
  return Array.from({ length: 42 }, (_unused, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function WorkspaceDateTimePicker({
  value,
  onChange,
  mode = "datetime",
  ariaLabel,
  disabled = false,
  required = false,
  min,
}: WorkspaceDateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => initialMonth(value, min));
  const [clockMode, setClockMode] = useState<12 | 24>(24);
  const selectedDate = datePart(value);
  const selectedTime = timePart(value) || "09:00";
  const [hourText, minuteText] = selectedTime.split(":");
  const hour = Number(hourText || 9);
  const minute = Number(minuteText || 0);
  const hourWheel = useRef<HTMLDivElement>(null);
  const minuteWheel = useRef<HTMLDivElement>(null);
  const days = useMemo(() => calendarDays(month), [month]);
  const minimumDate = datePart(min ?? "");

  useEffect(() => {
    if (!open || mode === "date") return;
    requestAnimationFrame(() => {
      hourWheel.current?.querySelector<HTMLElement>("[aria-selected='true']")?.scrollIntoView({ block: "center" });
      minuteWheel.current?.querySelector<HTMLElement>("[aria-selected='true']")?.scrollIntoView({ block: "center" });
    });
  }, [open, mode, clockMode, hour, minute]);

  const updateDate = (nextDate: string) => {
    if (mode === "date") {
      onChange(nextDate);
      setOpen(false);
      return;
    }
    onChange(`${nextDate}T${selectedTime}`);
  };
  const updateTime = (nextHour: number, nextMinute: number) => {
    const next = `${two(nextHour)}:${two(nextMinute)}`;
    onChange(mode === "time" ? next : `${selectedDate || dateKey(new Date())}T${next}`);
  };
  const twelveHour = hour % 12 || 12;
  const period = hour >= 12 ? "PM" : "AM";
  const visibleHours = clockMode === 24 ? Array.from({ length: 24 }, (_, index) => index) : Array.from({ length: 12 }, (_, index) => index + 1);

  return <><input
    className="ws-date-time-required-proxy"
    tabIndex={-1}
    aria-label={ariaLabel}
    required={required}
    disabled={disabled}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    onInvalid={() => setOpen(true)}
  /><Popover open={open} onOpenChange={(_event, data) => {
    setOpen(data.open);
    if (data.open) setMonth(initialMonth(value, min));
  }} positioning="below-start" trapFocus>
    <PopoverTrigger disableButtonEnhancement>
      <button
        type="button"
        className={`ws-date-time-trigger${value ? " has-value" : ""}`}
        aria-label={`${ariaLabel ?? "Дата и время"}: открыть выбор`}
        aria-required={required || undefined}
        disabled={disabled}
      >
        {mode === "time" ? <Clock20Regular aria-hidden="true" /> : <CalendarLtr20Regular aria-hidden="true" />}
        <span>{displayValue(value, mode)}</span>
      </button>
    </PopoverTrigger>
    <PopoverSurface className="ws-date-time-popover" aria-label={ariaLabel ?? "Выбор даты и времени"}>
      {mode !== "time" ? <div className="ws-calendar-panel">
        <header>
          <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Предыдущий месяц"><ChevronLeft20Regular /></button>
          <strong>{monthNames[month.getMonth()]} {month.getFullYear()}</strong>
          <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Следующий месяц"><ChevronRight20Regular /></button>
        </header>
        <div className="ws-calendar-weekdays" aria-hidden="true">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="ws-calendar-days" role="grid">
          {days.map((date) => {
            const key = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
            const outside = date.getMonth() !== month.getMonth();
            const today = key === dateKey(new Date());
            return <button
              type="button"
              role="gridcell"
              key={key}
              className={`${outside ? "is-outside " : ""}${today ? "is-today " : ""}${selectedDate === key ? "is-selected" : ""}`}
              aria-selected={selectedDate === key}
              disabled={Boolean(minimumDate && key < minimumDate)}
              onClick={() => updateDate(key)}
            >{date.getDate()}</button>;
          })}
        </div>
        <button type="button" className="ws-calendar-today" onClick={() => updateDate(dateKey(new Date()))}>Сегодня</button>
      </div> : null}
      {mode !== "date" ? <div className="ws-time-panel">
        <header><span><Clock20Regular aria-hidden="true" /> Время</span><span className="ws-clock-mode" role="group" aria-label="Формат времени"><button type="button" aria-pressed={clockMode === 24} onClick={() => setClockMode(24)}>24</button><button type="button" aria-pressed={clockMode === 12} onClick={() => setClockMode(12)}>12</button></span></header>
        <div className="ws-time-wheels">
          <div className="ws-time-wheel" ref={hourWheel} role="listbox" aria-label="Часы">{visibleHours.map((item) => {
            const selected = clockMode === 24 ? item === hour : item === twelveHour;
            const nextHour = clockMode === 24 ? item : (item % 12) + (period === "PM" ? 12 : 0);
            return <button type="button" role="option" aria-selected={selected} key={item} onClick={() => updateTime(nextHour, minute)}>{two(item)}</button>;
          })}</div>
          <span className="ws-time-separator">:</span>
          <div className="ws-time-wheel" ref={minuteWheel} role="listbox" aria-label="Минуты">{Array.from({ length: 60 }, (_, item) => <button type="button" role="option" aria-selected={item === minute} key={item} onClick={() => updateTime(hour, item)}>{two(item)}</button>)}</div>
          {clockMode === 12 ? <div className="ws-time-period" role="group" aria-label="Половина дня"><button type="button" aria-pressed={period === "AM"} onClick={() => updateTime(hour % 12, minute)}>AM</button><button type="button" aria-pressed={period === "PM"} onClick={() => updateTime((hour % 12) + 12, minute)}>PM</button></div> : null}
        </div>
      </div> : null}
      <footer className="ws-date-time-actions">
        <button type="button" onClick={() => onChange("")}>Очистить</button>
        <button type="button" className="primary" disabled={required && !value} onClick={() => setOpen(false)}>Готово</button>
      </footer>
    </PopoverSurface>
  </Popover></>;
}
