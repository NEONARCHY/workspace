import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CalendarClock24Regular, CalendarLtr24Regular, Clock24Regular,
  DataBarVertical24Regular, DocumentBulletList24Regular, DocumentPdf24Regular,
  Globe24Regular, History24Regular, PeopleTeam24Regular,
} from "@fluentui/react-icons";
import type { HisobotProfile, HisobotReport } from "@yuksalish/contracts";

import {
  loadHisobotHistory, loadHisobotProfile, loadHisobotReports, saveHisobotReport,
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

export function AIHisobotView({ token }: { readonly token: string }) {
  const [profile, setProfile] = useState<HisobotProfile>();
  const [history, setHistory] = useState<readonly HisobotReport[]>([]);
  const [historyFullyLoaded, setHistoryFullyLoaded] = useState(false);
  const [teamReports, setTeamReports] = useState<readonly HisobotReport[]>([]);
  const [tab, setTab] = useState<"today" | "history" | "team">("today");
  const [scope, setScope] = useState<"all" | "central" | "hudud">("all");
  const [query, setQuery] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [startDate, setStartDate] = useState(() => {
    const day = new Date(); day.setDate(day.getDate() - 6);
    return day.toLocaleDateString("sv-SE");
  });
  const [endDate, setEndDate] = useState(() => new Date().toLocaleDateString("sv-SE"));

  const refresh = useCallback(async () => {
    const [nextProfile, nextHistory] = await Promise.all([
      loadHisobotProfile(token), loadHisobotHistory(token),
    ]);
    setProfile(nextProfile);
    setHistory((current) => [...new Map([...current, ...nextHistory].map((item) => [item.id, item])).values()]
      .sort((left, right) => right.reportDate.localeCompare(left.reportDate)));
    if (nextHistory.length < 100) setHistoryFullyLoaded(true);
    setContent((existing) => dirty ? existing : nextProfile.todayReport?.content ?? "");
  }, [token, dirty]);

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
    try { setTeamReports(await loadHisobotReports(token, startDate, endDate)); }
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
      <div className="ai-hisobot-header-art" aria-hidden="true">
        <DocumentBulletList24Regular className="hisobot-art-main" />
        <DocumentPdf24Regular className="hisobot-art-pdf" />
        <History24Regular className="hisobot-art-history" />
        <DataBarVertical24Regular className="hisobot-art-chart" />
        <PeopleTeam24Regular className="hisobot-art-team" />
        <Globe24Regular className="hisobot-art-region" />
        <CalendarClock24Regular className="hisobot-art-calendar" />
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
          <div className="hisobot-panel-heading"><span><DocumentBulletList24Regular /> Отчёт за {dateLabel(profile.today)}</span><strong>{profile.todayReport ? "Получен" : "Ожидается"}</strong></div>
          <p className="hisobot-panel-description">{profile.reportScope === "hudud" ? `${profile.regionName} · ` : "Центральный аппарат · "}{profile.fullName}</p>
          {profile.reportRequired ? <>
            <label htmlFor="hisobot-report-text">{profile.todayReport ? "Чтобы исправить или дополнить, измените полный текст отчёта:" : "Опишите выполненные задачи одним текстовым сообщением:"}</label>
            <textarea id="hisobot-report-text" value={content} onChange={(event) => { setContent(event.target.value); setDirty(true); }} disabled={!profile.canSubmit || busy} placeholder={"1. Текст первой выполненной задачи.\n2. Текст второй выполненной задачи.\n3. Текст третьей выполненной задачи."} />
            <div className="hisobot-compose-footer"><span>{content.trim().length} символов</span><button type="button" onClick={() => void save()} disabled={!profile.canSubmit || busy || content.trim().length < 3 || content.length > 20_000 || !dirty}>{busy ? "Сохраняем…" : profile.todayReport ? "Сохранить изменения" : "Отправить отчёт"}</button></div>
            {notice ? <p className="hisobot-success" role="status">{notice}</p> : null}
          </> : <p className="hisobot-exempt">Для вас сдача ежедневного отчёта не обязательна. История и доступные сводки остаются в меню.</p>}
        </div>
        <aside className="hisobot-panel hisobot-status">
          <span className="hisobot-status-icon"><Clock24Regular /></span>
          <h2>{profile.absenceKind ? ({ vacation: "Вы в отпуске", sick_leave: "Вы на больничном", personal_time: "У вас отгул" })[profile.absenceKind] : profile.todayReport ? "Отчёт получен" : profile.canSubmit ? "Можно отправить отчёт" : "Приём закрыт"}</h2>
          <p>{profile.absenceKind ? "На время подтверждённого отсутствия отчёт не обязателен и напоминания отключены. Если вы всё же работали, отчёт можно отправить — в PDF будет отметка о работе во время отсутствия." : profile.todayReport ? "Отправленное через Telegram тоже появится здесь. До закрытия приёма отчёт можно отредактировать в любом канале." : profile.canSubmit ? "После отправки напоминания в обоих каналах прекратятся." : "Отчёты принимаются по будням с 12:00 до 18:30. Следующий отчёт можно отправить в следующий рабочий день с 12:00."}</p>
          <div className="hisobot-window"><span>Приём</span><strong>12:00—18:30</strong></div>
          <div className="hisobot-window"><span>Дедлайн</span><strong>18:30</strong></div>
        </aside>
      </div> : null}

      {tab === "history" ? <div className="hisobot-list-page">
        <div className="hisobot-list-heading"><h2>Мои отчёты</h2><span>{history.length} записей</span></div>
        {history.length ? <div className="hisobot-report-grid">{history.map((report) => <ReportCard key={report.id} report={report} />)}</div> : <p className="hisobot-empty">История пока пуста. Старые текстовые отчёты появятся здесь после синхронизации бота.</p>}
        {!historyFullyLoaded && history.length >= 100 ? <button type="button" className="hisobot-load-more" onClick={() => void loadOlder()} disabled={busy}>Показать более ранние отчёты</button> : null}
      </div> : null}

      {tab === "team" && profile.managementAccess ? <div className="hisobot-list-page">
        <div className="hisobot-list-heading"><h2>Отчёты сотрудников</h2><span>{visibleTeam.length} записей</span></div>
        <div className="hisobot-filters">
          <label>С&nbsp;<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label>По&nbsp;<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} aria-label="Контур отчётности"><option value="all">Все подразделения</option><option value="central">Центральный аппарат</option><option value="hudud">Hudud</option></select>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по региону, имени или тексту" aria-label="Поиск отчётов" />
          <button type="button" onClick={() => void loadTeam()}>Обновить</button>
        </div>
        {visibleTeam.length ? <div className="hisobot-report-grid">{visibleTeam.map((report) => <ReportCard key={report.id} report={report} />)}</div> : <p className="hisobot-empty">За выбранный период отчётов нет.</p>}
      </div> : null}
    </> : null}
  </section>;
}
