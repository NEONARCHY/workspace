import { useMemo, useState } from "react";

import type { AbsenceAction, AbsenceKind, AbsenceRequest, AbsenceRequestInput, PresenceSummaryItem, WorkspacePerson } from "@yuksalish/contracts";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Textarea } from "@fluentui/react-components";
import { Add24Regular, CalendarLtr24Regular, Checkmark24Regular, Dismiss24Regular } from "@fluentui/react-icons";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";

const labels: Record<AbsenceKind, string> = { vacation: "Отпуск", personal_time: "Отгул / личное отсутствие", late_arrival: "Опоздание", sick_leave: "Больничный", business_event: "Конференция / мероприятие" };
const statusLabels: Record<string, string> = { working: "На работе", trip: "В поездке", vacation: "В отпуске", personal_time: "Отсутствует", late_arrival: "Опаздывает", sick_leave: "Болеет", business_event: "На мероприятии" };

interface Props {
  readonly currentUserId: string;
  readonly people: readonly WorkspacePerson[];
  readonly requests: readonly AbsenceRequest[];
  readonly summary: readonly PresenceSummaryItem[];
  readonly canAdmin: boolean;
  readonly onCreate: (payload: AbsenceRequestInput) => Promise<AbsenceRequest | undefined>;
  readonly onAction: (request: AbsenceRequest, action: AbsenceAction, comment?: string) => Promise<AbsenceRequest | undefined>;
  readonly onUploadDocument: (requestId: string, file: File) => Promise<void>;
}

function toInputDate(value: Date): string { return value.toISOString().slice(0, 16); }

export function AbsencesView({ currentUserId, people, requests, summary, canAdmin, onCreate, onAction, onUploadDocument }: Props) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AbsenceKind>("personal_time");
  const [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState(toInputDate(new Date()));
  const [endsAt, setEndsAt] = useState(() => {
    const end = new Date();
    end.setHours(end.getHours() + 1);
    return toInputDate(end);
  });
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<{ request: AbsenceRequest; action: AbsenceAction }>();
  const [comment, setComment] = useState("");
  const [selected, setSelected] = useState<AbsenceRequest>();
  const own = requests.filter(item => item.requesterUserId === currentUserId);
  const team = requests.filter(item => item.directManagerUserId === currentUserId && item.requesterUserId !== currentUserId);
  const counts = useMemo(() => summary.reduce<Record<string, number>>((total, item) => ({ ...total, [item.status]: (total[item.status] ?? 0) + 1 }), {}), [summary]);
  const save = async () => {
    if (!reason.trim() || !startsAt || !endsAt) return;
    setBusy(true);
    try { if (await onCreate({ kind, reason, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() })) { setOpen(false); setReason(""); } } finally { setBusy(false); }
  };
  const decide = async () => {
    if (!decision || (decision.action === "reject" && !comment.trim())) return;
    setBusy(true);
    try { if (await onAction(decision.request, decision.action, comment)) { setDecision(undefined); setComment(""); } } finally { setBusy(false); }
  };
  const name = (id: string) => people.find(person => person.id === id)?.name ?? "Сотрудник";
  return <section className="workspace-view absences-view" aria-label="Отсутствия">
    <header className="record-header"><div><span className="record-kicker">Рабочий статус</span><h1>Отсутствия</h1><p>Заявите об отсутствии, опоздании или больничном — руководитель сразу получит уведомление.</p></div><Button appearance="primary" icon={<Add24Regular />} onClick={() => setOpen(true)}>Сообщить об отсутствии</Button></header>
    {canAdmin ? <section className="absence-summary" aria-label="Сводка присутствия">{Object.entries(statusLabels).map(([key, label]) => <div key={key}><strong>{counts[key] ?? 0}</strong><span>{label}</span></div>)}</section> : null}
    <div className="absence-canvas"><section className="absence-column"><header><span>Личный контур</span><h2>Мои заявки</h2></header>{own.length ? own.map(item => <AbsenceCard key={item.id} item={item} personId={item.directManagerUserId} name={name(item.directManagerUserId)} onSelect={() => setSelected(item)} />) : <div className="absence-empty"><CalendarLtr24Regular /><p>Заявок пока нет</p><span>Новое отсутствие появится здесь после отправки.</span></div>}</section>
      <section className="absence-column"><header><span>Команда</span><h2>Требуют решения</h2></header>{team.length ? team.map(item => <AbsenceCard key={item.id} item={item} personId={item.requesterUserId} name={name(item.requesterUserId)} onSelect={() => setSelected(item)} />) : <div className="absence-empty"><Checkmark24Regular /><p>Очередь свободна</p><span>Новых решений от команды сейчас нет.</span></div>}</section>
      {canAdmin && summary.length ? <section className="absence-column absence-presence"><header><span>Организация</span><h2>Сегодня</h2></header>{summary.map(item => <button type="button" key={item.userId}><span className={`absence-presence-dot is-${item.status}`} /><EmployeeProfileLink userId={item.userId} personName={name(item.userId)}><strong>{name(item.userId)}</strong></EmployeeProfileLink><small>{statusLabels[item.status] ?? item.status}</small></button>)}</section> : null}
    </div>
    {selected ? <div className="absence-drawer-scrim" role="presentation" onMouseDown={() => setSelected(undefined)}><aside className="absence-drawer" role="dialog" aria-modal="true" aria-label={`Заявка: ${labels[selected.kind]}`} onMouseDown={(event) => event.stopPropagation()}><header><div><span>Заявка на отсутствие</span><h2>{labels[selected.kind]}</h2></div><Button appearance="subtle" icon={<Dismiss24Regular />} aria-label="Закрыть" onClick={() => setSelected(undefined)} /></header><div className="absence-drawer-status"><strong>{selected.statusLabel}</strong><EmployeeProfileLink userId={selected.requesterUserId} personName={name(selected.requesterUserId)}>{name(selected.requesterUserId)}</EmployeeProfileLink></div><dl><div><dt>Начало</dt><dd>{new Date(selected.startsAt).toLocaleString("ru-RU")}</dd></div><div><dt>Окончание</dt><dd>{new Date(selected.endsAt).toLocaleString("ru-RU")}</dd></div><div><dt>Причина</dt><dd>{selected.reason}</dd></div></dl><footer>{selected.kind === "sick_leave" && selected.documentStatus !== "uploaded" ? <label className="fui-Button">Прикрепить заключение<input hidden type="file" accept="application/pdf,image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void onUploadDocument(selected.id, file); }} /></label> : null}{selected.allowedActions.map(action => <Button key={action} appearance={action === "reject" ? "secondary" : action === "cancel" ? "subtle" : "primary"} onClick={() => setDecision({ request: selected, action })}>{action === "approve" ? "Согласовать" : action === "acknowledge" ? "Подтвердить" : action === "reject" ? "Отклонить" : "Отменить заявку"}</Button>)}</footer></aside></div> : null}
    <Dialog open={open} onOpenChange={(_, data) => setOpen(data.open)}><DialogSurface><DialogBody><DialogTitle>Новое отсутствие</DialogTitle><DialogContent><Field label="Тип"><WorkspaceSelect value={kind} onChange={event => setKind(event.target.value as AbsenceKind)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</WorkspaceSelect></Field><Field label="Причина" required><Textarea value={reason} onChange={(_, data) => setReason(data.value)} /></Field><Field label="Начало"><WorkspaceDateTimePicker ariaLabel="Начало отсутствия" value={startsAt} onChange={setStartsAt} /></Field><Field label="Окончание"><WorkspaceDateTimePicker ariaLabel="Окончание отсутствия" value={endsAt} min={startsAt} onChange={setEndsAt} /></Field></DialogContent><DialogActions><Button onClick={() => setOpen(false)}>Отмена</Button><Button appearance="primary" disabled={busy || !reason.trim()} onClick={() => void save()}>Отправить руководителю</Button></DialogActions></DialogBody></DialogSurface></Dialog>
    <Dialog open={decision !== undefined} onOpenChange={(_, data) => !data.open && setDecision(undefined)}><DialogSurface><DialogBody><DialogTitle>{decision?.action === "reject" ? "Отклонить заявку" : "Подтвердить действие"}</DialogTitle><DialogContent><Field label={decision?.action === "reject" ? "Причина отказа" : "Комментарий"} required={decision?.action === "reject"}><Textarea value={comment} onChange={(_, data) => setComment(data.value)} /></Field></DialogContent><DialogActions><Button onClick={() => setDecision(undefined)}>Отмена</Button><Button appearance={decision?.action === "reject" ? "secondary" : "primary"} disabled={busy || (decision?.action === "reject" && !comment.trim())} onClick={() => void decide()}>Подтвердить</Button></DialogActions></DialogBody></DialogSurface></Dialog>
  </section>;
}

function AbsenceCard({ item, personId, name, onSelect }: { readonly item: AbsenceRequest; readonly personId: string; readonly name: string; readonly onSelect: () => void }) {
  return <button type="button" className="absence-card" onClick={onSelect}><span className={`absence-kind-mark is-${item.kind}`} /><span className="absence-card-main"><span><strong>{labels[item.kind]}</strong><small>{item.statusLabel}</small></span><p>{item.reason}</p><time>{new Date(item.startsAt).toLocaleString("ru-RU")} — {new Date(item.endsAt).toLocaleString("ru-RU")}</time><EmployeeProfileLink userId={personId} personName={name}><em>{name}</em></EmployeeProfileLink>{item.documentStatus === "overdue" ? <b>Нужно заключение</b> : null}</span></button>;
}
