import { useEffect, useId, useMemo, useState, type MouseEvent } from "react";
import type { WorkspacePerson, ZoomInvitation } from "@yuksalish/contracts";
import { Check, ChevronDown, Clock3, ExternalLink, Video, X } from "lucide-react";
import { ProfileAvatar } from "./ProfileAvatar";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { respondToZoomInvitation } from "./workspace-api";
import { validatedZoomLink } from "../shared/zoom-link";
import { workspacePlatform } from "./platform-adapter";
import "./zoom-invitation.css";

export function ZoomInvitationCard({ messageId, invitation, people, token }: {
  readonly messageId: string; readonly invitation: ZoomInvitation;
  readonly people: readonly WorkspacePerson[]; readonly token: string;
}) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [membersMounted, setMembersMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [saved, setSaved] = useState<{ source: string; value: ZoomInvitation }>();
  const source = JSON.stringify(invitation);
  const card = saved?.source === source ? saved.value : invitation;
  const start = new Date(card.startsAt), end = new Date(card.endsAt);
  const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: card.timezone });
  useEffect(() => {
    const remaining = new Date(card.endsAt).getTime() - Date.now();
    if (remaining <= 0 && now >= new Date(card.endsAt).getTime()) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(remaining + 1, 2_147_000_000)));
    return () => window.clearTimeout(timer);
  }, [card.endsAt, now]);
  const finished = end.getTime() <= now;
  const scheduled = card.available && card.status === "scheduled" && !finished;
  const joinUrl = validatedZoomLink(card.joinUrl);
  const canReply = scheduled && card.canRespond;
  const members = [...(card.organizerId ? [{ userId: card.organizerId, response: "organizer" }] : []), ...card.participants.filter(p => p.userId !== card.organizerId)];
  const personById = useMemo(() => new Map<string, WorkspacePerson>(people.map(person => [person.id, person])), [people]);
  function toggleMembers() { setMembersMounted(true); setExpanded(!expanded); }
  async function reply(response: "accepted" | "declined") {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await respondToZoomInvitation(token, messageId, response);
      if (!result.zoomInvitation) throw new Error("Сервер не подтвердил ответ. Обновите чат.");
      setSaved({ source, value: result.zoomInvitation });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось ответить. Попробуйте ещё раз.");
    } finally { setBusy(false); }
  }
  function join(event: MouseEvent<HTMLAnchorElement>) {
    if (workspacePlatform.kind !== "electron") return;
    event.preventDefault();
    setError("");
    if (!joinUrl || !workspacePlatform.openZoomMeeting) {
      setError("Обновите приложение или скопируйте ссылку из сообщения и откройте её в браузере.");
      return;
    }
    void workspacePlatform.openZoomMeeting(joinUrl).then(opened => {
      if (!opened) setError("Не удалось открыть Zoom. Скопируйте ссылку из сообщения и откройте её в браузере.");
    }).catch(() => setError("Не удалось открыть Zoom. Попробуйте ещё раз."));
  }
  return <section className="zoom-invitation" aria-label={`Приглашение на Zoom: ${card.topic}`}>
    <div className="zoom-invitation-banner"><span><Video size={18} aria-hidden="true" /> Zoom-конференция</span>
      <Video className="zoom-invitation-art" size={88} strokeWidth={.9} aria-hidden="true" /></div>
    <div className="zoom-invitation-content">
      <div className="zoom-invitation-date" aria-hidden="true"><span>{format({ month: "short" }).format(start).replace(".", "")}</span><strong>{format({ day: "numeric" }).format(start)}</strong></div>
      <h3>{card.topic}</h3>
      <p className="zoom-invitation-meta"><Clock3 size={16} aria-hidden="true" /><span>
        <time dateTime={card.startsAt}>{format({ weekday: "short", day: "numeric", month: "long" }).format(start)} · {format({ hour: "2-digit", minute: "2-digit" }).format(start)}</time>
        {" — "}<time dateTime={card.endsAt}>{format({ hour: "2-digit", minute: "2-digit" }).format(end)}</time>
        <small>{card.timezone.replaceAll("_", " ")}</small></span></p>
      {!card.available ? <p className="zoom-invitation-status">Вы больше не приглашены на эту встречу.</p>
        : card.status !== "scheduled" ? <p className="zoom-invitation-status">Конференция отменена или недоступна.</p>
        : finished ? <p className="zoom-invitation-status">Конференция завершилась.</p> : null}
      {card.available && <>
        <button type="button" className="zoom-invitation-disclosure" aria-expanded={expanded} aria-controls={panelId} onClick={toggleMembers}>
          <span>Участники</span><span>{members.length}</span><ChevronDown size={16} aria-hidden="true" /></button>
        <div className="zoom-invitation-accordion" data-open={expanded} aria-hidden={!expanded} inert={!expanded}>
        <div className="zoom-invitation-accordion-inner">
        <div id={panelId} className="zoom-invitation-people" tabIndex={0} role="region" aria-label="Список участников">
          {membersMounted && members.map(member => {
            const person = personById.get(member.userId);
            return <div key={member.userId} className="zoom-invitation-person">
              <ProfileAvatar person={person ?? { id: member.userId, name: "Сотрудник" }} token={token} size={28} aria-hidden />
              <span>{person ? <EmployeeProfileLink userId={person.id} personName={person.name}>{person.name}</EmployeeProfileLink> : "Сотрудник"}
                <small>{member.response === "organizer" ? "Организатор" : member.response === "accepted" ? "Участвует" : member.response === "declined" ? "Отказался" : "Приглашён"}</small></span></div>;
          })}
        </div>
        </div></div>
      </>}
      {scheduled && <>
        <div className="zoom-invitation-actions">
          {canReply && card.response !== "accepted" ? <button type="button" className="zoom-invitation-primary" disabled={busy} onClick={() => void reply("accepted")}>
            <Check size={16} aria-hidden="true" />{busy ? "Сохраняем…" : "Принять"}</button>
            : joinUrl ? <a className="zoom-invitation-primary" href={joinUrl} onClick={join} target="_blank" rel="noopener noreferrer"><Video size={16} aria-hidden="true" />Войти в Zoom</a> : null}
          {canReply && <button type="button" className="zoom-invitation-decline" data-declined={card.response === "declined"} disabled={busy || card.response === "declined"} onClick={() => void reply("declined")}>
            <X size={16} aria-hidden="true" />{card.response === "declined" ? "Отказались" : "Отказаться"}</button>}
        </div>
        {card.response === "accepted" && <p className="zoom-invitation-response" role="status"><Check size={14} aria-hidden="true" />Вы участвуете</p>}
        {joinUrl && <a className="zoom-invitation-link" href={joinUrl} onClick={join} target="_blank" rel="noopener noreferrer">Ссылка на конференцию <ExternalLink size={14} aria-hidden="true" /></a>}
        {card.passcode && <p className="zoom-invitation-passcode">Код доступа: <strong>{card.passcode}</strong></p>}
      </>}
      {error && <p className="zoom-invitation-error" role="alert">{error}</p>}
    </div>
  </section>;
}
