import { useEffect, useMemo, useState } from "react";

import type { EfficiencyOverview, EmployeeEfficiency } from "@yuksalish/contracts";
import { Avatar, Button, Input } from "@fluentui/react-components";
import { Dismiss24Regular, Search20Regular } from "@fluentui/react-icons";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { EmployeeProfileLink } from "./EmployeeProfileLink";

interface EfficiencyViewProps {
  readonly overview?: EfficiencyOverview;
  readonly loading: boolean;
  readonly error?: string;
  readonly onPeriodChange: (period: string) => void | Promise<void>;
}

const monthFormatter = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });

function monthLabel(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return monthFormatter.format(new Date(year!, month! - 1, 1));
}

function monthOptions(): readonly string[] {
  const today = new Date();
  return Array.from({ length: 12 }, (_, index) => {
    const value = new Date(today.getFullYear(), today.getMonth() - index, 1);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
  });
}

function percentageLabel(employee: EmployeeEfficiency): string {
  return employee.percentage == null ? "Нет данных" : `${employee.percentage.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function countLabel(value: number, forms: readonly [string, string, string]): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  const form = mod100 >= 11 && mod100 <= 14 ? forms[2] : mod10 === 1 ? forms[0] : mod10 >= 2 && mod10 <= 4 ? forms[1] : forms[2];
  return `${value.toLocaleString("ru-RU")} ${form}`;
}

type MetricTone = "success" | "danger" | "review" | "revision" | "neutral" | "excluded";

function Metric({ label, value, note, maximum, tone }: { readonly label: string; readonly value: number; readonly note?: string; readonly maximum: number; readonly tone: MetricTone }) {
  const fill = value === 0 ? 0 : Math.max(8, value / maximum * 100);
  return <div className={`eff-metric tone-${tone}`}>
    <div><span>{label}</span><strong>{value.toLocaleString("ru-RU")}</strong></div>
    {note ? <small>{note}</small> : <small>{countLabel(value, ["задача", "задачи", "задач"])}</small>}
    <div className="eff-metric-scale" aria-hidden="true"><span style={{ width: `${fill}%` }} /></div>
  </div>;
}

function ScoreGauge({ employee }: { readonly employee: EmployeeEfficiency }) {
  const score = Math.max(0, Math.min(100, employee.percentage ?? 0));
  const circumference = 2 * Math.PI * 67;
  const filled = circumference * score / 100;
  const hasData = employee.percentage != null;
  return <div className={`eff-score-gauge ${hasData ? "has-data" : "no-data"}`} role="img" aria-label={`Выполнение задач в срок: ${percentageLabel(employee)}; ${employee.onTimeCount} из ${employee.eligibleCount} задач`}>
    <svg viewBox="0 0 176 176" aria-hidden="true">
      <defs><filter id="eff-gauge-glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <circle className="eff-gauge-track" cx="88" cy="88" r="67" />
      <circle className="eff-gauge-progress" cx="88" cy="88" r="67" strokeDasharray={`${filled} ${circumference - filled}`} />
      {!hasData ? <circle className="eff-gauge-placeholder" cx="88" cy="88" r="67" strokeDasharray="3 9" /> : null}
    </svg>
    <div><strong>{hasData ? percentageLabel(employee) : "—"}</strong><span>{hasData ? `${employee.onTimeCount} из ${employee.eligibleCount} задач в срок` : "Нет данных"}</span></div>
  </div>;
}

function HistoryChart({ employee }: { readonly employee: EmployeeEfficiency }) {
  const points = employee.history.filter((point) => point.percentage != null);
  if (points.length < 2) return <div className="eff-history-empty">
    <div className="eff-empty-chart" aria-hidden="true"><i /><i /><i /><i /><i /></div>
    <div><strong>Нужно ещё немного истории</strong><span>Линия появится после двух месяцев с учитываемыми задачами.</span></div>
  </div>;

  const left = 48;
  const right = 618;
  const top = 18;
  const bottom = 164;
  const chartPoints = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? (left + right) / 2 : left + index * (right - left) / (points.length - 1),
    y: bottom - (point.percentage ?? 0) / 100 * (bottom - top),
  }));
  const polyline = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  return <>
    <div className="eff-history-chart" role="img" aria-label={`Динамика выполнения в срок: ${points.map((point) => `${monthLabel(point.period)} — ${point.percentage}%`).join("; ")}`}>
      <svg viewBox="0 0 640 210" aria-hidden="true">
        <defs><filter id="eff-line-glow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="4" result="line-blur" /><feMerge><feMergeNode in="line-blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        {[100, 75, 50, 25, 0].map((tick) => { const y = bottom - tick / 100 * (bottom - top); return <g key={tick}><line className="eff-chart-grid" x1={left} x2={right} y1={y} y2={y} /><text className="eff-chart-axis" x="4" y={y + 4}>{tick}%</text></g>; })}
        <polyline className="eff-chart-line" points={polyline} />
        {chartPoints.map((point) => <g key={point.period}>
          <circle className="eff-chart-dot-glow" cx={point.x} cy={point.y} r="8" />
          <circle className="eff-chart-dot" cx={point.x} cy={point.y} r="4" />
          <text className="eff-chart-value" x={point.x} y={Math.max(12, point.y - 12)} textAnchor="middle">{point.percentage}%</text>
          <text className="eff-chart-month" x={point.x} y="193" textAnchor="middle">{monthLabel(point.period).split(" ")[0]}</text>
        </g>)}
      </svg>
    </div>
    <ul className="eff-history-text">{points.map((point) => <li key={point.period}><span>{monthLabel(point.period)}</span><strong>{point.percentage}% · {point.onTimeCount} из {point.eligibleCount}</strong></li>)}</ul>
  </>;
}

function EmployeeSummary({ employee, title }: { readonly employee: EmployeeEfficiency; readonly title: string }) {
  const metrics = [
    { label: "Выполнено вовремя", value: employee.onTimeCount, tone: "success" as const },
    { label: "Просрочено", value: employee.overdueCount, tone: "danger" as const },
    { label: "Ожидает проверки", value: employee.awaitingReviewCount, tone: "review" as const },
    { label: "Возвращено на доработку", value: employee.returnedForRevisionCount, note: "не снижает процент", tone: "revision" as const },
    { label: "Без срока", value: employee.noDueDateCount, note: "не входит в расчёт", tone: "neutral" as const },
    { label: "Исключено", value: employee.excludedCount, note: "по подтверждённой причине", tone: "excluded" as const },
  ];
  const maximum = Math.max(1, ...metrics.map((metric) => metric.value));
  const contextTotal = metrics.reduce((sum, metric) => sum + metric.value, 0);
  return <article className="eff-summary" aria-label={`${title}: ${employee.name}`}>
    <div className="eff-summary-heading"><span className="eff-kicker">{title}</span><span className="eff-summary-period">{monthLabel(employee.period)}</span></div>
    <div className="eff-summary-lead">
      <ScoreGauge employee={employee} />
      <div className="eff-summary-copy">
        <EmployeeProfileLink userId={employee.userId} personName={employee.name} className="eff-person"><Avatar name={employee.name} size={40} /><div><h2>{employee.name}</h2><p>{employee.jobTitle}</p></div></EmployeeProfileLink>
        <h3>{employee.percentage == null ? "Пока нет задач, по которым можно рассчитать процент" : "Доля задач, переданных или выполненных в установленный срок"}</h3>
        <p>{employee.eligibleCount ? `В расчёт вошло: ${countLabel(employee.eligibleCount, ["задача", "задачи", "задач"])}. Вовремя выполнено: ${countLabel(employee.onTimeCount, ["задача", "задачи", "задач"])}.` : "Будущие задачи и задачи без срока не ухудшают результат. Показатель появится, когда наступит срок хотя бы одной учитываемой задачи."}</p>
        {employee.smallSample ? <div className="eff-sample-note">Выборка пока небольшая — интерпретируйте процент осторожно.</div> : null}
        {employee.historyCompleteness === "partial" ? <div className="eff-history-note">История месяца неполная: достоверный учёт начался в течение периода.</div> : null}
        {employee.historyCompleteness === "unavailable" ? <div className="eff-history-note">Для этого периода достоверной истории ещё нет.</div> : null}
      </div>
    </div>
    <section className="eff-composition" aria-label="Состав задач за период">
      <div className="eff-section-heading"><h3>Состав задач за период</h3><span>{countLabel(contextTotal, ["событие", "события", "событий"])} в сводке</span></div>
      <div className={`eff-composition-bar ${contextTotal ? "" : "is-empty"}`} aria-hidden="true">
        {metrics.filter((metric) => metric.value > 0).map((metric) => <span className={`tone-${metric.tone}`} key={metric.label} style={{ flexGrow: metric.value }} />)}
      </div>
    </section>
    <div className="eff-metrics" aria-label="Состав показателя">
      {metrics.map((metric) => <Metric {...metric} maximum={maximum} key={metric.label} />)}
    </div>
    <section className="eff-history" aria-label="История показателя">
      <div className="eff-section-heading"><h3>Динамика по месяцам</h3><span>шкала от 0 до 100%</span></div>
      <HistoryChart employee={employee} />
    </section>
    <p className="eff-caution">Показатель отражает только соблюдение сроков зарегистрированных задач и не является общей оценкой сотрудника.</p>
  </article>;
}

function DataCoverageCard({ overview }: { readonly overview: EfficiencyOverview }) {
  const withData = overview.employees.filter((employee) => employee.percentage != null).length;
  const partial = overview.employees.filter((employee) => employee.historyCompleteness === "partial").length;
  const coverage = overview.employees.length ? withData / overview.employees.length * 100 : 0;
  return <aside className="eff-coverage-card">
    <div className="eff-section-heading"><div><span className="eff-kicker">Объём данных</span><h2>Сводка команды</h2></div><strong>{withData}<small> / {overview.employees.length}</small></strong></div>
    <p>Сотрудников с задачами, которые уже можно корректно учесть за выбранный месяц.</p>
    <div className="eff-coverage-scale" aria-label={`Данные доступны для ${withData} из ${overview.employees.length} сотрудников`}><span style={{ width: `${coverage}%` }} /></div>
    <dl><div><dt>С расчётным процентом</dt><dd>{withData}</dd></div><div><dt>Неполная история месяца</dt><dd>{partial}</dd></div><div><dt>Без расчётных данных</dt><dd>{overview.employees.length - withData}</dd></div></dl>
  </aside>;
}

export function EfficiencyView({ overview, loading, error, onPeriodChange }: EfficiencyViewProps) {
  const [query, setQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState(overview?.currentUserId ?? "");
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    if (!helpOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelpOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [helpOpen]);
  const visibleEmployees = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("ru");
    return overview?.employees.filter((employee) => !search || `${employee.name} ${employee.jobTitle}`.toLocaleLowerCase("ru").includes(search)) ?? [];
  }, [overview, query]);
  const mine = overview?.employees.find((employee) => employee.userId === overview.currentUserId);
  const selected = overview?.employees.find((employee) => employee.userId === selectedUserId) ?? mine;

  if (loading && overview === undefined) return <div className="eff-loading" aria-live="polite"><span /><strong>Считаем показатель по журналу задач…</strong></div>;
  if (error && overview === undefined) return <div className="eff-error" role="alert"><strong>Не удалось загрузить эффективность</strong><span>{error}</span><Button onClick={() => void onPeriodChange(monthOptions()[0]!)}>Повторить</Button></div>;
  if (!overview || !mine) return <div className="eff-error"><strong>Данные пока недоступны</strong><span>Сервер не вернул агрегированную сводку.</span></div>;
  const activeEmployee = selected ?? mine;
  const activeTitle = activeEmployee.userId === mine.userId ? "Моя эффективность" : "Сводка сотрудника";

  return <div className="efficiency-view">
    <div className="eff-commandbar compact" aria-label="Настройки периода эффективности">
      <label className="eff-period-control"><span>Период</span><WorkspaceSelect aria-label="Период эффективности" value={overview.period} onChange={(event) => void onPeriodChange(event.target.value)}>{monthOptions().map((period) => <option key={period} value={period}>{monthLabel(period)}</option>)}</WorkspaceSelect></label>
      <Button className="eff-help-button" appearance="secondary" aria-haspopup="dialog" aria-expanded={helpOpen} onClick={() => setHelpOpen(true)}>?</Button>
    </div>
    {error ? <div className="eff-inline-error" role="status">Показаны последние загруженные данные. {error}</div> : null}
    <div className="eff-overview-grid">
      <EmployeeSummary employee={activeEmployee} title={activeTitle} />
      <div className="eff-context-stack">
        {activeEmployee.userId !== mine.userId ? <Button className="eff-back-to-mine" appearance="secondary" onClick={() => setSelectedUserId(mine.userId)}>Вернуться к моей сводке</Button> : null}
        <aside className="eff-method-card"><span className="eff-kicker">Методика {overview.methodologyVersion}</span><h2>Один показатель — один понятный смысл</h2><p>Все учитываемые задачи имеют одинаковый вес. Возвраты, комментарии и субъективные оценки не меняют процент.</p><dl><div><dt>Начало достоверного учёта</dt><dd>{new Date(overview.trackingStartedAt).toLocaleDateString("ru-RU")}</dd></div><div><dt>Часовой пояс</dt><dd>{overview.timezone}</dd></div><div><dt>Формула</dt><dd>Вовремя ÷ учтено</dd></div></dl><Button appearance="subtle" onClick={() => setHelpOpen(true)}>Открыть правила расчёта</Button></aside>
        <DataCoverageCard overview={overview} />
      </div>
    </div>

    <section className="eff-people" aria-label="Эффективность сотрудников">
      <div className="eff-people-heading"><div><h2>Сотрудники</h2><p>Нейтральная сортировка по имени. Это не рейтинг.</p></div><Input aria-label="Поиск сотрудников в эффективности" contentBefore={<Search20Regular />} placeholder="Имя или должность" value={query} onChange={(_, data) => setQuery(data.value)} /></div>
      <div className="eff-table-scroll" tabIndex={0} aria-label="Таблица прокручивается горизонтально">
        <table className="eff-table"><thead><tr><th>Сотрудник</th><th>Выполнение в срок</th><th>Вовремя / всего</th><th>Просрочено</th><th>Ожидает проверки</th><th>Возвраты</th><th>Без срока</th><th>Объём данных</th></tr></thead><tbody>{visibleEmployees.map((employee) => <tr key={employee.userId} className={activeEmployee.userId === employee.userId ? "selected" : ""} tabIndex={0} aria-label={`Открыть сводку: ${employee.name}`} onClick={() => setSelectedUserId(employee.userId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedUserId(employee.userId); } }}><td><EmployeeProfileLink userId={employee.userId} personName={employee.name} className="eff-table-person"><Avatar name={employee.name} size={32} /><span><strong>{employee.name}</strong><small>{employee.jobTitle}</small></span></EmployeeProfileLink></td><td><div className="eff-table-score"><strong>{percentageLabel(employee)}</strong>{employee.percentage != null ? <span aria-hidden="true"><i style={{ width: `${employee.percentage}%` }} /></span> : null}{employee.smallSample ? <small>мало данных</small> : null}</div></td><td>{employee.onTimeCount} / {employee.eligibleCount}</td><td>{employee.overdueCount}</td><td>{employee.awaitingReviewCount}</td><td>{employee.returnedForRevisionCount}</td><td>{employee.noDueDateCount}</td><td>{employee.sampleSize} задач</td></tr>)}</tbody></table>
      </div>
      {!visibleEmployees.length ? <div className="eff-table-empty">По вашему запросу сотрудники не найдены.</div> : null}
    </section>

    {helpOpen ? <div className="eff-help-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}>
      <aside className="eff-help" role="dialog" aria-modal="true" aria-labelledby="eff-help-title">
        <header><div><span className="eff-kicker">Методика {overview.methodologyVersion}</span><h2 id="eff-help-title">Как считается показатель</h2></div><button type="button" aria-label="Закрыть правила расчёта" autoFocus onClick={() => setHelpOpen(false)}><Dismiss24Regular /></button></header>
        <div className="eff-help-content">
          <section><h3>Как считается показатель</h3><p>Показатель «Выполнение задач в срок» показывает, какая доля ваших задач была выполнена вовремя.</p><p>Например, если в расчёт вошло 10 задач и 8 из них были выполнены в срок, ваш показатель составит <strong>80%</strong>.</p><p>Рядом с процентом всегда показывается количество задач, на основе которых он рассчитан.</p></section>
          <section><h3>Что считается выполнением в срок</h3><p>Если задача не требует проверки, учитывается её фактическое завершение.</p><p>Если задача должна быть передана руководителю или ответственному на проверку, для вас учитывается момент, когда вы отправили готовый результат на проверку.</p><p>Если вы передали результат вовремя, задержка проверки со стороны другого сотрудника не ухудшает ваш показатель.</p></section>
          <section><h3>Какие задачи входят в расчёт</h3><p>В расчёт попадают только задачи:</p><ul><li>назначенные вам;</li><li>имеющие срок;</li><li>срок которых уже наступил;</li><li>не исключённые из расчёта по подтверждённой причине.</li></ul><p>Будущие задачи заранее не считаются невыполненными.</p><p>Задачи без срока не уменьшают показатель и отображаются отдельно.</p><p>Если за выбранный период нет задач, которые можно корректно учесть, вместо процента показывается <strong>«Нет данных»</strong>.</p></section>
          <section><h3>Что происходит при переносе срока</h3><p>Если срок изменили до его наступления, задача оценивается по новому согласованному сроку.</p><p>Если срок уже был пропущен, последующий перенос не удаляет сам факт прошлой просрочки.</p><p>Поэтому важно согласовывать изменение срока заранее, если стало понятно, что выполнить задачу вовремя невозможно.</p></section>
          <section><h3>Что происходит при смене исполнителя</h3><p>Система учитывает, кто отвечал за задачу в соответствующий момент времени.</p><p>Просрочка предыдущего исполнителя не должна автоматически переходить на нового сотрудника только потому, что задача была позже переназначена.</p></section>
          <section><h3>Что означает «Возвращено на доработку»</h3><p>Возвраты на доработку показываются отдельно.</p><p>Они <strong>не уменьшают процент выполнения задач в срок</strong>.</p><p>Возврат учитывается только тогда, когда он оформлен как отдельный мотивированный возврат с причиной. Обычный комментарий или изменение статуса задачи само по себе возвратом не считается.</p></section>
          <section><h3>Какие задачи могут не учитываться</h3><p>Задача может быть исключена из расчёта, например, если:</p><ul><li>она отменена;</li><li>работа зависит от внешних обстоятельств;</li><li>требования существенно изменились;</li><li>задача оказалась дубликатом;</li><li>есть другая подтверждённая причина.</li></ul><p>Причина исключения должна быть зафиксирована в системе.</p></section>
          <section><h3>Почему старые данные могут быть неполными</h3><p>Система начинает надёжно учитывать историю задач только с момента внедрения механизма эффективности.</p><p>Мы не пытаемся угадывать прошлые даты завершения, переносы сроков или смены исполнителей по старым данным.</p><p>Поэтому для некоторых прошлых периодов может быть указано, что история неполная или данных недостаточно.</p><p className="eff-tracking-date">Начало достоверного учёта в системе: <strong>{new Date(overview.trackingStartedAt).toLocaleDateString("ru-RU")}</strong>.</p></section>
          <section><h3>Как улучшить результат</h3><p>В первую очередь помогают:</p><ul><li>реалистичные сроки;</li><li>своевременная передача готового результата;</li><li>раннее сообщение о препятствиях;</li><li>согласование переноса срока до его наступления;</li><li>фиксация внешних зависимостей;</li><li>понятный ожидаемый результат задачи.</li></ul></section>
          <section><h3>Чего лучше избегать</h3><p>Не стоит:</p><ul><li>оставлять задачи без понятного результата;</li><li>переносить сроки задним числом;</li><li>закрывать незавершённую работу только ради показателя;</li><li>отправлять на проверку неготовый результат;</li><li>искусственно дробить одну работу на множество мелких задач ради количества.</li></ul></section>
          <section className="eff-important"><h3>Важно</h3><p>Этот показатель отражает только <strong>соблюдение сроков зарегистрированных задач</strong>.</p><p>Он не является полной оценкой вашей работы, профессионализма, качества результатов или ценности для команды.</p><p>Сам по себе показатель не должен автоматически использоваться для штрафов, изменения зарплаты, увольнения, ограничения доступа или публичного присвоения сотруднику оценки вроде «хороший» или «плохой».</p></section>
        </div>
      </aside>
    </div> : null}
  </div>;
}
