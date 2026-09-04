import { useState } from "react";

import type { TripAction, TripRequest, TripRequestInput, WorkspacePerson } from "@yuksalish/contracts";
import { Badge, Button, Checkbox, Input, Textarea } from "@fluentui/react-components";
import { Add24Regular, Checkmark24Regular, Edit24Regular } from "@fluentui/react-icons";

const actionLabels: Readonly<Record<TripAction, string>> = {
  submit: "Отправить руководителю",
  resubmit: "Отправить повторно",
  approve: "Согласовать",
  return: "Вернуть на доработку",
  reject: "Отклонить",
};

interface TripApprovalsViewProps {
  readonly focusRequestId?: string;
  readonly requests: readonly TripRequest[];
  readonly people: readonly WorkspacePerson[];
  readonly currentUser: WorkspacePerson;
  readonly onCreate: (payload: TripRequestInput) => Promise<TripRequest | undefined>;
  readonly onUpdate: (request: TripRequest, payload: TripRequestInput) => Promise<TripRequest | undefined>;
  readonly onAction: (request: TripRequest, action: TripAction, comment?: string) => Promise<TripRequest | undefined>;
}

interface TripFormState {
  purpose: string;
  destination: string;
  startDate: string;
  endDate: string;
  employeeIds: readonly string[];
}

function emptyForm(currentUserId: string): TripFormState {
  const today = new Date().toISOString().slice(0, 10);
  return { purpose: "", destination: "", startDate: today, endDate: today, employeeIds: [currentUserId] };
}

export function TripApprovalsView({ focusRequestId, requests, people, currentUser, onCreate, onUpdate, onAction }: TripApprovalsViewProps) {
  const [selectedId, setSelectedId] = useState(focusRequestId ?? requests[0]?.id ?? "");
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<TripFormState>(() => emptyForm(currentUser.id));
  const selected = requests.find((request) => request.id === selectedId)
    ?? requests[0];
  const canChooseOthers = ["manager", "admin", "superadmin"].includes(currentUser.role);
  const personName = (id: string) => people.find((person) => person.id === id)?.name ?? "Сотрудник";

  const save = async () => {
    if (!form.purpose.trim() || !form.destination.trim() || !form.startDate || !form.endDate || form.employeeIds.length === 0) return;
    const payload: TripRequestInput = { ...form, purpose: form.purpose.trim(), destination: form.destination.trim() };
    const saved = formMode === "edit" && selected !== undefined
      ? await onUpdate(selected, payload)
      : await onCreate(payload);
    if (saved !== undefined) {
      setSelectedId(saved.id);
      setFormMode(null);
    }
  };

  const act = async (request: TripRequest, action: TripAction) => {
    const comment = action === "return" || action === "reject"
      ? window.prompt(action === "return" ? "Что нужно исправить?" : "Укажите причину отклонения")?.trim()
      : undefined;
    if ((action === "return" || action === "reject") && !comment) return;
    await onAction(request, action, comment);
  };

  return (
    <section className="workspace-view bp7-view trips-view" aria-label="Согласование поездок">
      <header className="bp7-header">
        <div><span className="view-kicker">BP‑7 · Согласование поездок</span><h1>Командировки</h1><p>Маршрут: запуск → руководитель → кадровая служба → решение</p></div>
        <Button appearance="primary" icon={<Add24Regular />} onClick={() => { setForm(emptyForm(currentUser.id)); setFormMode("create"); }}>Новая командировка</Button>
      </header>
      <div className="trip-layout">
        <div className="trip-list">
          {requests.map((request) => (
            <button className={`trip-list-item ${request.id === selected?.id ? "selected" : ""}`} key={request.id} onClick={() => setSelectedId(request.id)} type="button">
              <span><strong>{request.number}</strong><Badge appearance="tint">{request.stageLabel}</Badge></span>
              <b>{request.destination}</b>
              <p>{request.purpose}</p>
              <small>{request.startDate} — {request.endDate} · {request.employeeIds.length} сотруд.</small>
            </button>
          ))}
          {requests.length === 0 ? <div className="bp7-empty"><h2>Заявок пока нет</h2><p>Создайте первую командировку и отправьте её руководителю.</p></div> : null}
        </div>
        {selected !== undefined ? (
          <article className="trip-detail">
            <header><div><span>{selected.number}</span><h2>{selected.destination}</h2></div><Badge appearance="filled" color={selected.status === "rejected" ? "danger" : selected.status === "approved" ? "success" : "informative"}>{selected.statusLabel}</Badge></header>
            <section className="trip-route" aria-label="Маршрут согласования">
              {["Запуск", "Руководитель", "Кадровая служба", selected.stage === "rejected" ? "Отклонено" : "Утверждено"].map((label, index) => {
                const stageIndex = ["launch", "manager_approval", "hr", selected.stage].indexOf(selected.stage);
                return <span className={index <= stageIndex ? "done" : ""} key={`${label}-${index}`}><i>{index < stageIndex ? <Checkmark24Regular /> : index + 1}</i>{label}</span>;
              })}
            </section>
            <div className="trip-purpose"><span>Цель поездки</span><p>{selected.purpose}</p></div>
            <dl className="bp7-facts">
              <div><dt>Инициатор</dt><dd>{personName(selected.requesterUserId)}</dd></div>
              <div><dt>Период</dt><dd>{selected.startDate} — {selected.endDate}</dd></div>
            </dl>
            <div className="trip-employees"><h3>Сотрудники</h3>{selected.employeeIds.map((id) => <span key={id}>{personName(id)}</span>)}</div>
            <div className="bp7-actions">
              {selected.canEdit ? <Button icon={<Edit24Regular />} onClick={() => { setForm({ purpose: selected.purpose, destination: selected.destination, startDate: selected.startDate, endDate: selected.endDate, employeeIds: selected.employeeIds }); setFormMode("edit"); }}>Изменить</Button> : null}
              {selected.allowedActions.map((action) => <Button appearance={action === "approve" || action === "submit" || action === "resubmit" ? "primary" : "secondary"} key={action} onClick={() => void act(selected, action)}>{actionLabels[action]}</Button>)}
            </div>
            <div className="bp7-history"><h3>История решений</h3>{[...selected.actions].reverse().map((entry) => <div key={entry.id}><i /><p><strong>{entry.action === "created" ? "Заявка создана" : actionLabels[entry.action]}</strong><span>{personName(entry.actorUserId)} · {new Date(entry.createdAt).toLocaleString("ru-RU")}</span>{entry.comment ? <small>{entry.comment}</small> : null}</p></div>)}</div>
          </article>
        ) : null}
      </div>
      {formMode !== null ? (
        <div className="bp7-modal-backdrop" role="presentation">
          <form className="bp7-modal" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <header><div><span>{formMode === "create" ? "Новая заявка" : "Исправление заявки"}</span><h2>Командировка</h2></div><Button appearance="subtle" onClick={() => setFormMode(null)}>Закрыть</Button></header>
            <div className="bp7-form-grid">
              <label className="span-two">Цель поездки<Textarea resize="vertical" value={form.purpose} onChange={(_, data) => setForm({ ...form, purpose: data.value })} /></label>
              <label className="span-two">Куда едем<Input value={form.destination} onChange={(_, data) => setForm({ ...form, destination: data.value })} /></label>
              <label>Дата начала<Input type="date" value={form.startDate} onChange={(_, data) => setForm({ ...form, startDate: data.value })} /></label>
              <label>Дата окончания<Input type="date" value={form.endDate} onChange={(_, data) => setForm({ ...form, endDate: data.value })} /></label>
              <fieldset className="span-two employee-picker"><legend>Участники поездки</legend>{people.filter((person) => canChooseOthers || person.id === currentUser.id).map((person) => <Checkbox checked={form.employeeIds.includes(person.id)} key={person.id} label={`${person.name}${person.jobTitle ? ` · ${person.jobTitle}` : ""}`} onChange={(_, data) => setForm({ ...form, employeeIds: data.checked ? [...form.employeeIds, person.id] : form.employeeIds.filter((id) => id !== person.id) })} />)}</fieldset>
            </div>
            <footer><Button onClick={() => setFormMode(null)}>Отмена</Button><Button appearance="primary" type="submit">Сохранить</Button></footer>
          </form>
        </div>
      ) : null}
    </section>
  );
}
