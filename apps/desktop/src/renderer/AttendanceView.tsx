import { useMemo, useState } from "react";

import type {
  AttendanceCorrection,
  AttendanceDay,
  AttendanceProfile,
  WorkScheduleException,
  WorkSchedulePeriod,
  WorkspacePerson,
} from "@yuksalish/contracts";
import { Button, Field, Input, Select, Textarea } from "@fluentui/react-components";
import { CalendarClock24Regular, Play24Filled, Stop24Filled } from "@fluentui/react-icons";

type CorrectionInput = {
  eventKind: "arrival" | "start" | "end";
  requestedAt: string;
  reason: string;
};
type ProfileInput = { smartofficeStaffKey?: string | null; dateOfBirth?: string | null };
type PeriodInput = {
  userId: string;
  startsOn: string;
  endsOn: string;
  weekdays: readonly number[];
  startsAt: string;
  endsAt: string;
};
type ExceptionInput = {
  userId: string;
  workDate: string;
  kind: "day_off" | "workday";
  startsAt?: string | null;
  endsAt?: string | null;
};

interface Props {
  readonly currentUser: WorkspacePerson;
  readonly people: readonly WorkspacePerson[];
  readonly days: readonly AttendanceDay[];
  readonly periods: readonly WorkSchedulePeriod[];
  readonly exceptions: readonly WorkScheduleException[];
  readonly corrections: readonly AttendanceCorrection[];
  readonly profiles: readonly AttendanceProfile[];
  readonly canAdmin: boolean;
  readonly onAction: (action: "start" | "end") => Promise<AttendanceDay | undefined>;
  readonly onCorrection: (payload: CorrectionInput) => Promise<AttendanceCorrection | undefined>;
  readonly onCorrectionAction: (
    item: AttendanceCorrection,
    action: "approve" | "reject" | "cancel",
    comment?: string,
  ) => Promise<AttendanceCorrection | undefined>;
  readonly onSaveProfile: (userId: string, payload: ProfileInput) => Promise<void>;
  readonly onSavePeriod: (payload: PeriodInput) => Promise<void>;
  readonly onSaveException: (payload: ExceptionInput) => Promise<void>;
}

const statusLabel: Record<AttendanceDay["status"], string> = {
  unscheduled: "График не назначен",
  scheduled: "Ожидается",
  arrived: "Прибыл в офис",
  working: "Рабочий день начат",
  completed: "Рабочий день завершён",
  late: "Опоздание",
  absence: "Согласованное отсутствие",
};
const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date());
const timestamp = (value?: string | null) => value
  ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
  : "—";

export function AttendanceView({
  currentUser, people, days, periods, exceptions, corrections, profiles, canAdmin,
  onAction, onCorrection, onCorrectionAction, onSaveProfile, onSavePeriod, onSaveException,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [correctionAt, setCorrectionAt] = useState("");
  const [correctionKind, setCorrectionKind] = useState<CorrectionInput["eventKind"]>("arrival");
  const [selectedUserId, setSelectedUserId] = useState(currentUser.id);
  const [staffKey, setStaffKey] = useState("");
  const [birthday, setBirthday] = useState("");
  const [startsOn, setStartsOn] = useState(today());
  const [endsOn, setEndsOn] = useState(`${new Date().getFullYear()}-12-31`);
  const [startsAt, setStartsAt] = useState("09:00");
  const [endsAt, setEndsAt] = useState("18:00");
  const [exceptionDate, setExceptionDate] = useState(today());
  const ownToday = useMemo(
    () => days.find(item => item.userId === currentUser.id && item.workDate === today()),
    [currentUser.id, days],
  );
  const profile = profiles.find(item => item.userId === selectedUserId);
  const teamDays = days.filter(item => item.userId !== currentUser.id && item.workDate === today());
  const myCorrections = corrections.filter(
    item => item.userId === currentUser.id || item.directManagerUserId === currentUser.id,
  );
  const todayCounts = days.filter(item => item.workDate === today()).reduce<Record<string, number>>(
    (counts, item) => ({ ...counts, [item.status]: (counts[item.status] ?? 0) + 1 }),
    {},
  );
  const name = (id: string) => people.find(person => person.id === id)?.name ?? "Сотрудник";
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); } finally { setBusy(false); }
  };

  return <section className="workspace-view attendance-view" aria-label="Посещаемость">
    <header className="section-heading">
      <div><h1>Посещаемость</h1><p>График, рабочий день и подтверждённые отметки офиса.</p></div>
      <CalendarClock24Regular />
    </header>
    <section className="attendance-today" aria-label="Сегодня">
      <div>
        <strong>{statusLabel[ownToday?.status ?? "unscheduled"]}</strong>
        <span>Прибытие: {timestamp(ownToday?.arrivedAt)} · Начало: {timestamp(ownToday?.startedAt)} · Завершение: {timestamp(ownToday?.endedAt)}</span>
      </div>
      <div className="attendance-day-actions">
        <Button appearance="primary" icon={<Play24Filled />} disabled={busy || Boolean(ownToday?.startedAt && !ownToday?.endedAt)} onClick={() => void run(() => onAction("start"))}>Начать работу</Button>
        <Button icon={<Stop24Filled />} disabled={busy || !ownToday?.startedAt || Boolean(ownToday?.endedAt)} onClick={() => void run(() => onAction("end"))}>Завершить работу</Button>
      </div>
    </section>
    <div className="record-split attendance-columns">
      <section className="record-list">
        <h2>Мой график и история</h2>
        {periods.filter(item => item.userId === currentUser.id).map(item => <article className="record-card" key={item.id}>
          <strong>{item.startsOn} — {item.endsOn}</strong>
          <span>{item.weekdays.map(day => weekdays[day]).join(", ")} · {String(item.startsAt).slice(0, 5)}–{String(item.endsAt).slice(0, 5)}</span>
        </article>)}
        {days.filter(item => item.userId === currentUser.id).slice(0, 12).map(item => <article className="record-card" key={item.id}>
          <strong>{item.workDate}</strong><span>{statusLabel[item.status]} · {timestamp(item.arrivedAt)}</span>
        </article>)}
      </section>
      <section className="record-list">
        <h2>Исправить отметку</h2>
        <Field label="Тип"><Select value={correctionKind} onChange={event => setCorrectionKind(event.target.value as CorrectionInput["eventKind"])}><option value="arrival">Прибытие</option><option value="start">Начало работы</option><option value="end">Завершение работы</option></Select></Field>
        <Field label="Время"><Input type="datetime-local" value={correctionAt} onChange={(_, data) => setCorrectionAt(data.value)} /></Field>
        <Field label="Причина" required><Textarea value={reason} onChange={(_, data) => setReason(data.value)} /></Field>
        <Button appearance="primary" disabled={busy || !reason.trim() || !correctionAt} onClick={() => void run(async () => {
          if (await onCorrection({ eventKind: correctionKind, requestedAt: new Date(correctionAt).toISOString(), reason: reason.trim() })) {
            setReason(""); setCorrectionAt("");
          }
        })}>Отправить руководителю</Button>
        <h3>Мои и командные заявки</h3>
        {myCorrections.map(item => <CorrectionCard key={item.id} item={item} owner={item.userId === currentUser.id} name={name(item.userId)} busy={busy} onAction={onCorrectionAction} />)}
      </section>
    </div>
    {teamDays.length > 0 ? <section className="attendance-team">
      <h2>{canAdmin ? "Сводка организации на сегодня" : "Команда на сегодня"}</h2>
      {canAdmin ? <div className="attendance-summary">{Object.entries(todayCounts).map(([status, count]) => <span key={status}><strong>{count}</strong> {statusLabel[status as AttendanceDay["status"]]}</span>)}</div> : null}
      <div className="attendance-team-list">{teamDays.map(item => <article className="record-card" key={item.id}><strong>{name(item.userId)}</strong><span>{statusLabel[item.status]} · прибыл {timestamp(item.arrivedAt)}</span></article>)}</div>
    </section> : null}
    {canAdmin ? <section className="attendance-admin">
      <h2>Настройка сотрудника</h2>
      <div className="attendance-admin-grid">
        <Field label="Сотрудник"><Select value={selectedUserId} onChange={event => setSelectedUserId(event.target.value)}>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</Select></Field>
        <Field label="Ключ Smart Office"><Input value={staffKey || profile?.smartofficeStaffKey || ""} onChange={(_, data) => setStaffKey(data.value)} /></Field>
        <Field label="Дата рождения"><Input type="date" value={birthday || profile?.dateOfBirth || ""} onChange={(_, data) => setBirthday(data.value)} /></Field>
        <Button disabled={busy} onClick={() => void run(() => onSaveProfile(selectedUserId, { smartofficeStaffKey: staffKey || profile?.smartofficeStaffKey || null, dateOfBirth: birthday || profile?.dateOfBirth || null }))}>Сохранить связь</Button>
        <Button disabled={busy || !(staffKey || profile?.smartofficeStaffKey)} onClick={() => void run(() => onSaveProfile(selectedUserId, { smartofficeStaffKey: null, dateOfBirth: birthday || profile?.dateOfBirth || null }))}>Отвязать Smart Office</Button>
      </div>
      <div className="attendance-admin-grid">
        <Field label="Период с"><Input type="date" value={startsOn} onChange={(_, data) => setStartsOn(data.value)} /></Field>
        <Field label="по"><Input type="date" value={endsOn} onChange={(_, data) => setEndsOn(data.value)} /></Field>
        <Field label="Начало"><Input type="time" value={startsAt} onChange={(_, data) => setStartsAt(data.value)} /></Field>
        <Field label="Конец"><Input type="time" value={endsAt} onChange={(_, data) => setEndsAt(data.value)} /></Field>
        <Field label=" "><Button disabled={busy} onClick={() => void run(() => onSavePeriod({ userId: selectedUserId, startsOn, endsOn, weekdays: [0, 1, 2, 3, 4], startsAt, endsAt }))}>График пн–пт</Button></Field>
      </div>
      <div className="attendance-admin-grid">
        <Field label="Исключение на дату"><Input type="date" value={exceptionDate} onChange={(_, data) => setExceptionDate(data.value)} /></Field>
        <Button disabled={busy} onClick={() => void run(() => onSaveException({ userId: selectedUserId, workDate: exceptionDate, kind: "day_off" }))}>Сделать выходным</Button>
      </div>
      <p>{exceptions.filter(item => item.userId === selectedUserId).length} исключений для выбранного сотрудника.</p>
    </section> : null}
  </section>;
}

function CorrectionCard({ item, owner, name, busy, onAction }: {
  readonly item: AttendanceCorrection;
  readonly owner: boolean;
  readonly name: string;
  readonly busy: boolean;
  readonly onAction: Props["onCorrectionAction"];
}) {
  const [comment, setComment] = useState("");
  return <article className="record-card">
    <div><strong>{name}: {item.eventKind}</strong><span>{item.requestedAt} · {item.status}</span><small>{item.reason}</small></div>
    {item.status === "pending" ? <div className="attendance-correction-actions">
      {owner ? <Button size="small" disabled={busy} onClick={() => void onAction(item, "cancel")}>Отменить</Button> : <>
        <Input aria-label="Комментарий решения" placeholder="Комментарий при отказе" value={comment} onChange={(_, data) => setComment(data.value)} />
        <Button size="small" appearance="primary" disabled={busy} onClick={() => void onAction(item, "approve", comment)}>Согласовать</Button>
        <Button size="small" disabled={busy || !comment.trim()} onClick={() => void onAction(item, "reject", comment)}>Отклонить</Button>
      </>}
    </div> : null}
  </article>;
}
