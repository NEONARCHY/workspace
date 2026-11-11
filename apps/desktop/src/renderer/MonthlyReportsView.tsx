import { useEffect, useId, useRef, useState } from "react";
import type { MonthlyCalendarDay, MonthlyReport, MonthlyReportFile } from "@yuksalish/contracts";
import { Button, Checkbox, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Spinner, Textarea } from "@fluentui/react-components";
import {
  ArrowClockwise20Regular,
  ArrowDownload20Regular,
  Attach20Regular,
  CalendarLtr20Regular,
  CalendarLtr24Regular,
  ChevronDown20Regular,
  DocumentBulletList24Regular,
  History20Regular,
  PeopleTeam20Regular,
} from "@fluentui/react-icons";
import { WorkspaceDialog, focusWorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";
import { WorkspaceSelect } from "./WorkspaceSelect";
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
  const month = data?.cycles.find(item => item.month === selected)?.month
    || data?.activeMonth || data?.cycles[0]?.month || "";
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
  const toolbar = <div className="toolbar-actions monthly-reports-toolbar">
    <Button className={onClose ? undefined : "ws-section-header-primary"} icon={<ArrowDownload20Regular />} disabled={busy} onClick={() => void run(() => downloadMonthlyTemplate(token))}>
      Скачать шаблон отчёта
    </Button>
    <Button icon={<ArrowClockwise20Regular />} disabled={busy} onClick={() => void refresh()}>Обновить</Button>
  </div>;
  const calendar = data?.canConfigure ? <MonthlyCalendar token={token} onSaved={refresh} /> : null;

  const content = <div className="monthly-reports-content" aria-busy={loading}>
    {onClose && toolbar}
    {(error || actionError) && <WorkspaceNotice tone="error" role="alert" actions={error ? <Button onClick={() => void refresh()}>Повторить загрузку</Button> : undefined}>{actionError || error}</WorkspaceNotice>}
    {notice && <WorkspaceNotice tone="success" role="status">{notice}</WorkspaceNotice>}
    {loading && <div className="monthly-reports-panel monthly-reports-loading"><Spinner label="Загрузка ежемесячных отчётов" /></div>}
    {payrollNotice && <section className="monthly-reports-panel monthly-reports-payroll" aria-label="Разрешение на начисление зарплаты">
      <div>
        <h2>Разрешено начисление ЗП · {monthlyLabel(payrollNotice.month)}</h2>
        <p>{payrollNotice.authorizedByName}{payrollNotice.authorizedAt ? " · " + new Date(payrollNotice.authorizedAt).toLocaleString("ru-RU") : ""}</p>
        {payrollNotice.comment && <p>{payrollNotice.comment}</p>}
      </div>
      <Button disabled={busy} onClick={() => void run(async () => {
        if (data?.payrollNoticeId) await markWorkspaceNotificationRead(token, data.payrollNoticeId);
        await refresh(); setNotice("Получение разрешения подтверждено.");
      })}>Подтвердить получение</Button>
    </section>}
    <div className="monthly-reports-workspace">
      {data && !data.cycles.length && <section className="monthly-reports-panel monthly-reports-empty">
          <span className="monthly-reports-icon" aria-hidden="true"><CalendarLtr24Regular /></span>
          <div>
            <h2>Сбор отчётов ещё не открыт</h2>
            <p>Сбор начинается 20-го числа каждого месяца. До открытия можно скачать шаблон и подготовить отчёт.</p>
          </div>
      </section>}
      {cycle && <>
        <section className="monthly-reports-panel monthly-reports-period" aria-label="Отчётный период">
          <Field label="Отчётный месяц">
            <WorkspaceSelect aria-label="Отчётный месяц" value={month} disabled={busy} onChange={event => changeMonth(event.target.value)}>
              {data?.cycles.map(item => <option key={item.month} value={item.month}>{monthlyLabel(item.month)}</option>)}
            </WorkspaceSelect>
          </Field>
          <div className="monthly-reports-deadline">
            <span className="monthly-reports-icon" aria-hidden="true"><CalendarLtr20Regular /></span>
            <div><strong>Напоминание · {new Date(cycle.reminderOn + "T12:00:00Z").toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Asia/Tashkent" })}</strong>
              <p>За три рабочих дня до конца месяца</p></div>
          </div>
        </section>
        {cycle.authorizedAt && <WorkspaceNotice tone="success">Начисление заработной платы разрешено · {cycle.authorizedByName}. Отчёты за этот месяц закрыты для изменений.{cycle.comment && " Комментарий: " + cycle.comment}</WorkspaceNotice>}
        <div className="monthly-reports-work">
          {cycle.canSubmit && !cycle.authorizedAt && <section className="monthly-reports-panel monthly-reports-upload" aria-label="Отправка ежемесячного отчёта">
            <header className="monthly-reports-panel-heading">
              <span className="monthly-reports-icon" aria-hidden="true"><DocumentBulletList24Regular /></span>
              <h2>{history.length ? "Новая версия отчёта" : "Отправка отчёта"}</h2>
            </header>
            <div className="monthly-reports-attachments">
              <input id={id + "-files"} aria-label="Файлы отчёта" className="monthly-reports-file-input" ref={fileInput} type="file" multiple tabIndex={-1} disabled={busy} onChange={event => { setFiles(Array.from(event.target.files ?? [])); setSubmissionId(crypto.randomUUID()); }} />
              <Button icon={<Attach20Regular />} disabled={busy} onClick={() => fileInput.current?.click()}>Прикрепить файлы отчёта</Button>
              <p>До 5 файлов. Каждый до 25 МБ, вместе до 50 МБ.</p>
              {files.length > 0 && <ul>{files.map((file, index) => <li key={index + ":" + file.name}>{file.name} · {Math.ceil(file.size / 1024)} КБ</li>)}</ul>}
            </div>
            <Field label="Комментарий к отчёту (необязательно)"><Textarea value={comment} maxLength={4000} disabled={busy} onChange={(_, value) => { setComment(value.value); setSubmissionId(crypto.randomUUID()); }} /></Field>
            <Button className="monthly-reports-submit" appearance="primary" disabled={busy || !files.length} onClick={() => void upload()}>{busy ? "Отправляем…" : "Отправить отчёт"}</Button>
          </section>}
          <section className="monthly-reports-panel monthly-reports-own" aria-label="История моих отчётов">
            <header className="monthly-reports-panel-heading">
              <span className="monthly-reports-icon" aria-hidden="true"><History20Regular /></span>
              <h2>Мои отчёты</h2>
            </header>
            {!history.length && <p>Вы ещё не отправили отчёт за этот месяц.</p>}
            {!cycle.authorizedAt && !cycle.canSubmit && <p>Отправка отчёта за этот месяц недоступна для вашей учётной записи.</p>}
            {history.map(report => <article className="monthly-reports-history" key={report.id}>
              <strong>Версия {report.revision}</strong><time dateTime={report.submittedAt}>{new Date(report.submittedAt).toLocaleString("ru-RU")}</time>
              {report.comment && <p>{report.comment}</p>}
              <div className="monthly-reports-files">{report.files.map(file => <Button size="small" icon={<ArrowDownload20Regular />} disabled={busy} key={file.id} onClick={() => void download(report, file)}>{file.name}</Button>)}</div>
            </article>)}
          </section>
        </div>
        {data?.canReview && <section className="monthly-reports-panel monthly-reports-review" aria-label="Сдача отчётов сотрудниками ЦА">
          <header className="monthly-reports-review-heading">
            <div className="monthly-reports-panel-heading">
              <span className="monthly-reports-icon" aria-hidden="true"><PeopleTeam20Regular /></span>
              <h2>Отчёты сотрудников ЦА</h2>
            </div>
            <p className="monthly-reports-counts"><strong>Сдали {cycle.submitted} из {cycle.total}</strong><span>Не сдали {cycle.total - cycle.submitted}</span></p>
          </header>
          {cycle.members.length > 0 ? <ul className="monthly-reports-roster" aria-label="Сотрудники отчётного месяца" tabIndex={0}>
            {cycle.members.map(member => <li className="monthly-reports-person" key={member.userId}>
              <div className="monthly-reports-person-identity"><EmployeeAvatar name={member.name} size={32} aria-hidden /><div><strong>{member.name}</strong><small>{member.department}</small></div></div>
              <div className="monthly-reports-person-report">
                <div><span className="monthly-reports-person-status" data-submitted={Boolean(member.report)}>{member.report ? "Сдан" : "Не сдан"}</span>
                  {member.report && <small>{new Date(member.report.submittedAt).toLocaleString("ru-RU")} · версия {member.report.revision}</small>}</div>
                {member.report?.files.length ? <div className="monthly-reports-files">{member.report.files.map(file => <Button key={file.id} size="small" icon={<ArrowDownload20Regular />} disabled={busy} onClick={() => member.report && void download(member.report, file)}>{file.name}</Button>)}</div> : null}
                {member.report?.comment && <p>{member.report.comment}</p>}
              </div>
            </li>)}
          </ul> : <p>Сотрудников ЦА в этом отчётном месяце нет.</p>}
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
      </>}
      {calendar}
    </div>
  </div>;
  if (onClose) return <WorkspaceDialog open={Boolean(open)} onAfterClose={() => onAfterClose?.(surface.current)} onOpenChange={(_, value) => { if (!value.open && !busy) onClose(); }} onAfterOpen={() => focusWorkspaceDialog(surface.current)}>
    <DialogSurface ref={surface} className="monthly-reports-dialog"><DialogBody>
      <DialogTitle action={<Button disabled={busy} onClick={onClose}>Закрыть</Button>}>Ойлик ҳисоботлар</DialogTitle>
      <DialogContent>{content}</DialogContent>
      <DialogActions><Button disabled={busy} onClick={onClose}>Вернуться в рабочее пространство</Button></DialogActions>
    </DialogBody></DialogSurface>
  </WorkspaceDialog>;
  return <section className="workspace-view monthly-reports-page" aria-labelledby={id + "-title"}>
    <WorkspaceSectionHeader motif="calendar">
      <div>
        <span className="view-kicker">Центральный аппарат</span>
        <h1 id={id + "-title"}>Ойлик ҳисоботлар</h1>
        <p>Ежемесячные отчёты и разрешение на начисление зарплаты</p>
      </div>
      {toolbar}
    </WorkspaceSectionHeader>
    {content}
  </section>;
}

function MonthlyCalendar({ token, onSaved }: { readonly token: string; readonly onSaved: () => Promise<void> }) {
  const [days, setDays] = useState<readonly MonthlyCalendarDay[]>();
  const [day, setDay] = useState(""); const [note, setNote] = useState(""); const [working, setWorking] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { let active = true; void loadMonthlyCalendar(token).then(value => { if (active) setDays(value); }).catch(() => { if (active) setError("Не удалось загрузить рабочий календарь"); }); return () => { active = false; }; }, [token]);
  return <details className="monthly-reports-panel monthly-reports-calendar">
    <summary>
      <span className="monthly-reports-icon" aria-hidden="true"><CalendarLtr20Regular /></span>
      <span className="monthly-reports-calendar-title"><strong>Рабочий календарь</strong><small>Праздники и переносы</small></span>
      <ChevronDown20Regular className="monthly-reports-calendar-chevron" aria-hidden="true" />
    </summary>
    <div className="monthly-reports-calendar-body">
      <p>Рабочие дни по умолчанию — с понедельника по пятницу. Здесь можно задать исключения.</p>
      {error && <WorkspaceNotice tone="error" role="alert">{error}</WorkspaceNotice>}
      <div className="monthly-reports-calendar-fields">
        <Field label="Дата исключения"><Input type="date" value={day} disabled={busy} onChange={(_, v) => setDay(v.value)} /></Field>
        <Field label="Причина или название праздника"><Input value={note} maxLength={300} disabled={busy} onChange={(_, v) => setNote(v.value)} /></Field>
      </div>
      <Checkbox label="Рабочий день" checked={working} disabled={busy} onChange={(_, v) => setWorking(v.checked === true)} />
      <Button disabled={busy || !day || !note.trim()} onClick={() => { setBusy(true); setError(""); void saveMonthlyCalendar(token, { day, note, working }).then(async () => { setDays(await loadMonthlyCalendar(token)); await onSaved(); setNote(""); }).catch(cause => setError(cause instanceof Error ? cause.message : "Не удалось сохранить дату")).finally(() => setBusy(false)); }}>Сохранить дату</Button>
      {days?.length ? <ul className="monthly-reports-calendar-days">{days.map(item => <li key={item.day}><time dateTime={item.day}>{new Date(item.day + "T12:00:00Z").toLocaleDateString("ru-RU", { timeZone: "Asia/Tashkent" })}</time><strong>{item.working ? "Рабочий" : "Выходной"}</strong><span>{item.note}</span></li>)}</ul>
        : days && <p>Исключений пока нет.</p>}
      {!days && !error && <Spinner size="tiny" label="Загрузка календаря" />}
    </div>
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
