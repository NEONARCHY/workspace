import type { CalendarEvent, WorkspacePerson, ZoomMeeting } from "@yuksalish/contracts";
import { useRestoreFocusTarget } from "@fluentui/react-components";
import { CalendarIcon, calendarAppearanceStyle } from "./CalendarAppearance";
import { calendarDateKey, calendarScheduleGroups, type CalendarScheduleItem } from "./calendar-filters";
import { employeeDisplayName } from "./employee-display-name";

export function CalendarSchedule({ items, showDates = false, periodStart, currentUserId, people, onEvent, onZoom, disabled = false }: {
  readonly items: readonly CalendarScheduleItem[];
  readonly showDates?: boolean;
  readonly periodStart?: string;
  readonly currentUserId: string;
  readonly people: readonly WorkspacePerson[];
  readonly onEvent: (event: CalendarEvent) => void;
  readonly onZoom: (meeting: ZoomMeeting) => void;
  readonly disabled?: boolean;
}) {
  const eventFocusTarget = useRestoreFocusTarget();
  const renderCard = (item: CalendarScheduleItem) => {
      const start = new Date(item.record.startsAt);
      const end = new Date(item.record.endsAt);
      const actualDay = calendarDateKey(start);
      const lastDay = calendarDateKey(new Date(end.getTime() - 1));
      const ids = item.kind === "event" ? item.record.attendeeIds : item.record.participantIds;
      const person = people.find(person => person.id === item.record.organizerUserId);
      const pending = item.kind === "event" && item.record.attendees.some(attendee => attendee.userId === currentUserId && attendee.status === "pending");
      const time = item.kind === "event" && item.record.allDay ? "Весь день"
        : `${start.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
      return <div className="calendar-schedule-entry" key={item.key}>
        <button {...eventFocusTarget} type="button" className={`calendar-agenda-card ${item.kind === "zoom" ? "zoom" : `${item.record.eventType} ${item.record.status}`}`}
          disabled={disabled}
          title={item.title}
          style={item.kind === "event" ? calendarAppearanceStyle(item.record) : undefined}
          onClick={click => {
            // Touch/Safari and programmatic activation need not focus a button.
            // Give Fluent an actual return target inside the parent modal.
            click.currentTarget.focus({ preventScroll: true });
            if (item.kind === "event") onEvent(item.record); else onZoom(item.record);
          }}>
          <span className="calendar-agenda-time"><CalendarIcon zoom={item.kind === "zoom"} iconKey={item.kind === "event" ? item.record.iconKey : undefined} />{time}</span>
          <strong>{item.title}</strong>
          <small>{item.kind === "zoom" ? `Zoom-конференция · ${employeeDisplayName(item.record.organizerName)}` : item.record.location || person?.name || "Мероприятие"}</small>
          <span className="calendar-agenda-meta">Участников: {ids.length}{pending ? " · Нужно подтвердить участие" : ""}</span>
          {actualDay !== lastDay && <span className="calendar-agenda-meta">{start.toLocaleDateString("ru-RU")} — {new Date(end.getTime() - 1).toLocaleDateString("ru-RU")}</span>}
          {item.record.status === "cancelled" && <em>Отменено</em>}
        </button>
      </div>;
  };
  if (!showDates) return <div className="calendar-schedule-items">{items.map(renderCard)}</div>;
  return <div className="calendar-tile-days">{calendarScheduleGroups(items, periodStart).map(group => {
    const label = new Date(`${group.day}T00:00:00`).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return <section className="calendar-schedule-day" key={group.day} aria-label={label}>
      <header><h3 className="calendar-schedule-date">{label}</h3><span>Показано: {group.items.length}</span></header>
      <div className="calendar-schedule-tiles">{group.items.map(renderCard)}</div>
    </section>;
  })}</div>;
}
