import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LeaveDecision, LeaveHrDecisionInput, LeaveRequest, LeaveTenureRule, WorkspacePerson } from "@yuksalish/contracts";
import { Button, Field, Input, Textarea } from "@fluentui/react-components";
import { Add24Regular, ArrowClockwise20Regular, DocumentPdf20Regular } from "@fluentui/react-icons";
import { ExternalFileViewer, type FileViewerSource } from "./FileViewer";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";
import {
  createWorkspaceLeave, loadWorkspaceLeaveContext, loadWorkspaceLeaveDocument,
  loadWorkspaceLeaves, previewWorkspaceLeaveHrOrder, reviewWorkspaceLeaveDeputy, reviewWorkspaceLeaveHr,
  reviseWorkspaceLeave, saveWorkspaceLeaveSignature, saveWorkspaceLeaveTenureRules, withdrawWorkspaceLeave,
} from "./workspace-api";
import "./leave-view.css";

interface Props {
  readonly token: string;
  readonly people: readonly WorkspacePerson[];
  readonly currentUserId: string;
  readonly canCreate: boolean;
  readonly focusRequestId?: string;
}

type DocumentKind = "application" | "order-preview" | "order" | "hr-preview";
type HrForm = {
  startsOn: string; endsOn: string; workYearStartsOn: string; workYearEndsOn: string;
  calendarDays: string; paidDays: string; returnOn: string; accountingOfficer: string;
  orderEmployeeName: string; orderJobTitle: string; orderSignerName: string;
  orderNumber: string; tenureAdditionalDays: string;
  orderClause1: string; orderClause2: string; orderClause3: string;
};

const example = "Менга йиллик меҳнат таътили беришингизни сўрайман.";
const applicationAddressee = "«Юксалиш» ҳаракати раисининг биринчи ўринбосари — ижрочи директор";
const initialHr: HrForm = {
  startsOn: "", endsOn: "", workYearStartsOn: "", workYearEndsOn: "",
  calendarDays: "", paidDays: "", returnOn: "", accountingOfficer: "",
  orderEmployeeName: "", orderJobTitle: "", orderSignerName: "", orderNumber: "",
  tenureAdditionalDays: "0", orderClause1: "", orderClause2: "", orderClause3: "",
};
const hrFields: { key: keyof HrForm; label: string; type?: "date" | "number" | "text" }[] = [
  { key: "startsOn", label: "Начало отпуска", type: "date" },
  { key: "endsOn", label: "Конец отпуска", type: "date" },
  { key: "workYearStartsOn", label: "Рабочий период: начало", type: "date" },
  { key: "workYearEndsOn", label: "Рабочий период: конец", type: "date" },
  { key: "calendarDays", label: "Календарных дней", type: "number" },
  { key: "paidDays", label: "Дней для расчёта", type: "number" },
  { key: "returnOn", label: "Дата выхода на работу", type: "date" },
  { key: "orderNumber", label: "Номер приказа (без «-сон а/ф»)" },
  { key: "orderEmployeeName", label: "ФИО сотрудника для приказа" },
  { key: "orderJobTitle", label: "Должность сотрудника для приказа" },
  { key: "accountingOfficer", label: "Руководитель бухгалтерии (если указан)" },
  { key: "orderSignerName", label: "ФИО первого заместителя для приказа" },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось выполнить действие";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function eligibleTenureDays(employmentDate: string | null, startsOn: string, rules: readonly LeaveTenureRule[]): number {
  if (!employmentDate || !startsOn || startsOn < employmentDate) return 0;
  const [year = 0, month = 1, day = 1] = employmentDate.split("-").map(Number);
  return rules.reduce((days, rule) => {
    const thresholdYear = year + rule.afterYears;
    const lastDay = new Date(Date.UTC(thresholdYear, month, 0)).getUTCDate();
    const threshold = new Date(Date.UTC(thresholdYear, month - 1, Math.min(day, lastDay))).toISOString().slice(0, 10);
    return startsOn > threshold ? Math.max(days, rule.extraDays) : days;
  }, 0);
}

function formFor(item: LeaveRequest, people: readonly WorkspacePerson[], deputyId?: string): HrForm {
  return {
    startsOn: item.startsOn ?? item.requestedStartsOn,
    endsOn: item.endsOn ?? item.requestedEndsOn ?? "",
    workYearStartsOn: item.workYearStartsOn ?? "",
    workYearEndsOn: item.workYearEndsOn ?? "",
    calendarDays: item.calendarDays?.toString() ?? "",
    paidDays: item.paidDays?.toString() ?? "",
    returnOn: item.returnOn ?? "",
    accountingOfficer: item.accountingOfficer ?? "",
    orderEmployeeName: item.orderEmployeeName ?? people.find((person) => person.id === item.requesterUserId)?.name ?? "",
    orderJobTitle: item.orderJobTitle ?? people.find((person) => person.id === item.requesterUserId)?.jobTitle ?? "",
    orderSignerName: item.orderSignerName ?? people.find((person) => person.id === deputyId)?.name ?? "",
    orderNumber: item.orderNumber ?? "",
    tenureAdditionalDays: item.tenureAdditionalDays?.toString() ?? "0",
    orderClause1: item.orderClause1 ?? "", orderClause2: item.orderClause2 ?? "", orderClause3: item.orderClause3 ?? "",
  };
}

export function LeaveView({ token, people, currentUserId, canCreate, focusRequestId }: Props) {
  const [requests, setRequests] = useState<readonly LeaveRequest[]>([]);
  const [context, setContext] = useState<Awaited<ReturnType<typeof loadWorkspaceLeaveContext>>>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [applicationText, setApplicationText] = useState("");
  const [previewText, setPreviewText] = useState(false);
  const [showApplicationExample, setShowApplicationExample] = useState(false);
  const [hrForm, setHrForm] = useState<HrForm>(initialHr);
  const [formRevision, setFormRevision] = useState<string>();
  const [applicationRevision, setApplicationRevision] = useState<string>();
  const [comment, setComment] = useState("");
  const [document, setDocument] = useState<{ requestId: string; kind: DocumentKind }>();
  const [hrPreview, setHrPreview] = useState<Blob>();
  const [ruleDraft, setRuleDraft] = useState<LeaveTenureRule[]>();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "mine" | "action" | "approved">("all");
  const focused = useRef(false);

  const refresh = useCallback((signal?: AbortSignal): Promise<void> =>
    Promise.all([loadWorkspaceLeaves(token, signal), loadWorkspaceLeaveContext(token, signal)])
      .then(([next, info]) => {
      if (signal?.aborted) return;
      setRequests(next);
      setContext(info);
      setError("");
      if (focusRequestId && !focused.current) {
        const target = next.find((item) => item.id === focusRequestId);
        if (target) {
          focused.current = true;
          setSelectedId(target.id);
          setHrForm(formFor(target, people, info.deputyUserId));
          setFormRevision(target.updatedAt);
        }
      }
      })
      .catch((cause: unknown) => { if (!signal?.aborted) setError(errorText(cause)); })
      .finally(() => { if (!signal?.aborted) setLoading(false); }),
  [token, focusRequestId, people]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const selected = requests.find((item) => item.id === selectedId);
  const tenureRules = ruleDraft ?? context?.tenureRules ?? [];
  const eligibleDays = selected ? eligibleTenureDays(selected.organizationEmploymentDate, hrForm.startsOn, context?.tenureRules ?? []) : 0;
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const exampleRequester = peopleById.get(editing && selected ? selected.requesterUserId : currentUserId);
  const exampleDeputy = context?.deputyUserId ? peopleById.get(context.deputyUserId) : undefined;
  const visible = requests.filter((item) => filter === "all" ||
    filter === "mine" && item.requesterUserId === currentUserId ||
    filter === "action" && (item.canReviewHr || item.canReviewDeputy || item.status === "needs_revision" && item.requesterUserId === currentUserId) ||
    filter === "approved" && item.status === "approved");

  function choose(item: LeaveRequest) {
    setSelectedId(item.id);
    setShowCreate(false);
    setEditing(false);
    setShowApplicationExample(false);
    setComment("");
    setHrForm(formFor(item, people, context?.deputyUserId));
    setFormRevision(item.updatedAt);
    setApplicationText(item.applicationText);
    setStartsOn(item.requestedStartsOn);
    setEndsOn(item.requestedEndsOn ?? "");
  }

  async function mutate(action: () => Promise<LeaveRequest>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await action();
      setRequests((previous) => [updated, ...previous.filter((entry) => entry.id !== updated.id)]);
      setSelectedId(updated.id);
      setHrForm(formFor(updated, people, context?.deputyUserId));
      setFormRevision(updated.updatedAt);
      if (updated.status === "approved") setFilter("approved");
      setShowCreate(false);
      setEditing(false);
      setComment("");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  function submitApplication() {
    if (!applicationText.trim() || !startsOn) {
      setError("Напишите заявление и укажите предполагаемую дату начала.");
      return;
    }
    if (endsOn && endsOn < startsOn) {
      setError("Конец отпуска не может быть раньше начала.");
      return;
    }
    const payload = { applicationText, startsOn, endsOn: endsOn || null,
      ...(editing && selected ? { expectedUpdatedAt: applicationRevision } : {}) };
    void mutate(() => editing && selected?.canRevise
      ? reviseWorkspaceLeave(token, selected.id, payload)
      : createWorkspaceLeave(token, payload));
  }

  function hrApprovalPayload(): LeaveHrDecisionInput {
    return {
      expectedUpdatedAt: formRevision,
      action: "approve", startsOn: hrForm.startsOn, endsOn: hrForm.endsOn,
      workYearStartsOn: hrForm.workYearStartsOn, workYearEndsOn: hrForm.workYearEndsOn,
      calendarDays: Number(hrForm.calendarDays), paidDays: Number(hrForm.paidDays),
      tenureAdditionalDays: Number(hrForm.tenureAdditionalDays),
      returnOn: hrForm.returnOn, orderNumber: hrForm.orderNumber,
      orderEmployeeName: hrForm.orderEmployeeName, orderJobTitle: hrForm.orderJobTitle,
      orderSignerName: hrForm.orderSignerName, accountingOfficer: hrForm.accountingOfficer,
      orderClause1: hrForm.orderClause1, orderClause2: hrForm.orderClause2, orderClause3: hrForm.orderClause3,
      comment,
    };
  }

  function hrDecision(action: LeaveDecision) {
    const payload: LeaveHrDecisionInput = action === "approve" ? hrApprovalPayload() : { action, comment, expectedUpdatedAt: selected?.updatedAt };
    if (!selected) return;
    void mutate(() => reviewWorkspaceLeaveHr(token, selected.id, payload));
  }

  async function previewHrOrder() {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try {
      setHrPreview(await previewWorkspaceLeaveHrOrder(token, selected.id, hrApprovalPayload()));
      setDocument({ requestId: selected.id, kind: "hr-preview" });
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function saveRules() {
    if (!ruleDraft || busy) return;
    if (!ruleDraft.length || ruleDraft.length > 10 || ruleDraft.some((rule, index) =>
      !Number.isInteger(rule.afterYears) || !Number.isInteger(rule.extraDays) ||
      rule.afterYears < 0 || rule.afterYears > 50 || rule.extraDays < 1 || rule.extraDays > 30 ||
      (index > 0 && (rule.afterYears <= ruleDraft[index - 1]!.afterYears ||
        rule.extraDays <= ruleDraft[index - 1]!.extraDays)))) {
      setError("Пороги лет и дополнительные дни должны строго возрастать (не более 10 порогов).");
      return;
    }
    setBusy(true); setError("");
    try { setContext(await saveWorkspaceLeaveTenureRules(token, ruleDraft)); setHrForm((current) => ({ ...current, tenureAdditionalDays: "0" })); setRuleDraft(undefined); setRulesOpen(false); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  function deputyDecision(action: LeaveDecision) {
    if (!selected) return;
    void mutate(() => reviewWorkspaceLeaveDeputy(token, selected.id, { action, comment, expectedUpdatedAt: selected.updatedAt }));
  }

  async function saveSignature(file: File) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setContext(await saveWorkspaceLeaveSignature(token, file));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  const source: FileViewerSource | undefined = document ? {
    id: `${document.requestId}:${document.kind}`, fileName: document.kind === "application" ? "Заявление.pdf" : "Приказ.pdf",
    contentType: "application/pdf", byteSize: 0,
  } : undefined;

  return <section className="workspace-view leave-view" aria-label="Отпуска">
    <WorkspaceSectionHeader motif="absences" className="leave-header">
      <div><span className="view-kicker">Сотрудник · Кадровая служба · Первый заместитель</span>
        <h1>Отпуска</h1><p>Заявление, проверка кадров и подписанный приказ — в одном месте.</p></div>
      <div className="leave-header-actions">
        <Button icon={<ArrowClockwise20Regular />} disabled={loading || busy} onClick={() => void refresh()}>Обновить</Button>
        {canCreate ? <Button appearance="primary" disabled={busy || loading || !context} icon={<Add24Regular />} onClick={() => {
          setSelectedId(undefined); setShowCreate(true); setEditing(false); setApplicationText(""); setStartsOn(""); setEndsOn(""); setPreviewText(false); setShowApplicationExample(false);
        }}>Новое заявление</Button> : null}
      </div>
    </WorkspaceSectionHeader>
    {error ? <WorkspaceNotice tone="error" role="alert">{error}</WorkspaceNotice> : null}
    {loading ? <p className="leave-empty">Загружаем заявления…</p> : <div className="leave-layout">
      <div className="leave-list-area">
        <div className="leave-filters" aria-label="Фильтр заявлений">
          {([ ["all", "Все"], ["mine", "Мои"], ["action", "Ждут решения"], ["approved", "Утверждены"] ] as const).map(([value, label]) =>
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        {visible.length ? <div className="leave-list">{visible.map((item) =>
          <button type="button" key={item.id} disabled={busy} className={`leave-list-item ${selectedId === item.id ? "is-selected" : ""}`}
            onClick={() => choose(item)}>
            <span className="leave-list-top"><strong>{peopleById.get(item.requesterUserId)?.name ?? "Сотрудник"}</strong><span className={`leave-status status-${item.status}`}>{item.statusLabel}</span></span>
            <span>{formatDate(item.startsOn ?? item.requestedStartsOn)}{item.endsOn ?? item.requestedEndsOn ? ` — ${formatDate(item.endsOn ?? item.requestedEndsOn)}` : " · Дата окончания уточняется"}</span>
            {item.orderNumber ? <small>Приказ № {item.orderNumber}-сон а/ф</small> : null}
          </button>)}</div> : <p className="leave-empty">В этом разделе заявлений пока нет.</p>}
      </div>
      <div className="leave-detail">
        {showCreate || editing && selected?.canRevise ? <div className="leave-card">
          <h2>{editing ? "Дополнить заявление" : "Новое заявление"}</h2>
          <p>Подпись от руки не требуется. Каждое исправление сохраняется в истории с указанием автора.</p>
          <Field label="Предполагаемое начало" required><Input type="date" value={startsOn} onChange={(_, data) => setStartsOn(data.value)} /></Field>
          <Field label="Предполагаемое окончание (если известно)"><Input type="date" min={startsOn} value={endsOn} onChange={(_, data) => setEndsOn(data.value)} /></Field>
          <Field label="Текст заявления" required><Textarea rows={9} maxLength={12000} value={applicationText} onChange={(_, data) => setApplicationText(data.value)} /></Field>
          <div className="leave-actions"><Button aria-expanded={showApplicationExample} aria-controls={showApplicationExample ? "leave-application-example" : undefined} onClick={() => setShowApplicationExample((open) => !open)}>{showApplicationExample ? "Скрыть пример аризы" : "Посмотреть пример аризы"}</Button>
            {editing && selected ? <Button icon={<DocumentPdf20Regular />} onClick={() => setDocument({ requestId: selected.id, kind: "application" })}>Открыть текущее заявление PDF</Button> : null}
            <Button disabled={busy} onClick={() => setApplicationText(example)}>Вставить текст примера</Button>
            <Button disabled={!applicationText.trim()} onClick={() => setPreviewText(!previewText)}>{previewText ? "Скрыть предпросмотр" : "Предпросмотр текста"}</Button></div>
          {showApplicationExample ? <div id="leave-application-example" className="leave-paper leave-example-paper" role="region" aria-label="Пример аризы на отпуск">
            <small>Пример для ориентира · даты и данные сотрудника в PDF подставляются из заявки и аккаунта</small>
            <div className="leave-example-address">{applicationAddressee} {exampleDeputy?.name ?? "[биринчи ўринбосарнинг исм-фамилияси]"}га<br />
              «Юксалиш» ҳаракати {exampleRequester?.jobTitle ?? "[лавозим]"} {exampleRequester?.name ?? "[исм фамилия]"}дан</div>
            <h3>АРИЗА</h3><p>{example}</p>
            <p className="leave-example-note">В электронном заявлении подпись от руки не нужна: отправка фиксируется из вашего аккаунта.</p>
          </div> : null}
          {previewText ? <div className="leave-paper" role="region" aria-label="Предпросмотр заявления"><div className="leave-example-address">{applicationAddressee} {exampleDeputy?.name ?? "[биринчи ўринбосарнинг исм-фамилияси]"}га<br />
            «Юксалиш» ҳаракати {exampleRequester?.jobTitle ?? "[лавозим]"} {exampleRequester?.name ?? "[исм фамилия]"}дан</div>
            <h3>АРИЗА</h3><p>{applicationText}</p><small>После отправки будет создан PDF с датой и данными аккаунта.</small></div> : null}
          <div className="leave-actions"><Button appearance="primary" disabled={busy} onClick={submitApplication}>{editing ? selected?.requesterUserId === currentUserId ? "Сохранить и отправить кадрам" : "Сохранить исправления кадровика" : "Отправить кадрам"}</Button>
            <Button disabled={busy} onClick={() => { setShowCreate(false); setEditing(false); }}>Отмена</Button></div>
        </div> : selected ? <div className="leave-card">
          <div className="leave-detail-heading"><div><span className="leave-eyebrow">{selected.statusLabel}</span>
            <h2>{peopleById.get(selected.requesterUserId)?.name ?? "Заявление"}</h2><p>Предполагаемая дата: {formatDate(selected.requestedStartsOn)} · Подано {formatDate(selected.createdAt.slice(0, 10))}</p></div>
            <Button icon={<DocumentPdf20Regular />} onClick={() => setDocument({ requestId: selected.id, kind: "application" })}>Заявление PDF</Button></div>
          <div className="leave-paper"><h3>Заявление сотрудника</h3><p>{selected.applicationText}</p></div>
          {selected.canRevise ? <div className="leave-actions"><Button disabled={busy} onClick={() => {
            setApplicationText(selected.applicationText); setStartsOn(selected.requestedStartsOn);
            setEndsOn(selected.requestedEndsOn ?? ""); setApplicationRevision(selected.updatedAt); setPreviewText(false); setEditing(true);
          }}>Исправить заявление</Button></div> : null}
          {selected.startsOn ? <div className="leave-summary"><div><span>Отпуск</span><strong>{formatDate(selected.startsOn)} — {formatDate(selected.endsOn)}</strong></div>
            <div><span>Рабочий период</span><strong>{formatDate(selected.workYearStartsOn)} — {formatDate(selected.workYearEndsOn)}</strong></div>
            <div><span>Приказ</span><strong>{selected.orderNumber}-сон а/ф · {selected.calendarDays} календ. дней</strong></div>
            {selected.tenureAdditionalDays ? <div><span>За стаж в организации</span><strong>+{selected.tenureAdditionalDays} дн. · приём {formatDate(selected.organizationEmploymentDate)}</strong></div> : null}
            <div><span>Выход на работу</span><strong>{formatDate(selected.returnOn)}</strong></div></div> : null}
          {selected.canReviewHr ? <div className="leave-review"><h3>Проверка кадровой службы</h3>
            <p>Уточните реквизиты, проверьте и при необходимости исправьте заявление. Проект приказа можно открыть до передачи заместителю.</p>
            {formRevision !== selected.updatedAt ? <WorkspaceNotice tone="warning">Заявление изменилось после открытия формы. Ваш ввод сохранён, но перед отправкой выберите заявление в списке заново и проверьте актуальную версию.</WorkspaceNotice> : null}
            <div className="leave-tenure"><strong>Дополнительные дни за стаж только в нашей организации</strong>
              <p>Дата приёма по HR-профилю: {formatDate(selected.organizationEmploymentDate)}. На дату начала отпуска положено {eligibleDays} дн. Общий трудовой стаж не используется.{!selected.organizationEmploymentDate ? " Для допдней сначала укажите дату приёма в разделе HR." : ""}</p>
              <Field label="Добавить дней по стажу"><select aria-label="Добавить дней по стажу" value={hrForm.tenureAdditionalDays}
                onChange={(event) => setHrForm((current) => ({ ...current, tenureAdditionalDays: event.target.value }))}>
                <option value="0">0 дней</option>{eligibleDays ? <option value={eligibleDays}>{eligibleDays} дней</option> : null}
              </select></Field>
              {context?.canEditTenureRules ? <div className="leave-actions"><Button aria-expanded={rulesOpen} onClick={() => { setRulesOpen(!rulesOpen); setRuleDraft([...tenureRules]); }}>Настроить пороги стажа</Button></div> : null}
              {rulesOpen ? <div className="leave-rules" aria-label="Пороги стажа">{tenureRules.map((rule, index) => <div className="leave-rule-row" key={index}>
                <Field label={`Более лет · порог ${index + 1}`}><Input type="number" min="0" max="50" value={String(rule.afterYears)} onChange={(_, data) => setRuleDraft(tenureRules.map((entry, i) => i === index ? { ...entry, afterYears: Number(data.value) } : entry))} /></Field>
                <Field label={`Дополнительных дней · порог ${index + 1}`}><Input type="number" min="1" max="30" value={String(rule.extraDays)} onChange={(_, data) => setRuleDraft(tenureRules.map((entry, i) => i === index ? { ...entry, extraDays: Number(data.value) } : entry))} /></Field>
                <Button disabled={tenureRules.length <= 1} aria-label={`Убрать порог ${index + 1}`} onClick={() => setRuleDraft(tenureRules.filter((_, i) => i !== index))}>Убрать порог</Button>
              </div>)}<div className="leave-actions"><Button disabled={tenureRules.length >= 10} onClick={() => setRuleDraft([...tenureRules, { afterYears: (tenureRules.at(-1)?.afterYears ?? 0) + 5, extraDays: (tenureRules.at(-1)?.extraDays ?? 0) + 2 }])}>Добавить порог</Button>
                <Button appearance="primary" disabled={busy} onClick={() => void saveRules()}>Сохранить пороги</Button></div></div> : null}
            </div>
            <div className="leave-field-grid">{hrFields.map((field) => <Field key={field.key} label={field.label}>
              <Input type={field.type ?? "text"} min={field.type === "number" ? "1" : undefined}
                value={hrForm[field.key]} onChange={(_, data) => setHrForm((current) => ({ ...current, [field.key]: data.value }))} />
            </Field>)}</div>
            <p>«Календарных дней» — итог с учётом дополнительных дней; «дней для расчёта» кадровик уточняет отдельно.</p>
            <h4>Текст приказа</h4><p>Оставьте пункты пустыми для текста по образцу либо исправьте нужный пункт без номера «1.»/«2.»/«3.». Даты и дни в исправленном тексте проверьте перед передачей.</p>
            {([1, 2, 3] as const).map((number) => <Field key={number} label={`Пункт ${number} (необязательно)`}>
              <Textarea rows={3} value={hrForm[`orderClause${number}`]} onChange={(_, data) => setHrForm((current) => ({ ...current, [`orderClause${number}`]: data.value }))} />
            </Field>)}
            <div className="leave-actions"><Button disabled={busy} onClick={() => void previewHrOrder()}>Посмотреть проект приказа PDF</Button></div>
            <Field label="Комментарий при возврате или отказе"><Textarea value={comment} onChange={(_, data) => setComment(data.value)} /></Field>
            <div className="leave-actions"><Button appearance="primary" disabled={busy} onClick={() => hrDecision("approve")}>Передать первому заместителю</Button>
              <Button disabled={busy || !comment.trim()} onClick={() => hrDecision("return")}>Вернуть на дополнение</Button>
              <Button disabled={busy || !comment.trim()} onClick={() => hrDecision("reject")}>Отклонить</Button></div>
          </div> : null}
          {selected.canReviewDeputy ? <div className="leave-review"><h3>Решение первого заместителя</h3>
            <p>Проверьте заявление и реквизиты приказа. При утверждении подпись будет поставлена в приказе автоматически.</p>
            <div className="leave-actions"><Button onClick={() => setDocument({ requestId: selected.id, kind: "order-preview" })}>Предпросмотр приказа</Button></div>
            {context?.canConfigureSignature ? <div className="leave-signature"><span>{context.signatureReady ? "Личная подпись настроена" : "Для утверждения настройте личную подпись PNG"}</span>
              <label className="leave-upload">{context.signatureReady ? "Заменить подпись" : "Загрузить подпись"}<input type="file" accept="image/png" disabled={busy} onChange={(event) => {
                const file = event.target.files?.[0]; if (file) void saveSignature(file); event.target.value = "";
              }} /></label></div> : null}
            <Field label="Комментарий при возврате или отказе"><Textarea value={comment} onChange={(_, data) => setComment(data.value)} /></Field>
            <div className="leave-actions"><Button appearance="primary" disabled={busy || !context?.signatureReady} onClick={() => deputyDecision("approve")}>Утвердить и подписать приказ</Button>
              <Button disabled={busy || !comment.trim()} onClick={() => deputyDecision("return")}>Вернуть кадрам</Button>
              <Button disabled={busy || !comment.trim()} onClick={() => deputyDecision("reject")}>Отклонить</Button></div>
          </div> : null}
          {selected.hasOrder ? <div className="leave-actions"><Button appearance="primary" icon={<DocumentPdf20Regular />} onClick={() => setDocument({ requestId: selected.id, kind: "order" })}>Открыть подписанный приказ</Button></div> : null}
          {selected.canWithdraw ? <div className="leave-actions"><Button disabled={busy} onClick={() => void mutate(() => withdrawWorkspaceLeave(token, selected.id))}>Отозвать заявление</Button></div> : null}
          <div className="leave-history"><h3>История решений</h3>{selected.actions.map((entry) => <p key={entry.id}><strong>{entry.toStatus === "approved" ? "Утверждено" : entry.toStatus === "pending_deputy" ? "Проверено кадрами" : entry.action === "created" ? "Заявление подано" : entry.action === "hr_corrected" ? "Исправлено кадровиком" : entry.toStatus === "needs_revision" ? "Возвращено на дополнение" : entry.toStatus === "rejected" ? "Отклонено" : entry.action === "revised" ? "Дополнено" : "Обновлено"}</strong> · {new Date(entry.createdAt).toLocaleString("ru-RU")}{entry.comment ? ` — ${entry.comment}` : ""}</p>)}</div>
        </div> : <div className="leave-empty leave-placeholder">Выберите заявление или создайте новое.</div>}
      </div>
    </div>}
    {source && document ? <ExternalFileViewer attachment={source} onClose={() => setDocument(undefined)}
      onLoad={(_, signal) => document.kind === "hr-preview" && hrPreview
        ? Promise.resolve(hrPreview) : loadWorkspaceLeaveDocument(token, document.requestId, document.kind as "application" | "order-preview" | "order", signal)}
      onLoadOffice={async () => { throw new Error("Для PDF предпросмотр Office не требуется"); }}
      onDownload={async () => {
        const blob = document.kind === "hr-preview" && hrPreview ? hrPreview
          : await loadWorkspaceLeaveDocument(token, document.requestId, document.kind as "application" | "order-preview" | "order");
        const url = URL.createObjectURL(blob);
        const anchor = globalThis.document.createElement("a"); anchor.href = url; anchor.download = source.fileName; anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }} /> : null}
  </section>;
}
