import { useId, useMemo } from "react";
import type { AbsenceRequest, PresenceSummaryItem, WorkspacePerson } from "@yuksalish/contracts";
import { Avatar, Button, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { Dismiss24Regular, PeopleTeam24Regular } from "@fluentui/react-icons";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { ProfileAvatar } from "./ProfileAvatar";

export const presenceStatusLabels: Record<PresenceSummaryItem["status"], string> = {
  working: "На работе", trip: "В поездке", vacation: "В отпуске", personal_time: "Отсутствует",
  late_arrival: "Опаздывает", sick_leave: "Болеет", business_event: "На мероприятии",
};

// A summary is not permission to read a request. Only correlate already-authorized
// records, and only the exact confirmed interval (never a pending or historic one).
export function findPresenceRequest(item: PresenceSummaryItem, requests: readonly AbsenceRequest[]) {
  if (!item.startsAt || !item.endsAt || item.status === "working" || item.status === "trip") return undefined;
  const matches = requests.filter(request => request.requesterUserId === item.userId && request.kind === item.status
    && (request.status === "approved" || request.status === "acknowledged")
    && Date.parse(request.startsAt) === Date.parse(item.startsAt!) && Date.parse(request.endsAt) === Date.parse(item.endsAt!));
  return matches.length === 1 ? matches[0] : undefined;
}

function dateLabel(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Не указано";
  return new Date(value).toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface Props {
  readonly open?: boolean;
  readonly status: PresenceSummaryItem["status"];
  readonly summary: readonly PresenceSummaryItem[];
  readonly requests: readonly AbsenceRequest[];
  readonly people: readonly WorkspacePerson[];
  readonly token?: string;
  readonly onClose: () => void;
}

export function PresenceSummaryDialog({ open = true, status, summary, requests, people, token, onClose }: Props) {
  const descriptionId = useId();
  const peopleById = useMemo(() => new Map(people.map(person => [person.id, person])), [people]);
  const members = summary.filter(item => item.status === status);
  const avatar = (person: WorkspacePerson | undefined, size: 28 | 40) => person && token
    ? <ProfileAvatar person={person} token={token} size={size} />
    : <Avatar name={person?.name ?? "Сотрудник"} initials={person?.initials} size={size} color="colorful" />;

  return <WorkspaceDialog open={open} onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DialogSurface className="presence-summary-dialog" data-presence-status={status} aria-describedby={descriptionId}>
      <DialogBody>
        <div className="presence-summary-heading"><DialogTitle>{presenceStatusLabels[status]}</DialogTitle>
          <Button appearance="subtle" icon={<Dismiss24Regular />} aria-label="Закрыть список сотрудников" onClick={onClose} />
        </div>
        <p className="presence-summary-description" id={descriptionId}>{members.length ? `Сотрудников в этом статусе: ${members.length}.` : "В этом статусе сейчас никого нет."}
          {status === "working" ? " Нет действующего подтверждённого отсутствия; отметки начала рабочего дня здесь не учитываются." : " Показаны текущие периоды и доступные вам сведения."}
        </p>
        <DialogContent className="presence-summary-content" tabIndex={0} aria-label="Список сотрудников">
          {members.length ? <ul className="presence-summary-people">{members.map(item => {
            const person = peopleById.get(item.userId);
            const request = findPresenceRequest(item, requests);
            const action = request?.actions.filter(entry => entry.action === (request.status === "acknowledged" ? "acknowledge" : "approve"))
              .reduce<(typeof request.actions)[number] | undefined>((latest, entry) => !latest || Date.parse(entry.createdAt) >= Date.parse(latest.createdAt) ? entry : latest, undefined);
            const actor = action ? peopleById.get(action.actorUserId) : undefined;
            return <li className="presence-summary-person" key={item.userId}>
              <header>{avatar(person, 40)}<div><h3>{person?.name ?? "Сотрудник"}</h3>{person?.jobTitle ? <p>{person.jobTitle}</p> : null}</div></header>
              {status !== "working" ? <>
                <dl className="presence-summary-period"><div><dt>Начало</dt><dd>{dateLabel(item.startsAt)}</dd></div><div><dt>Окончание</dt><dd>{dateLabel(item.endsAt)}</dd></div></dl>
                {request ? <>
                  <div className="presence-summary-reason"><span>Причина</span><p>{request.reason.trim() || "Причина не указана."}</p></div>
                  <div className="presence-summary-approval">{action ? <>{avatar(actor, 28)}<div><span>{action.action === "acknowledge" ? "Получение подтвердил(а)" : "Согласовал(а)"}</span><strong>{actor?.name ?? "Сотрудник недоступен в справочнике"}</strong><time dateTime={action.createdAt}>{dateLabel(action.createdAt)}</time></div></> : <p>В истории заявки нет сведений о согласующем.</p>}</div>
                </> : <p className="presence-summary-unavailable">Причина и согласование недоступны в вашей сводке.</p>}
              </> : null}
            </li>;
          })}</ul> : <div className="presence-summary-empty"><PeopleTeam24Regular aria-hidden="true" /><strong>Список пока пуст</strong><p>Сотрудники появятся здесь, когда этот статус будет действовать.</p></div>}
        </DialogContent>
        <DialogActions><Button appearance="primary" onClick={onClose}>Закрыть</Button></DialogActions>
      </DialogBody>
    </DialogSurface>
  </WorkspaceDialog>;
}
