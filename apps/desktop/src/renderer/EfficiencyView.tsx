import { useEffect, useMemo, useState } from "react";

import type { EfficiencyOverview, EmployeeEfficiency } from "@yuksalish/contracts";
import { Avatar, Button, Input } from "@fluentui/react-components";
import { Dismiss24Regular, Search20Regular } from "@fluentui/react-icons";

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

function Metric({ label, value, note }: { readonly label: string; readonly value: number; readonly note?: string }) {
  return <div className="eff-metric"><span>{label}</span><strong>{value.toLocaleString("ru-RU")}</strong>{note ? <small>{note}</small> : null}</div>;
}

function EmployeeSummary({ employee, title }: { readonly employee: EmployeeEfficiency; readonly title: string }) {
  const realHistory = employee.history.filter((point) => point.percentage != null);
  return <article className="eff-summary" aria-label={`${title}: ${employee.name}`}>
    <div className="eff-summary-heading">
      <div><span className="eff-kicker">{title}</span><h2>{employee.name}</h2><p>{employee.jobTitle}</p></div>
      <div className="eff-score" aria-label={`Выполнение задач в срок: ${percentageLabel(employee)}; ${employee.onTimeCount} из ${employee.eligibleCount} задач`}>
        <strong>{percentageLabel(employee)}</strong>
        <span>{employee.eligibleCount ? `${employee.onTimeCount} из ${employee.eligibleCount} задач` : "учитываемых задач нет"}</span>
      </div>
    </div>
    {employee.smallSample ? <div className="eff-sample-note">Мало данных для устойчивого вывода</div> : null}
    {employee.historyCompleteness === "partial" ? <div className="eff-history-note">История за этот месяц неполная: надёжный учёт начался в течение периода.</div> : null}
    {employee.historyCompleteness === "unavailable" ? <div className="eff-history-note">Для этого периода достоверной истории ещё нет.</div> : null}
    <div className="eff-metrics" aria-label="Состав показателя">
      <Metric label="Выполнено вовремя" value={employee.onTimeCount} />
      <Metric label="Просрочено" value={employee.overdueCount} />
      <Metric label="Ожидает проверки" value={employee.awaitingReviewCount} />
      <Metric label="Возвращено на доработку" value={employee.returnedForRevisionCount} note="не снижает процент" />
      <Metric label="Без срока" value={employee.noDueDateCount} note="не входит в расчёт" />
      <Metric label="Исключено" value={employee.excludedCount} note="по подтверждённой причине" />
    </div>
    <p className="eff-caution">Показатель отражает соблюдение сроков зарегистрированных задач и не является общей оценкой сотрудника.</p>
    <section className="eff-history" aria-label="История показателя">
      <div className="eff-section-heading"><h3>Динамика</h3><span>только по зафиксированным данным</span></div>
      {realHistory.length >= 2 ? <>
        <div className="eff-history-chart" role="img" aria-label={`Динамика выполнения в срок: ${realHistory.map((point) => `${monthLabel(point.period)} — ${point.percentage}%`).join("; ")}`}>
          {realHistory.map((point) => <div className="eff-history-bar" key={point.period}>
            <span style={{ height: `${Math.max(3, point.percentage ?? 0)}%` }} />
            <small>{monthLabel(point.period).split(" ")[0]}</small>
          </div>)}
        </div>
        <ul className="eff-history-text">{realHistory.map((point) => <li key={point.period}><span>{monthLabel(point.period)}</span><strong>{point.percentage}% · {point.onTimeCount} из {point.eligibleCount}</strong></li>)}</ul>
      </> : <div className="eff-history-empty"><strong>Недостаточно исторических данных</strong><span>График появится после двух месяцев с учитываемыми задачами.</span></div>}
    </section>
  </article>;
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

  return <div className="efficiency-view">
    <div className="eff-commandbar">
      <div><strong>Выполнение задач в срок</strong><span>Календарный месяц · Asia/Tashkent</span></div>
      <label><span>Период</span><select aria-label="Период эффективности" value={overview.period} onChange={(event) => void onPeriodChange(event.target.value)}>{monthOptions().map((period) => <option key={period} value={period}>{monthLabel(period)}</option>)}</select></label>
      <Button className="eff-help-button" appearance="secondary" aria-haspopup="dialog" aria-expanded={helpOpen} onClick={() => setHelpOpen(true)}>?</Button>
    </div>
    {error ? <div className="eff-inline-error" role="status">Показаны последние загруженные данные. {error}</div> : null}
    <div className="eff-overview-grid">
      <EmployeeSummary employee={mine} title="Моя эффективность" />
      {selected && selected.userId !== mine.userId ? <EmployeeSummary employee={selected} title="Сводка сотрудника" /> : <aside className="eff-method-card"><span className="eff-kicker">Методика {overview.methodologyVersion}</span><h2>Один показатель — один понятный смысл</h2><p>Все задачи имеют одинаковый вес. Возвраты, комментарии и субъективные оценки не меняют процент.</p><dl><div><dt>Начало достоверного учёта</dt><dd>{new Date(overview.trackingStartedAt).toLocaleDateString("ru-RU")}</dd></div><div><dt>Часовой пояс</dt><dd>{overview.timezone}</dd></div></dl><Button appearance="subtle" onClick={() => setHelpOpen(true)}>Открыть правила расчёта</Button></aside>}
    </div>

    <section className="eff-people" aria-label="Эффективность сотрудников">
      <div className="eff-people-heading"><div><h2>Сотрудники</h2><p>Нейтральная сортировка по имени. Это не рейтинг.</p></div><Input aria-label="Поиск сотрудников в эффективности" contentBefore={<Search20Regular />} placeholder="Имя или должность" value={query} onChange={(_, data) => setQuery(data.value)} /></div>
      <div className="eff-table-scroll" tabIndex={0} aria-label="Таблица прокручивается горизонтально">
        <table className="eff-table"><thead><tr><th>Сотрудник</th><th>Выполнение в срок</th><th>Вовремя / всего</th><th>Просрочено</th><th>Ожидает проверки</th><th>Возвраты</th><th>Без срока</th><th>Объём данных</th></tr></thead><tbody>{visibleEmployees.map((employee) => <tr key={employee.userId} className={selected?.userId === employee.userId ? "selected" : ""} onClick={() => setSelectedUserId(employee.userId)}><td><button type="button" aria-label={`Открыть сводку: ${employee.name}`} onClick={() => setSelectedUserId(employee.userId)}><Avatar name={employee.name} size={32} /><span><strong>{employee.name}</strong><small>{employee.jobTitle}</small></span></button></td><td><strong>{percentageLabel(employee)}</strong>{employee.smallSample ? <small>мало данных</small> : null}</td><td>{employee.onTimeCount} / {employee.eligibleCount}</td><td>{employee.overdueCount}</td><td>{employee.awaitingReviewCount}</td><td>{employee.returnedForRevisionCount}</td><td>{employee.noDueDateCount}</td><td>{employee.sampleSize} задач</td></tr>)}</tbody></table>
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
