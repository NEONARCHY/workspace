import { useEffect, useMemo, useRef, useState } from "react";

import type {
  WorkspacePerson,
  ZoomAvailability,
  ZoomMeeting,
  ZoomMeetingInput,
  ZoomMeetingsRegistry,
} from "@yuksalish/contracts";
import { Avatar, Button, Checkbox, Input, Spinner, Textarea } from "@fluentui/react-components";
import {
  Add24Regular,
  ArrowClockwise20Regular,
  Copy20Regular,
  Dismiss20Regular,
  Open20Regular,
  Video24Regular,
} from "@fluentui/react-icons";

import { WorkspaceSelect as Select } from "./WorkspaceSelect";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";
import {
  cancelZoomMeeting,
  createZoomMeeting,
  loadZoomAvailability,
  updateZoomMeeting,
} from "./workspace-api";

interface ZoomViewProps {
  readonly token: string;
  readonly people: readonly WorkspacePerson[];
  readonly currentUserId: string;
  /** Owned by App so the calendar shows the same schedule. */
  readonly registry?: ZoomMeetingsRegistry;
  readonly loading: boolean;
  readonly error?: string;
  readonly onRefresh: () => void | Promise<void>;
  /** Set when a reminder notification opened this section. */
  readonly focusMeetingId?: string;
}

const SLOT_MINUTES = 15;
const DURATION_PRESETS = [30, 45, 60, 90];
/** The busy strip only needs to cover a working day, not every empty night hour. */
const STRIP_START_HOUR = 7;
const STRIP_END_HOUR = 21;

const statusLabels: Record<ZoomMeeting["status"], string> = {
  provisioning: "Создаётся",
  scheduled: "Запланирована",
  cancellation_pending: "Отменяется",
  cancelled: "Отменена",
  failed: "Не создана",
};

/** Offset of a named time zone at a given instant, in milliseconds. */
function zoneOffset(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    read("year"), read("month") - 1, read("day"),
    read("hour") % 24, read("minute"), read("second"),
  );
  return asUtc - instant.getTime();
}

/** Empty input is not a zero date, so it has to fail the finiteness check. */
function numberOrNaN(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

/** Turn a wall clock date and time of the organization into an absolute instant. */
export function zonedWallTimeToIso(date: string, time: string, timeZone: string): string {
  const [yearText = "", monthText = "", dayText = ""] = date.split("-");
  const [hourText = "", minuteText = ""] = time.split(":");
  const year = numberOrNaN(yearText);
  const month = numberOrNaN(monthText);
  const day = numberOrNaN(dayText);
  const hour = numberOrNaN(hourText);
  const minute = numberOrNaN(minuteText);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return "";
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let instant = new Date(naive - zoneOffset(new Date(naive), timeZone));
  // A second pass settles zones whose offset changes across the guessed instant.
  instant = new Date(naive - zoneOffset(instant, timeZone));
  return instant.toISOString();
}

function wallParts(value: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(value));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    time: `${read("hour") === "24" ? "00" : read("hour")}:${read("minute")}`,
  };
}

function timeText(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit" })
    .format(new Date(value));
}

function dayText(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone, day: "numeric", month: "long", weekday: "long" })
    .format(new Date(value));
}

/** Zoom prints conference identifiers in groups; keep the familiar shape. */
export function formatMeetingId(value?: string | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return value;
}

export function invitationText(meeting: ZoomMeeting, timeZone: string): string {
  const when = new Intl.DateTimeFormat("ru-RU", {
    timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(meeting.startsAt));
  return [
    "Yuksalish приглашает вас на запланированную конференцию: Zoom.",
    "",
    `Время: ${when} Ташкент`,
    "",
    "Подключиться к конференции Zoom",
    meeting.joinUrl ?? "",
    "",
    `Идентификатор конференции: ${formatMeetingId(meeting.zoomMeetingId)}`,
    `Код доступа: ${meeting.passcode ?? ""}`,
  ].join("\n");
}

function durationOptions(): number[] {
  return Array.from({ length: 480 / SLOT_MINUTES }, (_, index) => (index + 1) * SLOT_MINUTES);
}

interface Draft {
  readonly meetingId?: string;
  readonly topic: string;
  readonly description: string;
  readonly date: string;
  readonly time: string;
  readonly durationMinutes: number;
  readonly participantIds: readonly string[];
}

function emptyDraft(timeZone: string): Draft {
  const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
  const { date, time } = wallParts(inOneHour.toISOString(), timeZone);
  const [hourText = "0", minuteText = "0"] = time.split(":");
  const hour = Number(hourText);
  const rounded = Math.ceil(Number(minuteText) / SLOT_MINUTES) * SLOT_MINUTES;
  const normalized = rounded >= 60
    ? `${String((hour + 1) % 24).padStart(2, "0")}:00`
    : `${String(hour).padStart(2, "0")}:${String(rounded).padStart(2, "0")}`;
  return { topic: "", description: "", date, time: normalized, durationMinutes: 60, participantIds: [] };
}

function editDraft(meeting: ZoomMeeting, timeZone: string): Draft {
  const { date, time } = wallParts(meeting.startsAt, timeZone);
  return {
    meetingId: meeting.id,
    topic: meeting.topic,
    description: meeting.description,
    date,
    time,
    durationMinutes: meeting.durationMinutes,
    participantIds: meeting.participantIds,
  };
}

function BusyStrip({ availability, day, timeZone }: {
  readonly availability?: ZoomAvailability;
  readonly day: string;
  readonly timeZone: string;
}) {
  const windowStart = zonedWallTimeToIso(day, `${String(STRIP_START_HOUR).padStart(2, "0")}:00`, timeZone);
  const windowEnd = zonedWallTimeToIso(day, `${String(STRIP_END_HOUR).padStart(2, "0")}:00`, timeZone);
  if (!windowStart || !windowEnd) return null;
  const from = new Date(windowStart).getTime();
  const to = new Date(windowEnd).getTime();
  const span = to - from;
  const segments = (availability?.intervals ?? [])
    .map((interval) => {
      const start = Math.max(new Date(interval.startsAt).getTime(), from);
      const end = Math.min(new Date(interval.endsAt).getTime(), to);
      return { interval, start, end };
    })
    .filter((item) => item.end > item.start);
  return (
    <div className="zoom-strip" aria-label={`Занятость ${day}`}>
      <div className="zoom-strip-track">
        {segments.map(({ interval, start, end }) => (
          <span
            key={`${interval.startsAt}-${interval.source}`}
            className={`zoom-strip-busy ${interval.source}`}
            style={{ left: `${((start - from) / span) * 100}%`, width: `${((end - start) / span) * 100}%` }}
            title={`${interval.topic}: ${timeText(interval.startsAt, timeZone)}–${timeText(interval.endsAt, timeZone)}`}
          />
        ))}
      </div>
      <div className="zoom-strip-scale" aria-hidden="true">
        <span>{STRIP_START_HOUR}:00</span>
        <span>{Math.round((STRIP_START_HOUR + STRIP_END_HOUR) / 2)}:00</span>
        <span>{STRIP_END_HOUR}:00</span>
      </div>
      <ul className="zoom-strip-legend">
        {segments.length === 0 ? <li className="zoom-strip-free">Весь день свободен</li> : null}
        {segments.map(({ interval }) => (
          <li key={`${interval.startsAt}-${interval.topic}`}>
            <b>{timeText(interval.startsAt, timeZone)}–{timeText(interval.endsAt, timeZone)}</b>
            <span>{interval.topic}</span>
            {interval.source === "external" ? <em>создано вне Workspace</em> : null}
          </li>
        ))}
      </ul>
      {availability && !availability.hostCalendarSynced ? (
        <p className="zoom-strip-warning" role="status">
          Календарь Zoom сейчас недоступен — показаны только конференции Workspace.
        </p>
      ) : null}
    </div>
  );
}

export function ZoomView({
  token, people, currentUserId, registry, loading, error, onRefresh, focusMeetingId,
}: ZoomViewProps) {
  const [actionError, setActionError] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(focusMeetingId);
  // The upcoming/past boundary is taken once per mount: a list that silently
  // reshuffles itself mid-render would move rows under the pointer.
  const [openedAt] = useState(Date.now);
  const [bucket, setBucket] = useState<"upcoming" | "past">("upcoming");
  const [draft, setDraft] = useState<Draft>();
  const [availability, setAvailability] = useState<ZoomAvailability>();
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const sideRef = useRef<HTMLElement>(null);
  const timeZone = registry?.timezone ?? "Asia/Tashkent";

  useEffect(() => {
    if (!draft?.date || registry?.configured !== true) return undefined;
    let cancelled = false;
    void loadZoomAvailability(token, draft.date)
      .then((result) => { if (!cancelled) setAvailability(result); })
      // A missing strip must not block booking; the server checks the slot anyway.
      .catch(() => { if (!cancelled) setAvailability(undefined); });
    return () => { cancelled = true; };
  }, [draft?.date, registry?.configured, token]);

  const meetings = useMemo(() => registry?.meetings ?? [], [registry]);
  const visible = useMemo(() => meetings
    .filter((meeting) => meeting.status !== "failed")
    .filter((meeting) => (bucket === "upcoming"
      ? new Date(meeting.endsAt).getTime() >= openedAt && meeting.status !== "cancelled"
      : new Date(meeting.endsAt).getTime() < openedAt || meeting.status === "cancelled"))
    .sort((left, right) => (bucket === "upcoming"
      ? new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
      : new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime())),
  [bucket, meetings, openedAt]);
  const selected = meetings.find((meeting) => meeting.id === selectedId);

  const copy = async (text: string, confirmation: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(confirmation);
    } catch {
      setNotice("Не удалось скопировать. Выделите текст вручную.");
    }
  };

  const openComposer = (value: Draft) => {
    setDraft(value);
    setFormError("");
    setNotice("");
    window.setTimeout(() => sideRef.current?.focus(), 0);
  };

  const save = async () => {
    if (!draft) return;
    const topic = draft.topic.trim();
    if (!topic) { setFormError("Укажите название конференции."); return; }
    const startsAt = zonedWallTimeToIso(draft.date, draft.time, timeZone);
    if (!startsAt) { setFormError("Укажите дату и время начала."); return; }
    if (new Date(startsAt).getTime() <= Date.now()) {
      setFormError("Нельзя создать конференцию в прошлом.");
      return;
    }
    const payload: ZoomMeetingInput = {
      topic,
      description: draft.description.trim(),
      startsAt,
      durationMinutes: draft.durationMinutes,
      participantIds: draft.participantIds,
    };
    setBusy(true);
    try {
      const saved = draft.meetingId
        ? await updateZoomMeeting(token, draft.meetingId, payload)
        : await createZoomMeeting(token, payload);
      // Only a confirmed server answer closes the form and clears the input.
      setDraft(undefined);
      setSelectedId(saved.id);
      setFormError("");
      await onRefresh();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Не удалось сохранить конференцию");
    } finally {
      setBusy(false);
    }
  };

  const cancelMeeting = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await cancelZoomMeeting(token, selected.id);
      setActionError("");
      setConfirmingCancel(false);
      setNotice("Конференция отменена, ссылка больше не работает.");
      await onRefresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Не удалось отменить конференцию");
    } finally {
      setBusy(false);
    }
  };

  const personName = (id: string) => people.find((person) => person.id === id)?.name ?? "Сотрудник";

  if (loading && !registry) {
    return (
      <section className="workspace-view zoom-view" aria-label="Zoom-конференции">
        <div className="zoom-placeholder"><Spinner label="Загружаем расписание конференций" /></div>
      </section>
    );
  }

  if (registry && !registry.configured) {
    return (
      <section className="workspace-view zoom-view" aria-label="Zoom-конференции">
        <div className="zoom-placeholder zoom-unconfigured">
          <Video24Regular aria-hidden="true" />
          <h1>Zoom ещё не подключён</h1>
          <p>
            Раздел заработает, когда администратор сервера укажет данные приложения Zoom
            Server-to-Server OAuth. До этого конференции создаются прежним способом.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-view zoom-view" aria-label="Zoom-конференции">
      <header className="zoom-header">
        <div>
          <h1>Zoom-конференции</h1>
          <p>
            Общий корпоративный хост: одновременно идёт только одна конференция.
            Напоминание придёт за {registry?.reminderMinutes ?? 30} минут до начала.
          </p>
        </div>
        <div className="zoom-header-actions">
          <Button
            appearance="subtle"
            icon={<ArrowClockwise20Regular />}
            disabled={loading}
            onClick={() => void onRefresh()}
          >
            Обновить
          </Button>
          <Button
            appearance="primary"
            icon={<Add24Regular />}
            onClick={() => openComposer(emptyDraft(timeZone))}
          >
            Новая конференция
          </Button>
        </div>
      </header>

      {error || actionError ? (
        <div className="auth-error zoom-error" role="alert">{actionError || error}</div>
      ) : null}
      {notice ? <p className="zoom-notice" role="status">{notice}</p> : null}

      <div className="zoom-split">
        <section className="zoom-list" aria-label="Расписание конференций">
          <div className="view-switch zoom-buckets" role="group" aria-label="Период">
            <button
              type="button"
              className={bucket === "upcoming" ? "active" : ""}
              aria-pressed={bucket === "upcoming"}
              onClick={() => setBucket("upcoming")}
            >
              Ближайшие
            </button>
            <button
              type="button"
              className={bucket === "past" ? "active" : ""}
              aria-pressed={bucket === "past"}
              onClick={() => setBucket("past")}
            >
              Прошедшие
            </button>
          </div>
          {visible.length === 0 ? (
            <p className="zoom-empty">
              {bucket === "upcoming"
                ? "Запланированных конференций нет. Создайте первую."
                : "Прошедших конференций пока нет."}
            </p>
          ) : (
            <ul className="zoom-rows">
              {visible.map((meeting) => (
                <li key={meeting.id}>
                  <button
                    type="button"
                    className={`zoom-row${meeting.id === selectedId ? " selected" : ""}`}
                    aria-pressed={meeting.id === selectedId}
                    onClick={() => { setSelectedId(meeting.id); setDraft(undefined); setNotice(""); }}
                  >
                    <span className="zoom-row-time">
                      <b>{timeText(meeting.startsAt, timeZone)}</b>
                      <small>{dayText(meeting.startsAt, timeZone)}</small>
                    </span>
                    <span className="zoom-row-body">
                      <strong>{meeting.topic}</strong>
                      <small><EmployeeProfileLink
                        userId={meeting.organizerUserId ?? undefined}
                        personName={meeting.organizerName}
                      >{meeting.organizerName}</EmployeeProfileLink> · {meeting.durationMinutes} мин</small>
                    </span>
                    <span className={`zoom-status ${meeting.status}`}>{statusLabels[meeting.status]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="zoom-side" ref={sideRef} tabIndex={-1} aria-label="Конференция">
          {draft ? (
            <div className="zoom-form">
              <div className="zoom-side-nav">
                <span>{draft.meetingId ? "Изменение конференции" : "Новая конференция"}</span>
                <Button
                  appearance="subtle"
                  icon={<Dismiss20Regular />}
                  aria-label="Закрыть форму"
                  onClick={() => { setDraft(undefined); setFormError(""); }}
                />
              </div>
              <label className="zoom-field">
                Название
                <Input
                  value={draft.topic}
                  maxLength={200}
                  placeholder="Например, планёрка отдела"
                  onChange={(_event, data) => setDraft({ ...draft, topic: data.value })}
                />
              </label>
              <div className="zoom-field-row">
                <label className="zoom-field">
                  Дата
                  <WorkspaceDateTimePicker mode="date" ariaLabel="Дата Zoom-встречи" value={draft.date} onChange={(value) => setDraft({ ...draft, date: value })} />
                </label>
                <label className="zoom-field">
                  Начало
                  <WorkspaceDateTimePicker mode="time" ariaLabel="Начало Zoom-встречи" value={draft.time} onChange={(value) => setDraft({ ...draft, time: value })} />
                </label>
              </div>
              <fieldset className="zoom-durations">
                <legend>Продолжительность</legend>
                <div className="zoom-duration-chips">
                  {DURATION_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={draft.durationMinutes === preset ? "active" : ""}
                      aria-pressed={draft.durationMinutes === preset}
                      onClick={() => setDraft({ ...draft, durationMinutes: preset })}
                    >
                      {preset} мин
                    </button>
                  ))}
                  <Select
                    aria-label="Другая продолжительность"
                    value={String(draft.durationMinutes)}
                    onChange={(event) => setDraft({ ...draft, durationMinutes: Number(event.target.value) })}
                  >
                    {durationOptions().map((option) => (
                      <option key={option} value={option}>{option} мин</option>
                    ))}
                  </Select>
                </div>
              </fieldset>
              <BusyStrip availability={availability} day={draft.date} timeZone={timeZone} />
              <label className="zoom-field">
                Описание
                <Textarea
                  value={draft.description}
                  maxLength={2000}
                  placeholder="Повестка и детали — попадут в приглашение Zoom"
                  onChange={(_event, data) => setDraft({ ...draft, description: data.value })}
                />
              </label>
              <fieldset className="zoom-participants">
                <legend>Кого пригласить</legend>
                <div className="zoom-participant-list">
                  {people
                    .filter((person) => person.id !== currentUserId)
                    .map((person) => (
                      <Checkbox
                        key={person.id}
                        label={<EmployeeProfileLink userId={person.id} personName={person.name}>
                          {person.name}
                        </EmployeeProfileLink>}
                        checked={draft.participantIds.includes(person.id)}
                        onChange={(_event, data) => setDraft({
                          ...draft,
                          participantIds: data.checked
                            ? [...draft.participantIds, person.id]
                            : draft.participantIds.filter((id) => id !== person.id),
                        })}
                      />
                    ))}
                </div>
              </fieldset>
              {formError ? <div className="auth-error" role="alert">{formError}</div> : null}
              <div className="zoom-form-actions">
                <Button appearance="primary" disabled={busy || !draft.topic.trim()} onClick={() => void save()}>
                  {draft.meetingId ? "Сохранить изменения" : "Создать конференцию"}
                </Button>
                <Button appearance="subtle" disabled={busy} onClick={() => { setDraft(undefined); setFormError(""); }}>
                  Отмена
                </Button>
              </div>
            </div>
          ) : selected ? (
            <div className="zoom-detail">
              <div className="zoom-side-nav">
                <span>{statusLabels[selected.status]}</span>
                <Button
                  appearance="subtle"
                  icon={<Dismiss20Regular />}
                  aria-label="Закрыть конференцию"
                  onClick={() => setSelectedId(undefined)}
                />
              </div>
              <h2>{selected.topic}</h2>
              <p className="zoom-detail-time">
                {dayText(selected.startsAt, timeZone)}, {timeText(selected.startsAt, timeZone)}–
                {timeText(selected.endsAt, timeZone)}
              </p>
              <EmployeeProfileLink userId={selected.organizerUserId ?? undefined} personName={selected.organizerName} className="zoom-organizer">
                <Avatar name={selected.organizerName} size={32} color="colorful" aria-hidden="true" />
                <span>
                  <strong>{selected.organizerName}</strong>
                  <small>Организатор</small>
                </span>
              </EmployeeProfileLink>
              {selected.description ? <p className="zoom-detail-text">{selected.description}</p> : null}
              {selected.participantIds.length ? (
                <p className="zoom-detail-text">
                  Приглашены: {selected.participantIds.map((id, index) => <span key={id}>{index ? ", " : ""}<EmployeeProfileLink userId={id} personName={personName(id)}>{personName(id)}</EmployeeProfileLink></span>)}
                </p>
              ) : null}
              {selected.joinUrl ? (
                <dl className="zoom-connection">
                  <div>
                    <dt>Идентификатор</dt>
                    <dd className="zoom-mono">{formatMeetingId(selected.zoomMeetingId)}</dd>
                  </div>
                  {selected.passcode ? (
                    <div>
                      <dt>Код доступа</dt>
                      <dd className="zoom-mono">{selected.passcode}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <p className="zoom-detail-text">
                  Ссылка доступна организатору, приглашённым сотрудникам и администратору.
                </p>
              )}
              <div className="zoom-detail-actions">
                {selected.joinUrl ? (
                  <>
                    <Button
                      appearance="primary"
                      icon={<Open20Regular />}
                      onClick={() => window.open(selected.joinUrl ?? "", "_blank", "noopener,noreferrer")}
                    >
                      Подключиться
                    </Button>
                    <Button
                      icon={<Copy20Regular />}
                      onClick={() => void copy(selected.joinUrl ?? "", "Ссылка скопирована.")}
                    >
                      Копировать ссылку
                    </Button>
                    <Button
                      icon={<Copy20Regular />}
                      onClick={() => void copy(invitationText(selected, timeZone), "Приглашение скопировано.")}
                    >
                      Копировать приглашение
                    </Button>
                  </>
                ) : null}
                {selected.canEdit ? (
                  <Button onClick={() => openComposer(editDraft(selected, timeZone))}>Изменить</Button>
                ) : null}
                {selected.canCancel ? (
                  <Button appearance="secondary" disabled={busy} onClick={() => setConfirmingCancel(true)}>
                    Отменить конференцию
                  </Button>
                ) : null}
              </div>
              {confirmingCancel ? (
                <div className="zoom-confirm" role="alertdialog" aria-label="Подтверждение отмены">
                  <p>Отменить «{selected.topic}»? Ссылка перестанет работать у всех приглашённых.</p>
                  <div>
                    <Button appearance="primary" disabled={busy} onClick={() => void cancelMeeting()}>
                      Да, отменить
                    </Button>
                    <Button appearance="subtle" disabled={busy} onClick={() => setConfirmingCancel(false)}>
                      Оставить
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="zoom-hint">
              <Video24Regular aria-hidden="true" />
              <p>Выберите конференцию слева или создайте новую.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
