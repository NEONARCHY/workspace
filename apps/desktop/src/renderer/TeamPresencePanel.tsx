import { useEffect, useState } from "react";

import type { WorkdayTeam, WorkdayTeamMember } from "@yuksalish/contracts";
import {
  Avatar, Button, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field,
} from "@fluentui/react-components";
import { ArrowSync20Regular, Clock20Regular, PeopleTeam24Regular } from "@fluentui/react-icons";

import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { loadTeamWorkday, saveWorkdaySchedule } from "./workspace-api";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";

const absenceLabels: Record<string, string> = {
  vacation: "В отпуске",
  personal_time: "Согласованный отгул",
  late_arrival: "Согласованное позднее прибытие",
  sick_leave: "На больничном",
  business_event: "На мероприятии",
};

function statusLabel(person: WorkdayTeamMember): string {
  if (person.status === "working") return "Работает сейчас";
  if (person.status === "approved_absence") return absenceLabels[person.absenceKind ?? ""] ?? "Согласованное отсутствие";
  if (person.status === "finished") return person.session?.closeSource === "automatic"
    ? "День закрыт автоматически" : "Завершил работу";
  if (person.status === "weekend_off") return "Выходной";
  return "Ещё не отметился";
}

function clockLabel(value: string): string {
  return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function TeamPresencePanel({ token }: { readonly token: string }) {
  const [data, setData] = useState<WorkdayTeam>();
  const [error, setError] = useState("");
  const [onlyWorking, setOnlyWorking] = useState(true);
  const [editing, setEditing] = useState<WorkdayTeamMember>();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void loadTeamWorkday(token).then((result) => {
        if (!Array.isArray(result.members)) throw new Error("Сервер вернул неполный обзор команды");
        if (active) { setData(result); setError(""); }
      }).catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : "Не удалось загрузить отметки");
      });
    };
    refresh();
    window.addEventListener("yuksalish:workday-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.removeEventListener("yuksalish:workday-changed", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
    };
  }, [token]);

  const openSchedule = (person: WorkdayTeamMember) => {
    setEditing(person);
    setStart(person.schedule.startsAt.slice(0, 5));
    setEnd(person.schedule.endsAt.slice(0, 5));
    setFormError("");
  };
  const saveSchedule = async () => {
    if (!editing || saving) return;
    if (!start || !end || start >= end) {
      setFormError("Начало рабочего дня должно быть раньше окончания.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await saveWorkdaySchedule(token, editing.userId, start, end);
      const updated = await loadTeamWorkday(token);
      if (!Array.isArray(updated.members)) throw new Error("Сервер вернул неполный обзор команды");
      setData(updated);
      setEditing(undefined);
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : "Не удалось сохранить график");
    } finally {
      setSaving(false);
    }
  };

  const members = data?.members.filter((person) => !onlyWorking || person.status === "working") ?? [];
  return <section className="team-presence-panel" aria-labelledby="team-presence-title">
    <header className="team-presence-heading">
      <div className="team-presence-intro">
        <span>Отметки рабочего дня · сейчас</span>
        <h3 id="team-presence-title">Команда в работе</h3>
        <p>На основе кнопки начала и завершения работы, не геолокации. Согласованные отсутствия показаны отдельно.</p>
      </div>
      <div className="team-presence-count" aria-live="polite">
        <PeopleTeam24Regular aria-hidden="true" />
        <strong>{data?.workingCount ?? "—"}</strong>
        <span>из {data?.members.length ?? "—"} работают</span>
      </div>
    </header>
    <div className="team-presence-toolbar">
      <button type="button" aria-pressed={onlyWorking} className={onlyWorking ? "active" : ""} onClick={() => setOnlyWorking(true)}>Сейчас работают</button>
      <button type="button" aria-pressed={!onlyWorking} className={!onlyWorking ? "active" : ""} onClick={() => setOnlyWorking(false)}>Вся команда</button>
      <small>Данные на {data ? clockLabel(data.asOf) : "—"}</small>
      <Button appearance="subtle" size="small" icon={<ArrowSync20Regular />} aria-label="Обновить отметки" onClick={() => {
        void loadTeamWorkday(token).then((result) => {
          if (!Array.isArray(result.members)) throw new Error("Сервер вернул неполный обзор команды");
          setData(result); setError("");
        }).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "Не удалось обновить отметки"));
      }} />
    </div>
    {error ? <div className="team-presence-error" role="alert">{error}</div> : null}
    <div className="team-presence-people">
      {members.map((person) => <div key={person.userId} className={`team-presence-person is-${person.status}`}>
        <EmployeeProfileLink userId={person.userId} personName={person.name}><Avatar name={person.name} size={36} color="colorful" /></EmployeeProfileLink>
        <EmployeeProfileLink userId={person.userId} personName={person.name} className="team-presence-person-name"><strong>{person.name}</strong><small>{person.jobTitle || "Должность не указана"}</small></EmployeeProfileLink>
        <span className={`team-presence-status is-${person.status}`}>{statusLabel(person)}</span>
        <span className="team-presence-times">{person.session
          ? `${clockLabel(person.session.startedAt)}${person.session.endedAt ? `–${clockLabel(person.session.endedAt)}` : " · в работе"}`
          : "Без отметки"}</span>
        <span className="team-presence-schedule"><Clock20Regular aria-hidden="true" /> {person.schedule.startsAt.slice(0, 5)}–{person.schedule.endsAt.slice(0, 5)}</span>
        {person.canEditSchedule ? <Button appearance="subtle" size="small" onClick={() => openSchedule(person)}>График</Button> : null}
        {person.session?.isWeekend ? <small className="team-presence-weekend">Работа в выходной</small> : null}
      </div>)}
      {!data && !error ? <p className="team-presence-empty">Загружаем отметки команды…</p> : null}
      {data && !members.length ? <p className="team-presence-empty">{onlyWorking ? "Сейчас никто не начал рабочий день." : "Сотрудников пока нет."}</p> : null}
    </div>
    <Dialog open={Boolean(editing)} onOpenChange={(_event, next) => { if (!next.open && !saving) setEditing(undefined); }}>
      <DialogSurface className="workday-schedule-dialog" aria-label="График сотрудника">
        <DialogBody>
          <DialogTitle>График · {editing ? <EmployeeProfileLink userId={editing.userId} personName={editing.name}>{editing.name}</EmployeeProfileLink> : null}</DialogTitle>
          <DialogContent>
            <p>Новый график применяется к будущим отметкам. Уже начатый рабочий день сохранит прежнее время.</p>
            <div className="workday-schedule-fields">
              <Field label="Начало"><WorkspaceDateTimePicker mode="time" ariaLabel="Начало рабочего дня" value={start} onChange={setStart} /></Field>
              <Field label="Окончание"><WorkspaceDateTimePicker mode="time" ariaLabel="Окончание рабочего дня" value={end} onChange={setEnd} /></Field>
            </div>
            {formError ? <p className="team-presence-error" role="alert">{formError}</p> : null}
          </DialogContent>
          <DialogActions>
            <Button disabled={saving} onClick={() => setEditing(undefined)}>Отмена</Button>
            <Button appearance="primary" disabled={saving} onClick={() => void saveSchedule()}>{saving ? "Сохраняем…" : "Сохранить график"}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  </section>;
}
