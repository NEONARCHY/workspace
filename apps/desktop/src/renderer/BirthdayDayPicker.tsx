import { useState } from "react";
import { Button, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { CalendarLtr20Regular, ChevronLeft20Regular, ChevronRight20Regular } from "@fluentui/react-icons";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function birthdayMonthName(month: number): string { return MONTHS[month - 1] ?? ""; }
export function birthdayMonthLength(month: number): number { return new Date(2024, month, 0).getDate(); }

export function BirthdayDayPicker({ month, day, disabled, onChange }: {
  readonly month: string;
  readonly day: string;
  readonly disabled: boolean;
  readonly onChange: (month: string, day: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<number | null>(null);
  const displayedMonth = viewMonth ?? (Number(month) || new Date().getMonth() + 1);
  const firstDayOffset = (new Date(2024, displayedMonth - 1, 1).getDay() + 6) % 7;
  const daysInMonth = birthdayMonthLength(displayedMonth);
  return <Popover open={open} onOpenChange={(_, data) => { setOpen(data.open); if (!data.open) setViewMonth(null); }} positioning="below-start" trapFocus>
    <PopoverTrigger disableButtonEnhancement><Button className="birthday-day-trigger" appearance="outline" icon={<CalendarLtr20Regular />} disabled={disabled} aria-label="Выберите день рождения">{day || "Выберите день"}</Button></PopoverTrigger>
    <PopoverSurface className="birthday-calendar" aria-label="Календарь дня рождения">
      <div className="birthday-calendar-header">
        <Button appearance="subtle" icon={<ChevronLeft20Regular />} aria-label="Предыдущий месяц" onClick={() => setViewMonth(displayedMonth === 1 ? 12 : displayedMonth - 1)} />
        <strong>{birthdayMonthName(displayedMonth)}</strong>
        <Button appearance="subtle" icon={<ChevronRight20Regular />} aria-label="Следующий месяц" onClick={() => setViewMonth(displayedMonth === 12 ? 1 : displayedMonth + 1)} />
      </div>
      <div className="birthday-calendar-grid" role="group" aria-label={`Дни месяца ${birthdayMonthName(displayedMonth)}`}>
        {WEEKDAYS.map((name) => <span className="birthday-calendar-weekday" key={name}>{name}</span>)}
        {Array.from({ length: firstDayOffset }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const value = index + 1;
          return <button key={value} type="button" aria-label={`${value} ${birthdayMonthName(displayedMonth).toLocaleLowerCase("ru")}`} aria-pressed={Number(month) === displayedMonth && Number(day) === value} onClick={() => { onChange(String(displayedMonth), String(value)); setOpen(false); setViewMonth(null); }}>{value}</button>;
        })}
        {Array.from({ length: 42 - firstDayOffset - daysInMonth }, (_, index) => <span key={`trailing-${index}`} aria-hidden="true" />)}
      </div>
    </PopoverSurface>
  </Popover>;
}
