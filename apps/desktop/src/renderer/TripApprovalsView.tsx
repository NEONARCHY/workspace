import { useRef, useState, type CSSProperties } from "react";
import { DecisionReason } from "./DecisionReason";
import { RecordComposer, RecordSection, RecordSummary } from "./RecordComposer";
import { tripColumns, tripColumnTotal, tripDropAction } from "./trip-board";
import type { TripAction, TripRequest, TripRequestInput, TripStage, WorkspacePerson } from "@yuksalish/contracts";
import { Badge, Button, Checkbox, DialogSurface, DialogTitle, Input, Textarea, useRestoreFocusTarget } from "@fluentui/react-components";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { Add24Regular, Edit24Regular } from "@fluentui/react-icons";

const actionLabels: Readonly<Record<TripAction, string>> = {
  submit: "Отправить руководителю", resubmit: "Отправить повторно", approve: "Согласовать",
  return: "Вернуть на доработку", reject: "Отклонить",
};
const moveLabels: Readonly<Record<TripAction, string>> = {
  submit: "Руководителю →", resubmit: "Повторно →", approve: "Согласовать →",
  return: "На доработку", reject: "Отклонить",
};
const dateLabel = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
const isFinished = (request: TripRequest) => request.stage === "approved" || request.stage === "rejected";

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
  purpose: string; destination: string; startDate: string; endDate: string; employeeIds: readonly string[];
}
function emptyForm(currentUserId: string): TripFormState {
  const today = new Date().toISOString().slice(0, 10);
  return { purpose: "", destination: "", startDate: today, endDate: today, employeeIds: [currentUserId] };
}

export function TripApprovalsView({ focusRequestId, requests, people, currentUser, onCreate, onUpdate, onAction }: TripApprovalsViewProps) {
  const restoreFocusTarget = useRestoreFocusTarget();
  const [selectedId, setSelectedId] = useState(focusRequestId ?? "");
  const [detailOpen, setDetailOpen] = useState(Boolean(focusRequestId));
  const [pendingDecision, setPendingDecision] = useState<{ id: string; action: "return" | "reject" }>();
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<TripFormState>(() => emptyForm(currentUser.id));
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [filter, setFilter] = useState<"running" | "all" | "finished">("running");
  const [query, setQuery] = useState("");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [draggedId, setDraggedId] = useState("");
  const [dropTarget, setDropTarget] = useState<TripStage>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = requests.find((request) => request.id === selectedId);
  const dragged = requests.find((request) => request.id === draggedId);
  const canChooseOthers = ["manager", "admin", "superadmin"].includes(currentUser.role);
  const personName = (id: string) => people.find((person) => person.id === id)?.name ?? "Сотрудник";
  const visibleRequests = requests.filter((request) => {
    if (filter === "running" && isFinished(request)) return false;
    if (filter === "finished" && !isFinished(request)) return false;
    return [request.number, request.purpose, request.destination, request.stageLabel, ...request.employeeIds.map(personName)]
      .join(" ").toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU"));
  });
  const resetDrag = () => { setDraggedId(""); setDropTarget(undefined); };
  const openRequest = (id: string) => { setSelectedId(id); setDetailOpen(true); setPendingDecision(undefined); setError(""); };
  const closeDetail = () => { if (!busyRef.current) { setDetailOpen(false); setPendingDecision(undefined); setError(""); } };
  const create = () => { setForm(emptyForm(currentUser.id)); setEmployeeQuery(""); setFormMode("create"); setError(""); };

  const save = async () => {
    if (busyRef.current) return;
    if (!form.purpose.trim() || !form.destination.trim() || !form.startDate || !form.endDate || !form.employeeIds.length) {
      setError("Укажите цель, место, даты и хотя бы одного участника поездки."); return;
    }
    if (form.endDate < form.startDate) { setError("Дата окончания не может быть раньше даты начала."); return; }
    busyRef.current = true; setBusy(true); setError("");
    try {
      const payload: TripRequestInput = { ...form, purpose: form.purpose.trim(), destination: form.destination.trim() };
      const saved = formMode === "edit" && selected ? await onUpdate(selected, payload) : await onCreate(payload);
      if (saved) { setSelectedId(saved.id); setDetailOpen(true); setFormMode(null); }
      else setError("Не удалось сохранить поездку. Проверьте данные и подключение к серверу.");
    } catch { setError("Не удалось сохранить поездку. Попробуйте ещё раз."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const commitAction = async (request: TripRequest, action: TripAction, comment?: string) => {
    if (busyRef.current || !request.allowedActions.includes(action)) return false;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const updated = await onAction(request, action, comment);
      if (!updated) { setError("Не удалось изменить стадию. Проверьте подключение и актуальные права на заявку."); return false; }
      setNotice(`${request.number}: ${updated.stageLabel}.${isFinished(updated) && filter === "running" ? " Поездка доступна в фильтре «Завершённые»." : ""}`);
      return true;
    } catch { setError("Не удалось изменить стадию. Карточка остаётся на прежнем месте."); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const act = async (request: TripRequest, action: TripAction) => {
    if (busyRef.current || !request.allowedActions.includes(action)) return;
    if (action === "return" || action === "reject") {
      openRequest(request.id); setPendingDecision({ id: request.id, action }); return;
    }
    await commitAction(request, action);
  };
  const drop = (target: TripStage) => {
    const action = dragged && tripDropAction(dragged, target);
    resetDrag();
    if (dragged && action) void act(dragged, action);
  };
  const feedback = error ? <p className="trip-feedback error" role="alert">{error}</p> : null;

  return (
    <section className="workspace-view bp7-view trips-view trip-view" aria-label="Согласование поездок">
      <header className="bp7-header">
        <div><span className="view-kicker">Согласования · Командировки</span><h1>Согласование поездок</h1><p>Перетащите карточку на доступную стадию или откройте её для решения.</p></div>
        <Button {...restoreFocusTarget} appearance="primary" icon={<Add24Regular />} onClick={create}>Новая командировка</Button>
      </header>
      <div className="trip-commandbar">
        <div className="approval-board-filters" role="group" aria-label="Вид поездок">
          <button type="button" className={view === "kanban" ? "active" : ""} aria-pressed={view === "kanban"} onClick={() => setView("kanban")}>Канбан</button>
          <button type="button" className={view === "list" ? "active" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}>Список</button>
        </div>
        <Input className="trip-search" aria-label="Поиск поездок" placeholder="Цель, город, сотрудник или номер" value={query} onChange={(_, data) => setQuery(data.value)} />
        <div className="approval-board-filters" role="group" aria-label="Фильтр поездок">
          {([["running", "В работе"], ["all", "Все"], ["finished", "Завершённые"]] as const).map(([key, label]) => <button type="button" key={key} className={filter === key ? "active" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
        </div>
      </div>
      {feedback}
      {notice ? <p className="trip-feedback" role="status">{notice}</p> : null}
      {visibleRequests.length === 0 ? <p className="trip-board-help">{requests.length ? "По выбранным фильтрам поездок нет. Измените поиск или выберите «Все»." : "Поездок пока нет. Создайте первую командировку — она появится в колонке «Запуск»."}</p> : null}
      {view === "kanban" ? (
        <div className="approval-kanban trip-kanban" aria-label="Стадии поездок" aria-busy={busy}>
          {tripColumns.map((column) => {
            const items = visibleRequests.filter((request) => request.stage === column.key);
            const dropAction = !busy && dragged ? tripDropAction(dragged, column.key) : undefined;
            return <section key={column.key} data-stage-key={column.key} className={`approval-column trip-column ${dropAction ? "drop-allowed" : ""} ${dropAction && dropTarget === column.key ? "drop-active" : ""}`}
              style={{ "--approval-stage-color": column.color, "--approval-stage-ink": "#111111" } as CSSProperties}
              aria-label={`${column.label}: ${items.length} поездок`}
              onDragOver={(event) => { if (dropAction) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(column.key); } }}
              onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(undefined); }}
              onDrop={(event) => { event.preventDefault(); drop(column.key); }}>
              <header><strong title={column.label}>{column.label}</strong><span className="approval-column-count" aria-label={`${items.length} поездок`}>{items.length}</span></header>
              <div className="approval-column-total" aria-label={`Сумма в колонке «${column.label}»`} title="В заявках на поездку пока нет поля суммы. Бюджет не задан, это не означает бесплатную поездку."><span>Сумма в колонке</span><strong>{tripColumnTotal(items)}</strong></div>
              <div className="approval-column-stack">
                <div className="trip-column-command">{column.key === "launch" ? <Button {...restoreFocusTarget} size="small" appearance="subtle" icon={<Add24Regular />} onClick={create}>Создать поездку</Button> : dropAction ? moveLabels[dropAction] : null}</div>
                {items.map((request) => {
                  const forward = request.allowedActions.find((action) => action === "submit" || action === "resubmit" || action === "approve");
                  const movable = !busy && tripColumns.some((target) => tripDropAction(request, target.key));
                  return <article key={request.id} data-trip-id={request.id} className={`approval-board-card trip-board-card ${movable ? "movable" : ""} ${draggedId === request.id ? "moving" : ""}`} draggable={movable}
                    onDragStart={(event) => { if (!movable) { event.preventDefault(); return; } event.dataTransfer.setData("application/x-yuksalish-trip", request.id); event.dataTransfer.effectAllowed = "move"; setDraggedId(request.id); }}
                    onDragEnd={resetDrag}>
                    <button type="button" className="approval-card-open" aria-label={`Открыть поездку ${request.number}: ${request.purpose}`} onClick={() => openRequest(request.id)}>
                      <span className="approval-card-topline"><span>{request.number}</span>{request.status === "needs_revision" ? <em>Доработка</em> : null}</span>
                      <strong>{request.purpose}</strong>
                      <span className="trip-card-destination">{request.destination}</span>
                      <span className="approval-card-project">{dateLabel(request.startDate)} — {dateLabel(request.endDate)}</span>
                      <span className="approval-card-meta"><span>{personName(request.requesterUserId)}</span><span>{request.employeeIds.length} участн.</span></span>
                    </button>
                    <footer><span>{movable ? "Можно перенести" : request.statusLabel}</span>{forward ? <Button size="small" appearance="subtle" disabled={busy} aria-label={`${actionLabels[forward]}: ${request.number}`} onClick={() => void act(request, forward)}>{moveLabels[forward]}</Button> : null}</footer>
                  </article>;
                })}
                {!items.length ? <div className="approval-column-empty">{dropAction ? moveLabels[dropAction] : "Нет поездок"}</div> : null}
              </div>
            </section>;
          })}
        </div>
      ) : (
        <div className="trip-list" aria-label="Список поездок">{visibleRequests.map((request) => <button className="trip-list-item" key={request.id} onClick={() => openRequest(request.id)} type="button">
          <span><strong>{request.number}</strong><Badge appearance="tint">{request.stageLabel}</Badge></span><b>{request.destination}</b><p>{request.purpose}</p><small>{request.startDate} — {request.endDate} · {request.employeeIds.length} сотруд. · {request.statusLabel}</small>
        </button>)}</div>
      )}
      <Dialog open={(detailOpen && Boolean(selected)) || formMode !== null} onOpenChange={(_, data) => {
        if (!data.open && !busyRef.current) {
          if (formMode !== null) { setFormMode(null); setError(""); }
          else closeDetail();
        }
      }}>
        <DialogSurface className={`trip-dialog ${formMode !== null ? "record-composer-dialog" : ""}`} aria-labelledby={formMode !== null ? "trip-composer-title" : undefined}>
          {formMode === null && selected ? <article className="trip-detail">
            <header><div><span>{selected.number}</span><DialogTitle>{selected.destination}</DialogTitle></div><Button autoFocus appearance="subtle" disabled={busy} onClick={closeDetail} aria-label="Закрыть карточку поездки">Закрыть</Button></header>
            <Badge appearance="tint" color={selected.status === "rejected" ? "danger" : selected.status === "approved" ? "success" : "informative"}>{selected.statusLabel}</Badge>
            <div className="trip-detail-stages" aria-label="Маршрут согласования">{tripColumns.filter((column) => column.key !== (selected.stage === "rejected" ? "approved" : "rejected")).map((column) => <span key={column.key} aria-current={selected.stage === column.key ? "step" : undefined} style={{ "--approval-stage-color": column.color } as CSSProperties}>{column.label}</span>)}</div>
            {feedback}
            {pendingDecision?.id === selected.id ? <DecisionReason key={`${selected.id}:${pendingDecision.action}`} title={pendingDecision.action === "return" ? "Что нужно исправить?" : "Причина отклонения"} onCancel={() => setPendingDecision(undefined)} onConfirm={(reason) => commitAction(selected, pendingDecision.action, reason)} /> : null}
            <div className="trip-purpose"><span>Цель поездки</span><p>{selected.purpose}</p></div>
            <dl className="bp7-facts"><div><dt>Инициатор</dt><dd>{personName(selected.requesterUserId)}</dd></div><div><dt>Период</dt><dd>{selected.startDate} — {selected.endDate}</dd></div></dl>
            <div className="trip-employees"><h3>Сотрудники</h3>{selected.employeeIds.map((id) => <span key={id}>{personName(id)}</span>)}</div>
            <div className="bp7-actions">
              {selected.canEdit ? <Button disabled={busy || Boolean(pendingDecision)} icon={<Edit24Regular />} onClick={() => { setForm({ purpose: selected.purpose, destination: selected.destination, startDate: selected.startDate, endDate: selected.endDate, employeeIds: selected.employeeIds }); setEmployeeQuery(""); setError(""); setFormMode("edit"); }}>Изменить</Button> : null}
              {selected.allowedActions.map((action) => <Button disabled={busy || Boolean(pendingDecision)} appearance={action === "approve" || action === "submit" || action === "resubmit" ? "primary" : "secondary"} key={action} onClick={() => void act(selected, action)}>{actionLabels[action]}</Button>)}
            </div>
            <div className="bp7-history"><h3>История решений</h3>{[...selected.actions].reverse().map((entry) => <div key={entry.id}><i /><p><strong>{entry.action === "created" ? "Заявка создана" : actionLabels[entry.action]}</strong><span>{personName(entry.actorUserId)} · {new Date(entry.createdAt).toLocaleString("ru-RU")}</span>{entry.comment ? <small>{entry.comment}</small> : null}</p></div>)}</div>
          </article> : formMode !== null ? (
          <form className="bp7-modal trip-form record-composer" noValidate aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <RecordComposer title={formMode === "create" ? "Создать заявку на поездку" : "Изменить заявку на поездку"} titleId="trip-composer-title" eyebrow="Согласование поездок" busy={busy} error={error} submitLabel="Сохранить" onClose={() => { if (!busyRef.current) { setFormMode(null); setError(""); } }}
              hint="Сохранение не отправляет поездку на согласование. Отправить её можно из карточки."
              stages={<div className="record-stages" tabIndex={0} role="region" aria-label="Маршрут согласования">{tripColumns.filter((column) => column.key !== "rejected").map((column) => <span key={column.key} aria-current={column.key === (formMode === "edit" ? selected?.stage : "launch") ? "step" : undefined} style={{ "--record-stage-color": column.color } as CSSProperties}>{column.label}</span>)}</div>}
              aside={<>
                <RecordSummary title="Сводка поездки"><div className="record-summary-title">{form.destination.trim() || "Место поездки не указано"}</div><p>{form.purpose.trim() || "Добавьте цель поездки"}</p>
                  <dl className="record-summary-facts"><div><dt>Даты</dt><dd>{form.startDate || "Не указано"} — {form.endDate || "Не указано"}</dd></div><div><dt>Инициатор</dt><dd>{formMode === "edit" && selected ? personName(selected.requesterUserId) : currentUser.name}</dd></div><div><dt>Участников</dt><dd>{form.employeeIds.length}</dd></div></dl>
                  <ul className="record-summary-people">{form.employeeIds.map((id) => <li key={id}>{personName(id)}</li>)}</ul>
                </RecordSummary>
                <section className="record-summary-card record-summary-note"><h3>Что произойдёт дальше</h3><p>Сначала сохраните карточку, затем отправьте её руководителю. После его согласования заявка поступит в кадровую службу.</p><p>История решений будет доступна в карточке поездки.</p></section>
              </>}>
              <RecordSection title="Общее" description="Укажите цель и место поездки — их увидят согласующие."><div className="record-field-grid">
                <label className="record-field-wide">Цель поездки<Textarea aria-label="Цель поездки" aria-required autoFocus resize="vertical" value={form.purpose} onChange={(_, data) => setForm({ ...form, purpose: data.value })} /></label>
                <label className="record-field-wide">Куда едем<Input aria-label="Куда едем" aria-required placeholder="Город, страна или место встречи" value={form.destination} onChange={(_, data) => setForm({ ...form, destination: data.value })} /></label>
              </div></RecordSection>
              <RecordSection title="Даты поездки"><div className="record-field-grid">
                <label>Дата начала<Input aria-label="Дата начала" aria-required type="date" value={form.startDate} onChange={(_, data) => setForm({ ...form, startDate: data.value })} /></label>
                <label>Дата окончания<Input aria-label="Дата окончания" aria-required type="date" value={form.endDate} onChange={(_, data) => setForm({ ...form, endDate: data.value })} /></label>
              </div></RecordSection>
              <RecordSection title="Участники поездки" description={canChooseOthers ? "Отметьте сотрудников, которые отправятся в поездку. Поиск не сбрасывает выбор." : "Вы можете создать поездку для себя."}>
                {canChooseOthers ? <Input aria-label="Найти участника поездки" placeholder="Имя или должность" value={employeeQuery} onChange={(_, data) => setEmployeeQuery(data.value)} /> : null}
                <fieldset className="employee-picker"><legend className="sr-only">Выбор участников</legend>{people.filter((person) => (canChooseOthers || person.id === currentUser.id) && `${person.name} ${person.jobTitle ?? ""}`.toLocaleLowerCase("ru-RU").includes(employeeQuery.trim().toLocaleLowerCase("ru-RU"))).map((person) => <Checkbox checked={form.employeeIds.includes(person.id)} key={person.id} label={`${person.name}${person.jobTitle ? ` · ${person.jobTitle}` : ""}`} onChange={(_, data) => setForm({ ...form, employeeIds: data.checked ? [...form.employeeIds, person.id] : form.employeeIds.filter((id) => id !== person.id) })} />)}</fieldset>
                {canChooseOthers && !people.some((person) => `${person.name} ${person.jobTitle ?? ""}`.toLocaleLowerCase("ru-RU").includes(employeeQuery.trim().toLocaleLowerCase("ru-RU"))) ? <p role="status">Сотрудники не найдены. Измените поиск.</p> : null}
              </RecordSection>
            </RecordComposer>
          </form>) : null}
        </DialogSurface>
      </Dialog>
    </section>
  );
}
