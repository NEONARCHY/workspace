import { useRef, useState, type CSSProperties } from "react";
import { SpatialBoard, SpatialCard, SpatialLane } from "./SpatialBoard";
import { DecisionReason } from "./DecisionReason";
import { RecordComposer, RecordSection, RecordSummary } from "./RecordComposer";
import { tripColumns, tripDropAction } from "./trip-board";
import type { TripAction, TripRequest, TripRequestInput, TripStage, WorkspacePerson } from "@yuksalish/contracts";
import { Avatar, Badge, Button, Checkbox, DialogSurface, DialogTitle, Input, Textarea, useRestoreFocusTarget } from "@fluentui/react-components";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { Add24Regular, Chat24Regular, Dismiss20Regular, Edit24Regular, Search20Regular } from "@fluentui/react-icons";

const actionLabels: Readonly<Record<TripAction, string>> = {
  submit: "Отправить руководителю", resubmit: "Отправить повторно", approve: "Согласовать",
  return: "Вернуть на доработку", reject: "Отклонить", move: "Перемещено администратором",
};
const moveLabels: Readonly<Record<TripAction, string>> = {
  submit: "Руководителю →", resubmit: "Повторно →", approve: "Согласовать →",
  return: "На доработку", reject: "Отклонить", move: "Переместить",
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
  readonly onAction: (request: TripRequest, action: TripAction, comment?: string, targetStage?: TripStage) => Promise<TripRequest | undefined>;
  readonly onOpenChat?: (chatId: string) => void;
}
interface TripFormState {
  purpose: string; destination: string; startDate: string; endDate: string; employeeIds: readonly string[];
}
function emptyForm(currentUserId: string): TripFormState {
  const today = new Date().toISOString().slice(0, 10);
  return { purpose: "", destination: "", startDate: today, endDate: today, employeeIds: [currentUserId] };
}

export function TripApprovalsView({ focusRequestId, requests, people, currentUser, onCreate, onUpdate, onAction, onOpenChat }: TripApprovalsViewProps) {
  const restoreFocusTarget = useRestoreFocusTarget();
  const [selectedId, setSelectedId] = useState(focusRequestId ?? "");
  const [detailOpen, setDetailOpen] = useState(Boolean(focusRequestId));
  const [pendingDecision, setPendingDecision] = useState<{ id: string; action: "return" | "reject" }>();
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<TripFormState>(() => emptyForm(currentUser.id));
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [filter, setFilter] = useState<"running" | "all" | "finished">("running");
  const [query, setQuery] = useState("");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = requests.find((request) => request.id === selectedId);
  const canChooseOthers = ["manager", "admin", "superadmin"].includes(currentUser.role);
  const isAdministrator = ["admin", "superadmin"].includes(currentUser.role);
  const personName = (id: string) => people.find((person) => person.id === id)?.name ?? "Сотрудник";
  const runningCount = requests.filter((request) => !isFinished(request)).length;
  const finishedCount = requests.length - runningCount;
  const actionableCount = requests.filter((request) => request.allowedActions.length > 0).length;
  const revisionCount = requests.filter((request) => request.status === "needs_revision").length;
  const filterCounts = { running: runningCount, all: requests.length, finished: finishedCount };
  const visibleRequests = requests.filter((request) => {
    if (filter === "running" && isFinished(request)) return false;
    if (filter === "finished" && !isFinished(request)) return false;
    return [request.number, request.purpose, request.destination, request.stageLabel, ...request.employeeIds.map(personName)]
      .join(" ").toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU"));
  });

  const openRequest = (id: string) => { setFormOpen(false); setFormMode(null); setSelectedId(id); setDetailOpen(true); setPendingDecision(undefined); setError(""); };
  const closeDetail = () => { if (!busyRef.current) { setDetailOpen(false); setPendingDecision(undefined); setError(""); } };
  const closeForm = () => { if (!busyRef.current) { setFormOpen(false); setError(""); } };
  const create = () => { setDetailOpen(false); setForm(emptyForm(currentUser.id)); setEmployeeQuery(""); setFormMode("create"); setFormOpen(true); setError(""); };

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
      if (saved) { setSelectedId(saved.id); setFormOpen(false); setDetailOpen(true); setFormMode(null); }
      else setError("Не удалось сохранить поездку. Проверьте данные и подключение к серверу.");
    } catch { setError("Не удалось сохранить поездку. Попробуйте ещё раз."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const commitAction = async (request: TripRequest, action: TripAction, comment?: string, targetStage?: TripStage) => {
    if (busyRef.current || (action === "move" ? !isAdministrator || !targetStage : !request.allowedActions.includes(action))) return false;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const updated = action === "move"
        ? await onAction(request, action, comment, targetStage)
        : await onAction(request, action, comment);
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
  const feedback = error ? <p className="trip-feedback error" role="alert">{error}</p> : null;

  return (
    <section className="workspace-view bp7-view trips-view trip-view workflow-process-view" aria-label="Согласование поездок">
      <header className="bp7-header workflow-hero-header">
        <div><span className="view-kicker">Согласования · Командировки</span><h1>Согласование поездок</h1><p>Перетащите карточку на доступную стадию или откройте её для решения.</p></div>
        <Button {...restoreFocusTarget} appearance="primary" icon={<Add24Regular />} onClick={create}>Новая командировка</Button>
      </header>

      <section className="ws2-process-overview trip-overview" aria-label="Сводка по командировкам">
        <button type="button" className="ws2-process-focus" onClick={() => setFilter("running")}>
          <span>Ожидают действий</span>
          <strong>{actionableCount}</strong>
          <small>Показать поездки в работе <span aria-hidden="true">→</span></small>
        </button>
        <div className="ws2-process-metrics">
          <div><strong>{runningCount}</strong><span>в работе</span></div>
          <div className={revisionCount ? "attention" : ""}><strong>{revisionCount}</strong><span>на доработке</span></div>
          <div><strong>{finishedCount}</strong><span>завершено</span></div>
        </div>
      </section>

      <div className="trip-commandbar ws2-process-toolbar">
        <div className="ws2-segmented" role="group" aria-label="Вид поездок">
          <button type="button" className={view === "kanban" ? "active" : ""} aria-pressed={view === "kanban"} onClick={() => setView("kanban")}>Канбан</button>
          <button type="button" className={view === "list" ? "active" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}>Список</button>
        </div>
        <Input contentBefore={<Search20Regular />} className="trip-search" aria-label="Поиск поездок" placeholder="Цель, город, сотрудник или номер" value={query} onChange={(_, data) => setQuery(data.value)} />
        <div className="ws2-segmented" role="group" aria-label="Фильтр поездок">
          {([["running", "В работе"], ["all", "Все"], ["finished", "Завершённые"]] as const).map(([key, label]) => <button type="button" key={key} className={filter === key ? "active" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span>{filterCounts[key]}</span></button>)}
        </div>
      </div>
      {feedback}
      {notice ? <p className="trip-feedback" role="status">{notice}</p> : null}
      {visibleRequests.length === 0 ? <p className="trip-board-help">{requests.length ? "По выбранным фильтрам поездок нет. Измените поиск или выберите «Все»." : "Поездок пока нет. Создайте первую командировку — она появится в колонке «Запуск»."}</p> : null}
      {view === "kanban" ? (
        <SpatialBoard canDrop={(id, target) => { const request = requests.find(item => item.id === id); return !busy && !!request && !!tripDropAction(request, target as TripStage, isAdministrator); }} onMove={async (id, target) => { const request = requests.find(item => item.id === id); const targetStage = target as TripStage; const action = request && tripDropAction(request, targetStage, isAdministrator); if (request && action) { if (action === "move") await commitAction(request, action, `Перенос на этап «${tripColumns.find((column) => column.key === targetStage)?.label ?? targetStage}»`, targetStage); else await act(request, action); } }}>
        <div className="approval-kanban trip-kanban" aria-label="Стадии поездок" aria-busy={busy}>
          {tripColumns.map((column) => {
            const items = visibleRequests.filter((request) => request.stage === column.key);
            return <SpatialLane id={column.key} key={column.key} data-stage-key={column.key} className={`approval-column trip-column `}
              style={{ "--approval-stage-color": column.color, "--approval-stage-ink": "#111111" } as CSSProperties}
              aria-label={`${column.label}: ${items.length} поездок`}>
              <header><strong title={column.label}>{column.label}</strong><span className="approval-column-count" aria-label={`${items.length} поездок`}>{items.length}</span></header>
              <div className="approval-column-total" aria-label={`${items.length} поездок на этапе «${column.label}»`}><span>Поездок на этапе</span><strong>{items.length}</strong></div>
              <div className="approval-column-stack" tabIndex={0} aria-label={`Поездки на этапе «${column.label}»`}>
                {items.map((request) => {
                  const forward = request.allowedActions.find((action) => action === "submit" || action === "resubmit" || action === "approve");
                  const movable = !busy && tripColumns.some((target) => tripDropAction(request, target.key, isAdministrator));
                  return <SpatialCard id={request.id} lane={column.key} label={request.purpose} disabled={!movable} key={request.id} data-trip-id={request.id} className={`approval-board-card trip-board-card ${movable ? "movable" : ""}`}>
                    <button type="button" className="approval-card-open" aria-label={`Открыть поездку ${request.number}: ${request.purpose}`} onClick={() => openRequest(request.id)}>
                      <span className="approval-card-topline"><span>{request.number}</span>{request.status === "needs_revision" ? <em>Доработка</em> : null}</span>
                      <strong>{request.purpose}</strong>
                      <span className="trip-card-destination">{request.destination}</span>
                      <span className="approval-card-project">{dateLabel(request.startDate)} — {dateLabel(request.endDate)}</span>
                      <span className="approval-card-owner"><Avatar size={24} name={personName(request.requesterUserId)} color="colorful" /><span>{personName(request.requesterUserId)}</span></span>
                      <span className="approval-card-meta"><span>{request.stageLabel}</span><span>{request.employeeIds.length} участн.</span></span>
                    </button>
                    <footer><span>{movable ? "Можно перенести" : request.statusLabel}</span>{request.chatId && onOpenChat ? <Button size="small" className="context-chat-button" appearance="subtle" icon={<Chat24Regular />} aria-label={`Открыть чат поездки ${request.number}`} onClick={() => onOpenChat(request.chatId!)} /> : null}{forward ? <Button size="small" appearance="subtle" disabled={busy} aria-label={`${actionLabels[forward]}: ${request.number}`} onClick={() => void act(request, forward)}>{moveLabels[forward]}</Button> : null}</footer>
                  </SpatialCard>;
                })}
                {!items.length ? <div className="approval-column-empty">Нет поездок</div> : null}
              </div>
            </SpatialLane>;
          })}
        </div>
        </SpatialBoard>
      ) : (
        <div className="trip-list" aria-label="Список поездок">{visibleRequests.map((request) => <button className="trip-list-item" key={request.id} onClick={() => openRequest(request.id)} type="button">
          <span><strong>{request.number}</strong><Badge appearance="tint">{request.stageLabel}</Badge></span><b>{request.destination}</b><p>{request.purpose}</p><small>{request.startDate} — {request.endDate} · {request.employeeIds.length} сотруд. · {request.statusLabel}</small>
        </button>)}</div>
      )}
      <Dialog open={(detailOpen && Boolean(selected)) || formOpen} onOpenChange={(_, data) => {
        if (!data.open && !busyRef.current) {
          if (formOpen) closeForm();
          else closeDetail();
        }
      }}>
        <DialogSurface className={`trip-dialog ${formMode !== null ? "record-composer-dialog" : ""}`} aria-labelledby={formMode !== null ? "trip-composer-title" : undefined}>
          {formMode === null && selected ? <article className="trip-detail">
            <header><div><span>{selected.number}</span><DialogTitle>{selected.destination}</DialogTitle><p>{selected.startDate} — {selected.endDate}</p></div><Button autoFocus appearance="subtle" icon={<Dismiss20Regular />} disabled={busy} onClick={closeDetail} aria-label="Закрыть карточку поездки" /></header>
            <Badge className="trip-detail-status" appearance="tint" color={selected.status === "rejected" ? "danger" : selected.status === "approved" ? "success" : "informative"}>{selected.statusLabel}</Badge>
            <div className="trip-detail-stages" aria-label="Маршрут согласования">{tripColumns.filter((column) => column.key !== (selected.stage === "rejected" ? "approved" : "rejected")).map((column) => <span key={column.key} aria-current={selected.stage === column.key ? "step" : undefined} style={{ "--approval-stage-color": column.color } as CSSProperties}>{column.label}</span>)}</div>
            {feedback}
            {pendingDecision?.id === selected.id ? <DecisionReason key={`${selected.id}:${pendingDecision.action}`} title={pendingDecision.action === "return" ? "Что нужно исправить?" : "Причина отклонения"} onCancel={() => setPendingDecision(undefined)} onConfirm={(reason) => commitAction(selected, pendingDecision.action, reason)} /> : null}
            <div className="trip-purpose"><span>Цель поездки</span><p>{selected.purpose}</p></div>
            <dl className="bp7-facts"><div><dt>Инициатор</dt><dd>{personName(selected.requesterUserId)}</dd></div><div><dt>Период</dt><dd>{selected.startDate} — {selected.endDate}</dd></div></dl>
            <div className="trip-employees"><h3>Сотрудники</h3>{selected.employeeIds.map((id) => <span key={id}>{personName(id)}</span>)}</div>
            {selected.chatId && onOpenChat ? <Button appearance="secondary" icon={<Chat24Regular />} onClick={() => onOpenChat(selected.chatId!)}>Открыть чат поездки</Button> : null}
            <div className="bp7-actions">
              {selected.canEdit ? <Button disabled={busy || Boolean(pendingDecision)} icon={<Edit24Regular />} onClick={() => { setForm({ purpose: selected.purpose, destination: selected.destination, startDate: selected.startDate, endDate: selected.endDate, employeeIds: selected.employeeIds }); setEmployeeQuery(""); setError(""); setFormMode("edit"); }}>Изменить</Button> : null}
              {selected.allowedActions.map((action) => <Button disabled={busy || Boolean(pendingDecision)} appearance={action === "approve" || action === "submit" || action === "resubmit" ? "primary" : "secondary"} key={action} onClick={() => void act(selected, action)}>{actionLabels[action]}</Button>)}
              {isAdministrator ? tripColumns.filter((column) => column.key !== selected.stage).map((column) => <Button disabled={busy || Boolean(pendingDecision)} key={`move:${column.key}`} onClick={() => void commitAction(selected, "move", `Перенос на этап «${column.label}»`, column.key)}>{column.label}</Button>) : null}
            </div>
            <div className="bp7-history"><h3>История решений</h3>{[...selected.actions].reverse().map((entry) => <div key={entry.id}><i /><p><strong>{entry.action === "created" ? "Заявка создана" : actionLabels[entry.action]}</strong><span>{personName(entry.actorUserId)} · {new Date(entry.createdAt).toLocaleString("ru-RU")}</span>{entry.comment ? <small>{entry.comment}</small> : null}</p></div>)}</div>
          </article> : formMode !== null ? (
          <form className="bp7-modal trip-form record-composer" noValidate aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <RecordComposer title={formMode === "create" ? "Создать заявку на поездку" : "Изменить заявку на поездку"} titleId="trip-composer-title" eyebrow="Согласование поездок" busy={busy} error={error} submitLabel="Сохранить" onClose={closeForm}
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
