import { Button } from "@fluentui/react-components";
import type { WorkspacePerson, ZoomMeeting } from "@yuksalish/contracts";
import { CalendarIcon } from "./CalendarAppearance";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { employeeDisplayName } from "./employee-display-name";

export function CalendarZoomDetails({ meeting, people, onOpen }: {
  readonly meeting: ZoomMeeting;
  readonly people: readonly WorkspacePerson[];
  readonly onOpen?: () => void;
}) {
  const start = new Date(meeting.startsAt);
  const end = new Date(meeting.endsAt);
  const sameDay = start.toDateString() === end.toDateString();
  return <div className="calendar-detail">
    <div className="calendar-detail-hero"><CalendarIcon zoom />
      <span className="calendar-type">Zoom-конференция</span>
      <p className="calendar-detail-time">{start.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}–{end.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</p>
    </div>
    <dl className="calendar-detail-list">
      <div><dt>Дата</dt><dd>{start.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}{sameDay ? "" : ` — ${end.toLocaleDateString("ru-RU")}`}</dd></div>
      <div><dt>Организатор</dt><dd>{employeeDisplayName(meeting.organizerName)}</dd></div>
      <div className="calendar-detail-attendees"><dt>Участники</dt><dd className="calendar-attendee-list">
        {meeting.participantIds.map(id => <EmployeeProfileLink key={id} userId={id} personName={people.find(person => person.id === id)?.name ?? "Сотрудник"}>
          {people.find(person => person.id === id)?.name ?? "Сотрудник"}
        </EmployeeProfileLink>)}
        {!meeting.participantIds.length && "Не указаны"}
      </dd></div>
    </dl>
    {meeting.description && <div className="calendar-detail-description"><span>Описание</span><p>{meeting.description}</p></div>}
    {meeting.status === "cancelled" && <span className="calendar-cancelled">Конференция отменена</span>}
    {onOpen && <div className="calendar-form-actions"><Button appearance="primary" onClick={onOpen}>Открыть в Zoom-конференциях</Button></div>}
  </div>;
}
