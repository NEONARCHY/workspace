import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CalendarLtr24Regular, Clock24Regular, DocumentBulletList24Regular,
  Dismiss24Regular, DocumentPdf24Regular, History24Regular,
} from "@fluentui/react-icons";
import type { HisobotProfile, HisobotReport, HisobotUnitReport } from "@yuksalish/contracts";

import {
  loadHisobotHistory, loadHisobotProfile, loadHisobotReports, loadHisobotUnitHistory,
  loadHisobotUnitReports, saveHisobotReport, saveHisobotUnitReport,
} from "./workspace-api";

const dateLabel = (value: string) => value.split("-").reverse().join(".");
const errorText = (error: unknown) => error instanceof Error ? error.message : "Не удалось загрузить AI Hisobot.";

function ReportCard({ report }: { readonly report: HisobotReport }) {
  return <article className="hisobot-report-card">
    <div className="hisobot-report-topline">
      <span className="hisobot-report-date"><CalendarLtr24Regular /> {dateLabel(report.reportDate)}</span>
      <span className={`hisobot-source ${report.source}`}>{report.source === "telegram" ? "Telegram" : "Workspace"}</span>
    </div>
    <h3>{report.reportScope === "hudud" ? report.regionName ?? report.fullName : report.fullName}</h3>
    <p className="hisobot-report-byline">{report.reportScope === "hudud" ? `${report.fullName} · ` : ""}{report.position}</p>
    <p className="hisobot-report-content">{report.content}</p>
    <div className="hisobot-report-foot">Отправлено {new Date(report.submittedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" })}{report.isLate ? " · после 18:00" : ""}</div>
  </article>;
}

function UnitReportCard({ report }: { readonly report: HisobotUnitReport }) {
  return <article className="hisobot-report-card">
    <div className="hisobot-report-topline"><span className="hisobot-report-date"><CalendarLtr24Regular /> {dateLabel(report.reportDate)}</span><span className="hisobot-source">Отчёт отдела</span></div>
    <h3>{report.departmentName}</h3>
    <p className="hisobot-report-byline">Отправил: {report.reporterName} · {report.reporterPosition}</p>
    <p className="hisobot-report-content">{report.content}</p>
    <div className="hisobot-report-foot">Отправлено {new Date(report.submittedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" })}</div>
  </article>;
}

export function AIHisobotView({ token }: { readonly token: string }) {
  const [profile, setProfile] = useState<HisobotProfile>();
  const [history, setHistory] = useState<readonly HisobotReport[]>([]);
  const [unitHistory, setUnitHistory] = useState<readonly HisobotUnitReport[]>([]);
  const [historyFullyLoaded, setHistoryFullyLoaded] = useState(false);
  const [teamReports, setTeamReports] = useState<readonly HisobotReport[]>([]);
  const [teamUnitReports, setTeamUnitReports] = useState<readonly HisobotUnitReport[]>([]);
  const [tab, setTab] = useState<"today" | "history" | "team">("today");
  const [scope, setScope] = useState<"all" | "central" | "hudud">("all");
  const [query, setQuery] = useState("");
  const [content, setContent] = useState("");
  const [unitContent, setUnitContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [unitDirty, setUnitDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const helpCloseRef = useRef<HTMLButtonElement>(null);
  const [startDate, setStartDate] = useState(() => {
    const day = new Date(); day.setDate(day.getDate() - 6);
    return day.toLocaleDateString("sv-SE");
  });
  const [endDate, setEndDate] = useState(() => new Date().toLocaleDateString("sv-SE"));

  const refresh = useCallback(async () => {
    const [nextProfile, nextHistory, nextUnitHistory] = await Promise.all([
      loadHisobotProfile(token), loadHisobotHistory(token), loadHisobotUnitHistory(token),
    ]);
    setProfile(nextProfile);
    setHistory((current) => [...new Map([...current, ...nextHistory].map((item) => [item.id, item])).values()]
      .sort((left, right) => right.reportDate.localeCompare(left.reportDate)));
    setUnitHistory(nextUnitHistory);
    if (nextHistory.length < 100) setHistoryFullyLoaded(true);
    setContent((existing) => dirty ? existing : nextProfile.todayReport?.content ?? "");
    setUnitContent((existing) => unitDirty ? existing : (
      nextProfile.todayUnitReport?.reporterTelegramId === nextProfile.telegramId
        ? nextProfile.todayUnitReport.content : ""
    ));
  }, [token, dirty, unitDirty]);

  useEffect(() => {
    if (!helpOpen) return undefined;
    helpCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setHelpOpen(false); helpButtonRef.current?.focus(); }
      if (event.key === "Tab") { event.preventDefault(); helpCloseRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [helpOpen]);

  useEffect(() => {
    let active = true;
    const initial = window.setTimeout(() => {
      void refresh().catch((caught: unknown) => {
        if (active) setError(errorText(caught));
      }).finally(() => { if (active) setLoading(false); });
    }, 0);
    const timer = window.setInterval(() => {
      if (active) void refresh().catch(() => undefined);
    }, 30_000);
    return () => { active = false; window.clearTimeout(initial); window.clearInterval(timer); };
  }, [refresh]);

  const loadTeam = useCallback(async () => {
    setError("");
    try {
      const [reports, units] = await Promise.all([
        loadHisobotReports(token, startDate, endDate),
        loadHisobotUnitReports(token, startDate, endDate),
      ]);
      setTeamReports(reports); setTeamUnitReports(units);
    }
    catch (caught) { setError(errorText(caught)); }
  }, [token, startDate, endDate]);

  useEffect(() => {
    if (tab !== "team" || !profile?.managementAccess) return;
    const initial = window.setTimeout(() => { void loadTeam(); }, 0);
    return () => window.clearTimeout(initial);
  }, [tab, profile?.managementAccess, loadTeam]);

  const visibleTeam = useMemo(() => teamReports.filter((report) =>
    (scope === "all" || report.reportScope === scope) &&
    `${report.fullName} ${report.regionName ?? ""} ${report.position} ${report.content}`
      .toLocaleLowerCase("ru-RU").includes(query.toLocaleLowerCase("ru-RU")),
  ), [teamReports, scope, query]);
  const visibleTeamUnits = useMemo(() => teamUnitReports.filter((report) =>
    (scope === "all" || report.reportScope === scope) &&
    `${report.departmentName} ${report.reporterName} ${report.content}`
      .toLocaleLowerCase("ru-RU").includes(query.toLocaleLowerCase("ru-RU")),
  ), [teamUnitReports, scope, query]);
  const ownUnitReport = profile && profile.todayUnitReport?.reporterTelegramId === profile.telegramId
    ? profile.todayUnitReport : null;

  const save = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      await saveHisobotReport(token, content.trim());
      setDirty(false);
      await refresh();
      setNotice("Отчёт принят. Напоминания в Telegram и Workspace прекращены.");
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  };

  const saveUnit = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      await saveHisobotUnitReport(token, unitContent.trim());
      setUnitDirty(false);
      await refresh();
      setNotice("Отчёт отдела принят. У сотрудников, включённых в него, напоминания прекращены.");
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  };

  const loadOlder = async () => {
    const last = history.at(-1);
    if (!last) return;
    setBusy(true); setError("");
    try {
      const older = await loadHisobotHistory(token, last.reportDate);
      setHistory((current) => [...current, ...older]);
      if (older.length < 100) setHistoryFullyLoaded(true);
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  };

  return <section className="workspace-view ai-hisobot-view" aria-label="AI Hisobot">
    <header className="ai-hisobot-header">
      <div className="ai-hisobot-header-copy">
        <span className="view-kicker">Единая отчётность</span>
        <h1>AI Hisobot</h1>
        <p>Ежедневные отчёты, история и региональная сводка — в одном месте.</p>
      </div>
      <button ref={helpButtonRef} type="button" className="hisobot-help-button" aria-label="Правила AI Hisobot" aria-haspopup="dialog" aria-expanded={helpOpen} onClick={() => setHelpOpen(true)}>?</button>
      <div className="ai-hisobot-header-art" aria-hidden="true">
        <DocumentBulletList24Regular className="hisobot-art-main" />
        <DocumentPdf24Regular className="hisobot-art-pdf" />
        <History24Regular className="hisobot-art-history" />
      </div>
    </header>

    {loading ? <p className="hisobot-loading" role="status">Загружаем отчёты…</p> : null}
    {error ? <div className="hisobot-error" role="alert">{error}</div> : null}
    {profile ? <>
      <nav className="hisobot-tabs" aria-label="Разделы AI Hisobot">
        <button type="button" className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}>Сегодня</button>
        <button type="button" className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Моя история</button>
        {profile.managementAccess ? <button type="button" className={tab === "team" ? "active" : ""} onClick={() => setTab("team")}>Отчёты сотрудников</button> : null}
      </nav>

      {tab === "today" ? <div className="hisobot-today-layout">
        <div className="hisobot-panel hisobot-compose">
          <div className="hisobot-panel-heading"><span><DocumentBulletList24Regular /> Отчёт за {dateLabel(profile.today)}</span><strong>{profile.todayReport || ownUnitReport ? "Получен" : "Ожидается"}</strong></div>
          <p className="hisobot-panel-description">{profile.reportScope === "hudud" ? `${profile.regionName} · ` : "Центральный аппарат · "}{profile.fullName}</p>
          {profile.reportRequired && !ownUnitReport ? <>
            <label htmlFor="hisobot-report-text">{profile.todayReport ? "Чтобы исправить или дополнить, измените полный текст отчёта:" : "Опишите выполненные задачи одним текстовым сообщением:"}</label>
            <textarea id="hisobot-report-text" value={content} onChange={(event) => { setContent(event.target.value); setDirty(true); }} disabled={!profile.canSubmit || busy} placeholder={"1. Текст первой выполненной задачи.\n2. Текст второй выполненной задачи.\n3. Текст третьей выполненной задачи."} />
            <div className="hisobot-compose-footer"><span>{content.trim().length} символов</span><button type="button" onClick={() => void save()} disabled={!profile.canSubmit || busy || content.trim().length < 3 || content.length > 20_000 || !dirty}>{busy ? "Сохраняем…" : profile.todayReport ? "Сохранить изменения" : "Отправить отчёт"}</button></div>
            {notice ? <p className="hisobot-success" role="status">{notice}</p> : null}
          </> : !profile.reportRequired && !ownUnitReport ? <p className="hisobot-exempt">Для вас сдача ежедневного отчёта не обязательна. История и доступные сводки остаются в меню.</p> : null}
          {profile.unit?.isLead && !profile.todayReport ? <section className="hisobot-unit-compose" aria-label="Отчёт от лица отдела или подразделения">
            <div className="hisobot-panel-heading"><span><DocumentBulletList24Regular /> {profile.reportScope === "hudud" ? "Отчёт от лица подразделения" : "Отчёт от лица отдела"}</span><strong>{ownUnitReport ? "Получен" : "Ожидается"}</strong></div>
            <p className="hisobot-panel-description">{profile.unit.name} · это ваш единственный отчёт за день, он засчитывается всей команде.</p>
            <label htmlFor="hisobot-unit-report-text">{ownUnitReport ? "Чтобы исправить отчёт команды, измените его полный текст:" : "Опишите выполненные командой задачи:"}</label>
            <textarea id="hisobot-unit-report-text" value={unitContent} onChange={(event) => { setUnitContent(event.target.value); setUnitDirty(true); }} disabled={!profile.canSubmitUnit || busy} placeholder={"1. Первая выполненная задача команды.\n2. Вторая выполненная задача команды."} />
            <div className="hisobot-compose-footer"><span>{unitContent.trim().length} символов</span><button type="button" onClick={() => void saveUnit()} disabled={!profile.canSubmitUnit || busy || unitContent.trim().length < 3 || unitContent.length > 20_000 || !unitDirty}>{busy ? "Сохраняем…" : ownUnitReport ? "Сохранить отчёт команды" : profile.reportScope === "hudud" ? "Отправить отчёт от лица подразделения" : "Отправить отчёт от лица отдела"}</button></div>
          </section> : null}
        </div>
        <aside className="hisobot-panel hisobot-status">
          <span className="hisobot-status-icon"><Clock24Regular /></span>
          <h2>{profile.absenceKind ? ({ vacation: "Вы в отпуске", sick_leave: "Вы на больничном", personal_time: "У вас отгул" })[profile.absenceKind] : profile.coveredByReport || profile.todayReport ? "Отчёт учтён" : profile.canSubmit ? "Можно отправить отчёт" : "Приём закрыт"}</h2>
          <p>{profile.absenceKind ? "На время подтверждённого отсутствия отчёт не обязателен и напоминания отключены. Если вы всё же работали, отчёт можно отправить — в PDF будет отметка о работе во время отсутствия." : ownUnitReport ? "Ваш отчёт от лица команды получен. До закрытия приёма его можно отредактировать, но второй отчёт за этот день отправить нельзя." : profile.todayReport ? "Ваш личный отчёт получен. До закрытия приёма его можно отредактировать, но второй отчёт от лица команды отправить нельзя." : profile.coveredByReport ? "За вашу команду уже предоставлен отчёт. При желании вы можете отправить свой личный отчёт." : profile.canSubmit ? "После отправки напоминания в обоих каналах прекратятся." : "Отчёты принимаются по будням с 12:00 до 18:30. Следующий отчёт можно отправить в следующий рабочий день с 12:00."}</p>
          <div className="hisobot-window"><span>Приём</span><strong>12:00—18:30</strong></div>
          <div className="hisobot-window"><span>Дедлайн</span><strong>18:30</strong></div>
        </aside>
      </div> : null}

      {tab === "history" ? <div className="hisobot-list-page">
        <div className="hisobot-list-heading"><h2>Мои отчёты</h2><span>{history.length + unitHistory.length} записей</span></div>
        {history.length || unitHistory.length ? <div className="hisobot-report-grid">{history.map((report) => <ReportCard key={report.id} report={report} />)}{unitHistory.map((report) => <UnitReportCard key={report.id} report={report} />)}</div> : <p className="hisobot-empty">История пока пуста. Старые текстовые отчёты появятся здесь после синхронизации бота.</p>}
        {!historyFullyLoaded && history.length >= 100 ? <button type="button" className="hisobot-load-more" onClick={() => void loadOlder()} disabled={busy}>Показать более ранние отчёты</button> : null}
      </div> : null}

      {tab === "team" && profile.managementAccess ? <div className="hisobot-list-page">
        <div className="hisobot-list-heading"><h2>Отчёты сотрудников</h2><span>{visibleTeam.length + visibleTeamUnits.length} записей</span></div>
        <div className="hisobot-filters">
          <label>С&nbsp;<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label>По&nbsp;<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} aria-label="Контур отчётности"><option value="all">Все подразделения</option><option value="central">Центральный аппарат</option><option value="hudud">Hudud</option></select>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по региону, имени или тексту" aria-label="Поиск отчётов" />
          <button type="button" onClick={() => void loadTeam()}>Обновить</button>
        </div>
        {visibleTeam.length || visibleTeamUnits.length ? <div className="hisobot-report-grid">{visibleTeam.map((report) => <ReportCard key={report.id} report={report} />)}{visibleTeamUnits.map((report) => <UnitReportCard key={report.id} report={report} />)}</div> : <p className="hisobot-empty">За выбранный период отчётов нет.</p>}
      </div> : null}
    </> : null}
    {helpOpen ? <div className="hisobot-help-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setHelpOpen(false); helpButtonRef.current?.focus(); } }}>
      <aside className="hisobot-help" role="dialog" aria-modal="true" aria-labelledby="hisobot-help-title">
        <header><div><span className="view-kicker">Правила отчётности</span><h2 id="hisobot-help-title">Как учитываются отчёты</h2></div><button ref={helpCloseRef} type="button" aria-label="Закрыть правила AI Hisobot" onClick={() => { setHelpOpen(false); helpButtonRef.current?.focus(); }}><Dismiss24Regular /></button></header>
        <div className="hisobot-help-content">
          <section><h3>Личный отчёт</h3><p>Каждый сотрудник может отправить описание своей работы в AI Hisobot или Telegram-боте. Текст остаётся в личной истории и учитывается при подготовке итогового PDF.</p></section>
          <section><h3>Отдел центрального аппарата</h3><p>Администратор, кадровик или руководитель назначает главное лицо среди сотрудников отдела. Только у него появляется действие «Отправить отчёт от лица отдела».</p><p>Такой отчёт заменяет личный отчёт отправителя и закрывает обязанность всех сотрудников отдела на этот день. Если сотрудник отправил только личный отчёт, он засчитывается только ему; остальные продолжают получать напоминания.</p></section>
          <section><h3>Региональное подразделение</h3><p>Для регионального подразделения отчёт может отправить любой сотрудник. Его обычный личный отчёт уже считается отчётом за всё подразделение: остальные сотрудники не попадают в список не сдавших и больше не получают напоминания за этот день.</p><p>Назначенное главное лицо также может выбрать «Отправить отчёт от лица подразделения». Это его единственный отчёт за день, а не дополнительный.</p></section>
          <section><h3>Сроки и изменения</h3><p>Отчёты принимаются по рабочим дням с 12:00 до 18:30. До закрытия приёма свой текст можно исправить. После 18:30 отчёты за этот день не принимаются.</p><p>В Telegram можно просто отправить текст в чат: бот спросит, как его засчитать, и сохранит отчёт только после подтверждения. Исходное сообщение останется в чате.</p><p>Если сотрудник находится в утверждённом отпуске, на больничном или в отгуле, напоминания на соответствующий период отключаются. При желании он всё равно может отправить отчёт.</p></section>
          <section><h3>Где искать старые отчёты</h3><p>Личные и отправленные от лица команды тексты доступны в истории. Руководители с отдельным правом просмотра видят отчёты сотрудников и команд за выбранный период.</p></section>
        </div>
      </aside>
    </div> : null}
  </section>;
}
