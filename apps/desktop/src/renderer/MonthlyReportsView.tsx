import { useEffect, useId, useRef, useState } from "react";
import type { MonthlyCalendarDay, MonthlyReport, MonthlyReportFile } from "@yuksalish/contracts";
import { Button, Checkbox, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Spinner, Textarea } from "@fluentui/react-components";
import { DocumentBulletList24Regular } from "@fluentui/react-icons";
import { WorkspaceDialog, focusWorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";
import { authorizeMonthlyPayroll, loadMonthlyCalendar, loadMonthlyReportFile, loadMonthlyReportTemplate, markWorkspaceNotificationRead, saveMonthlyCalendar, submitMonthlyReport } from "./workspace-api";
import type { MonthlyReportsResource } from "./useMonthlyReports";
import { getApiBaseUrl } from "./api-origin";
import { EmployeeAvatar } from "./EmployeeAvatar";
import "./monthly-reports.css";

export function monthlyLabel(month: string) {
  return new Date(`${month}T12:00:00Z`).toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "Asia/Tashkent" });
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export async function downloadMonthlyTemplate(token: string) {
  saveBlob(await loadMonthlyReportTemplate(token), "oylik-hisobot.docx");
}

export function MonthlyReportsView({ token, resource, open, onClose, onAfterClose }: {
  readonly token: string;
  readonly resource: MonthlyReportsResource;
  readonly open?: boolean;
  readonly onClose?: () => void;
  readonly onAfterClose?: (closedSurface: HTMLElement | null) => void;
}) {
  const { data, error, loading, refresh } = resource;
  const id = useId();
  const [selected, setSelected] = useState("");
  const month = selected || data?.activeMonth || data?.cycles[0]?.month || "";
  const cycle = data?.cycles.find(item => item.month === month);
  const [files, setFiles] = useState<readonly File[]>([]);
  const [comment, setComment] = useState("");
  const [authorizationComment, setAuthorizationComment] = useState("");
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirmPayroll, setConfirmPayroll] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setActionError(""); setNotice("");
    try { await action(); } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Не удалось выполнить действие"); }
    finally { setBusy(false); }
  };
  const upload = () => run(async () => {
    if (!month || !files.length) throw new Error("Выберите отчётный месяц и хотя бы один файл");
    if (files.length > 5 || files.some(file => !file.size || file.size > 25 * 1024 * 1024)
      || files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) throw new Error("До 5 непустых файлов, каждый до 25 МБ, вместе до 50 МБ");
    await submitMonthlyReport(token, { id: submissionId, month, comment }, files);
    setFiles([]); setComment(""); setSubmissionId(crypto.randomUUID());
    if (fileInput.current) fileInput.current.value = "";
    setNotice("Отчёт отправлен. Предыдущие версии сохранены в истории.");
    await refresh();
  });
  const download = (report: MonthlyReport, file: MonthlyReportFile) => run(async () => {
    saveBlob(await loadMonthlyReportFile(token, report.id, file.id), file.name);
  });
  const history = data?.reports.filter(report => report.month === month) ?? [];
  const changeMonth = (value: string) => {
    setSelected(value); setConfirmPayroll(false); setAuthorizationComment("");
    setSubmissionId(crypto.randomUUID()); setActionError(""); setNotice("");
  };
  const payrollNotice = data?.payrollNotice;
  const content = <div className="monthly-reports-content">
    {(error || actionError) && <WorkspaceNotice tone="error" role="alert" actions={error ? <Button onClick={() => void refresh()}>Повторить загрузку</Button> : undefined}>{actionError || error}</WorkspaceNotice>}
    {notice && <WorkspaceNotice tone="success" role="status">{notice}</WorkspaceNotice>}
    {loading && <Spinner label="Загрузка ежемесячных отчётов" />}
    <div className="monthly-reports-toolbar">
      <Button disabled={busy} onClick={() => void run(() => downloadMonthlyTemplate(token))}>Скачать шаблон отчёта</Button>
      <Button disabled={busy} onClick={() => void refresh()}>Обновить</Button>
    </div>
    {payrollNotice && <section className="monthly-reports-payroll" aria-label="Разрешение на начисление зарплаты">
      <h3>Разрешено начисление ЗП · {monthlyLabel(payrollNotice.month)}</h3>
      <p>{payrollNotice.authorizedByName} · {payrollNotice.authorizedAt ? new Date(payrollNotice.authorizedAt).toLocaleString("ru-RU") : ""}</p>
      {payrollNotice.comment && <p>{payrollNotice.comment}</p>}
      <Button disabled={busy} onClick={() => void run(async () => {
        if (data?.payrollNoticeId) await markWorkspaceNotificationRead(token, data.payrollNoticeId);
        await refresh(); setNotice("Получение разрешения подтверждено.");
      })}>Подтвердить получение</Button>
    </section>}
    <Field label={{ children: "Отчётный месяц", htmlFor: `${id}-month` }}>
      <select id={`${id}-month`} value={month} disabled={busy} onChange={event => changeMonth(event.target.value)}>
        {!data?.cycles.length && <option value="">Сбор отчётов ещё не открыт</option>}
        {data?.cycles.map(item => <option key={item.month} value={item.month}>{monthlyLabel(item.month)}</option>)}
      </select>
    </Field>
    {cycle && <>
      <p className="monthly-reports-caption">Сбор начинается 20-го. Напоминание за три рабочих дня до конца месяца: {new Date(`${cycle.reminderOn}T12:00:00Z`).toLocaleDateString("ru-RU")}. В начале следующего месяца показывается отчёт за предыдущий.</p>
      {cycle.authorizedAt ? <WorkspaceNotice tone="success">Начисление заработной платы разрешено · {cycle.authorizedByName}. Отчёты за этот месяц закрыты для изменений.{cycle.comment && ` Комментарий: ${cycle.comment}`}</WorkspaceNotice> : cycle.canSubmit ? <section className="monthly-reports-upload" aria-label="Отправка ежемесячного отчёта">
        <h3>{history.length ? "Загрузить новую версию своего отчёта" : "Загрузите и отправьте ежемесячный отчёт"}</h3>
        <Field label={{ children: "Файлы отчёта", htmlFor: `${id}-files` }} hint="До 5 файлов. Каждый до 25 МБ, вместе до 50 МБ.">
          <input id={`${id}-files`} className="monthly-reports-file-input" ref={fileInput} type="file" multiple tabIndex={-1} disabled={busy} onChange={event => { setFiles(Array.from(event.target.files ?? [])); setSubmissionId(crypto.randomUUID()); }} />
          <Button disabled={busy} onClick={() => fileInput.current?.click()}>Прикрепить файлы отчёта</Button>
        </Field>
        {files.length > 0 && <ul>{files.map((file, index) => <li key={`${index}:${file.name}`}>{file.name} · {Math.ceil(file.size / 1024)} КБ</li>)}</ul>}
        <Field label="Комментарий к отчёту (необязательно)"><Textarea value={comment} maxLength={4000} disabled={busy} onChange={(_, value) => { setComment(value.value); setSubmissionId(crypto.randomUUID()); }} /></Field>
        <Button appearance="primary" disabled={busy || !files.length} onClick={() => void upload()}>{busy ? "Отправляем…" : "Отправить отчёт"}</Button>
      </section> : <p>Отправка отчёта за этот месяц недоступна для вашей учётной записи.</p>}
      {data?.canReview && <section aria-label="Сдача отчётов сотрудниками ЦА">
        <h3>Центральный аппарат · сдали {cycle.submitted} из {cycle.total}</h3>
        <p>Не сдали: {cycle.total - cycle.submitted}. Состав зафиксирован для этого месяца.</p>
        <div className="monthly-reports-roster">
          {cycle.members.map(member => <article className="monthly-reports-person" key={member.userId}>
            <div className="monthly-reports-person-identity"><EmployeeAvatar name={member.name} size={32} aria-hidden /><div><strong>{member.name}</strong><small>{member.department}</small></div></div>
            <div><span>{member.report ? `Сдан · ${new Date(member.report.submittedAt).toLocaleString("ru-RU")} · версия ${member.report.revision}` : "Не сдан"}</span>
              {member.report?.files.map(file => <Button key={file.id} size="small" disabled={busy} onClick={() => member.report && void download(member.report, file)}>{file.name}</Button>)}
              {member.report?.comment && <p>{member.report.comment}</p>}
            </div>
          </article>)}
          {!cycle.members.length && <p>Сотрудников ЦА в этом отчётном месяце нет.</p>}
        </div>
        {data.canAuthorize && !cycle.authorizedAt && <div className="monthly-reports-authorization">
          <h3>Разрешение на начисление заработной платы</h3>
          <Field label="Комментарий к разрешению (необязательно)"><Textarea maxLength={4000} value={authorizationComment} disabled={busy} onChange={(_, value) => setAuthorizationComment(value.value)} /></Field>
          {!confirmPayroll ? <Button disabled={busy} onClick={() => setConfirmPayroll(true)}>Разрешить начисление заработной платы</Button> : <WorkspaceNotice tone="warning" actions={<><Button appearance="primary" disabled={busy} onClick={() => void run(async () => {
            await authorizeMonthlyPayroll(token, month, authorizationComment);
            setConfirmPayroll(false); await refresh(); setNotice("Разрешение сохранено. Главному бухгалтеру отправлено уведомление.");
          })}>Подтвердить разрешение за {monthlyLabel(month)}</Button><Button disabled={busy} onClick={() => setConfirmPayroll(false)}>Отмена</Button></>}>
            Сдали {cycle.submitted} из {cycle.total}. После разрешения изменение отчётов закроется.
          </WorkspaceNotice>}
        </div>}
      </section>}
      <section aria-label="История моих отчётов"><h3>Мои отчёты за {monthlyLabel(month)}</h3>
        {!history.length && <p>Вы ещё не отправили отчёт за этот месяц.</p>}
        {history.map(report => <article className="monthly-reports-history" key={report.id}>
          <strong>Версия {report.revision} · {new Date(report.submittedAt).toLocaleString("ru-RU")}</strong>
          {report.comment && <p>{report.comment}</p>}
          {report.files.map(file => <Button disabled={busy} key={file.id} onClick={() => void download(report, file)}>{file.name}</Button>)}
        </article>)}
      </section>
    </>}
    {data?.canConfigure && <MonthlyCalendar token={token} onSaved={refresh} />}
  </div>;
  if (onClose) return <WorkspaceDialog open={Boolean(open)} onAfterClose={() => onAfterClose?.(surface.current)} onOpenChange={(_, value) => { if (!value.open && !busy) onClose(); }} onAfterOpen={() => focusWorkspaceDialog(surface.current)}>
    <DialogSurface ref={surface} className="monthly-reports-dialog"><DialogBody>
      <DialogTitle action={<Button disabled={busy} onClick={onClose}>Закрыть</Button>}>Ойлик ҳисоботлар</DialogTitle>
      <DialogContent>{content}</DialogContent>
      <DialogActions><Button disabled={busy} onClick={onClose}>Вернуться в рабочее пространство</Button></DialogActions>
    </DialogBody></DialogSurface>
  </WorkspaceDialog>;
  return <section className="monthly-reports-page"><WorkspaceSectionHeader motif="tasks"><div><span className="eyebrow">ИИ-модули · Центральный аппарат</span><h1>Ойлик ҳисоботлар</h1><p>Результаты месяца и разрешение на начисление заработной платы</p></div></WorkspaceSectionHeader>{content}</section>;
}

function MonthlyCalendar({ token, onSaved }: { readonly token: string; readonly onSaved: () => Promise<void> }) {
  const [days, setDays] = useState<readonly MonthlyCalendarDay[]>([]);
  const [day, setDay] = useState(""); const [note, setNote] = useState(""); const [working, setWorking] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { let active = true; void loadMonthlyCalendar(token).then(value => { if (active) setDays(value); }).catch(() => { if (active) setError("Не удалось загрузить рабочий календарь"); }); return () => { active = false; }; }, [token]);
  return <details className="monthly-reports-calendar"><summary>Рабочий календарь · праздники и переносы</summary>
    <p>По умолчанию рабочие дни — понедельник–пятница. Укажите исключения для календаря организации.</p>
    {error && <WorkspaceNotice tone="error" role="alert">{error}</WorkspaceNotice>}
    <Field label="Дата исключения"><Input type="date" value={day} disabled={busy} onChange={(_, v) => setDay(v.value)} /></Field>
    <Checkbox label="Рабочий день" checked={working} disabled={busy} onChange={(_, v) => setWorking(v.checked === true)} />
    <Field label="Причина или название праздника"><Input value={note} maxLength={300} disabled={busy} onChange={(_, v) => setNote(v.value)} /></Field>
    <Button disabled={busy || !day || !note.trim()} onClick={() => { setBusy(true); setError(""); void saveMonthlyCalendar(token, { day, note, working }).then(async () => { setDays(await loadMonthlyCalendar(token)); await onSaved(); setNote(""); }).catch(cause => setError(cause instanceof Error ? cause.message : "Не удалось сохранить дату")).finally(() => setBusy(false)); }}>Сохранить дату</Button>
    <ul>{days.map(item => <li key={item.day}>{item.day} · {item.working ? "Рабочий" : "Выходной"} · {item.note}</li>)}</ul>
  </details>;
}

export function MonthlyReportDashboard({ resource, onOpen }: { readonly resource: MonthlyReportsResource; readonly onOpen: (launcher?: HTMLElement) => void }) {
  const { data, error } = resource;
  if (!data?.dashboardVisible) return null;
  const cycle = data.cycles.find(item => item.month === data.activeMonth);
  return <button type="button" className="monthly-reports-metric" onClick={event => onOpen(event.currentTarget)}>
    <DocumentBulletList24Regular aria-hidden="true" /><div><strong>Ойлик ҳисоботлар · {data.activeMonth && monthlyLabel(data.activeMonth)}</strong><span>{error ? "Не удалось обновить · открыть и повторить" : cycle ? `Сдали ${cycle.submitted} · не сдали ${cycle.total - cycle.submitted} · всего ${cycle.total}` : "Загружаем статистику ЦА…"}</span></div>
    {cycle && <strong>{cycle.total ? Math.round(cycle.submitted / cycle.total * 100) : 0}%</strong>}
  </button>;
}

export function MonthlyReportPrompts({ resource, token, userId, paused, onOpen }: {
  readonly resource: MonthlyReportsResource; readonly token: string; readonly userId: string;
  readonly paused: boolean; readonly onOpen: () => void;
}) {
  const { data } = resource;
  const shown = useRef("");
  useEffect(() => {
    if (!data || paused) return;
    const reason = data.payrollNotice ? `payroll:${data.payrollNotice.month}` : data.reminderMonth ? `report:${data.reminderMonth}` : "";
    if (!reason) return;
    const key = `monthly-report-prompt:${getApiBaseUrl()}:${userId}:${data.today}:${reason}`;
    const show = () => {
      if (document.visibilityState === "hidden" || document.querySelector('[role="dialog"]') || shown.current === key) return;
      try { if (localStorage.getItem(key)) return; } catch { /* Session-only dismissal when storage is unavailable. */ }
      shown.current = key;
      try { localStorage.setItem(key, "shown"); } catch { /* Keep the in-memory mark. */ }
      onOpen();
    };
    const timer = window.setInterval(show, 2_000); show();
    return () => window.clearInterval(timer);
  }, [data, token, userId, paused, onOpen]);
  return null;
}
