import { useMemo, useState } from "react";

import type { AbsenceAction, AbsenceKind, AbsenceRequest, AbsenceRequestInput, PresenceSummaryItem, WorkspacePerson } from "@yuksalish/contracts";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Textarea } from "@fluentui/react-components";
import { Add24Regular, Checkmark24Regular, Dismiss24Regular, PersonAvailable24Regular } from "@fluentui/react-icons";

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
  const [endsAt, setEndsAt] = useState(toInputDate(new Date(Date.now() + 60 * 60 * 1000)));
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<{ request: AbsenceRequest; action: AbsenceAction }>();
  const [comment, setComment] = useState("");
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
    <div className="record-split"><section className="record-list"><h2>Мои заявки</h2>{own.length ? own.map(item => <AbsenceCard key={item.id} item={item} name={name(item.directManagerUserId)} onAction={(action) => setDecision({ request: item, action })} onUpload={item.kind === "sick_leave" && item.documentStatus !== "uploaded" ? (file) => onUploadDocument(item.id, file) : undefined} />) : <p>Заявок пока нет.</p>}</section>
      {team.length ? <section className="record-list"><h2>Требуют моего решения</h2>{team.map(item => <AbsenceCard key={item.id} item={item} name={name(item.requesterUserId)} onAction={(action) => setDecision({ request: item, action })} />)}</section> : null}
      {canAdmin && summary.length ? <section className="record-list"><h2>Сегодня в организации</h2>{summary.map(item => <p key={item.userId}><strong>{name(item.userId)}</strong> · {statusLabels[item.status] ?? item.status}</p>)}</section> : null}
    </div>
    <Dialog open={open} onOpenChange={(_, data) => setOpen(data.open)}><DialogSurface><DialogBody><DialogTitle>Новое отсутствие</DialogTitle><DialogContent><Field label="Тип"><select value={kind} onChange={event => setKind(event.target.value as AbsenceKind)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="Причина" required><Textarea value={reason} onChange={(_, data) => setReason(data.value)} /></Field><Field label="Начало"><Input type="datetime-local" value={startsAt} onChange={(_, data) => setStartsAt(data.value)} /></Field><Field label="Окончание"><Input type="datetime-local" value={endsAt} onChange={(_, data) => setEndsAt(data.value)} /></Field></DialogContent><DialogActions><Button onClick={() => setOpen(false)}>Отмена</Button><Button appearance="primary" disabled={busy || !reason.trim()} onClick={() => void save()}>Отправить руководителю</Button></DialogActions></DialogBody></DialogSurface></Dialog>
    <Dialog open={decision !== undefined} onOpenChange={(_, data) => !data.open && setDecision(undefined)}><DialogSurface><DialogBody><DialogTitle>{decision?.action === "reject" ? "Отклонить заявку" : "Подтвердить действие"}</DialogTitle><DialogContent><Field label={decision?.action === "reject" ? "Причина отказа" : "Комментарий"} required={decision?.action === "reject"}><Textarea value={comment} onChange={(_, data) => setComment(data.value)} /></Field></DialogContent><DialogActions><Button onClick={() => setDecision(undefined)}>Отмена</Button><Button appearance={decision?.action === "reject" ? "secondary" : "primary"} disabled={busy || (decision?.action === "reject" && !comment.trim())} onClick={() => void decide()}>Подтвердить</Button></DialogActions></DialogBody></DialogSurface></Dialog>
  </section>;
}

function AbsenceCard({ item, name, onAction, onUpload }: { readonly item: AbsenceRequest; readonly name: string; readonly onAction: (action: AbsenceAction) => void; readonly onUpload?: (file: File) => void }) {
  return <article className="record-card"><div><strong>{labels[item.kind]}</strong><span>{item.statusLabel} · {name}</span><p>{item.reason}</p><small>{new Date(item.startsAt).toLocaleString("ru-RU")} — {new Date(item.endsAt).toLocaleString("ru-RU")}</small>{item.documentStatus === "overdue" ? <em>Нужно прикрепить больничное заключение</em> : null}</div><div className="record-card-actions">{onUpload ? <label className="fui-Button">Прикрепить заключение<input hidden type="file" accept="application/pdf,image/*" onChange={event => { const file = event.target.files?.[0]; if (file) onUpload(file); }} /></label> : null}{item.allowedActions.includes("approve") ? <Button icon={<Checkmark24Regular />} onClick={() => onAction("approve")}>Согласовать</Button> : null}{item.allowedActions.includes("acknowledge") ? <Button icon={<PersonAvailable24Regular />} onClick={() => onAction("acknowledge")}>Подтвердить</Button> : null}{item.allowedActions.includes("reject") ? <Button icon={<Dismiss24Regular />} onClick={() => onAction("reject")}>Отклонить</Button> : null}{item.allowedActions.includes("cancel") ? <Button onClick={() => onAction("cancel")}>Отменить</Button> : null}</div></article>;
}
