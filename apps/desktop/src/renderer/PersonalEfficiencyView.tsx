import { useEffect, useState } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import { ArrowLeft24Regular, ArrowSync24Regular } from "@fluentui/react-icons";
import type { PersonalEfficiency, PersonalEfficiencyTask } from "@yuksalish/contracts";
import { HistoryChart, ScoreGauge } from "./EfficiencyView";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { loadPersonalEfficiency } from "./workspace-api";
import { useContextMotion } from "./useContextMotion";
import "./personal-efficiency.css";

export function personalPeriods(now = new Date()): string[] {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")!.value);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  return Array.from({ length: 12 }, (_, offset) => {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

function monthLabel(period: string) {
  return new Intl.DateTimeFormat("ru", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));
}

export function taskImpact(task: PersonalEfficiencyTask): string {
  if (task.excludedCount) return "Исключена из расчёта — процент не снижает";
  if (task.onTimeCount) return "Сдана в срок — зачёт в показателе";
  if (task.overdueCount) return "Нет действующей сдачи в срок — учтена как просроченная";
  if (task.returnedForRevisionCount) return "Возврат отменил зачёт предыдущей сдачи";
  return task.dueAt ? "Ещё не влияет на процент за этот месяц" : "Без срока — не влияет на процент";
}

const statusLabels: Record<string, string> = { new: "Новая", in_progress: "В работе", awaiting_review: "На проверке", completed: "Завершена", cancelled: "Отменена" };

function TaskList({ tasks, impact = false, onOpenTask }: { readonly tasks: readonly PersonalEfficiencyTask[]; readonly impact?: boolean; readonly onOpenTask?: (id: string) => void }) {
  return <ul className="personal-eff-task-list">{tasks.map((task) => <li key={task.id} data-tone={impact ? task.onTimeCount ? "success" : task.overdueCount ? "danger" : "neutral" : "neutral"}>
    <div>{onOpenTask ? <button type="button" onClick={() => onOpenTask(task.id)}>{task.title}</button> : <strong>{task.title}</strong>}<span>{impact ? taskImpact(task) : statusLabels[task.status] ?? task.status}</span>
      {impact && task.returnedForRevisionCount > 0 ? <small>Возвратов за месяц: {task.returnedForRevisionCount}. Повторная сдача до срока восстанавливает зачёт.</small> : null}
    </div>
    <time dateTime={task.dueAt ?? undefined}>{task.dueAt ? new Date(task.dueAt).toLocaleDateString("ru", { timeZone: "Asia/Tashkent", day: "numeric", month: "short" }) : "Без срока"}</time>
  </li>)}</ul>;
}

export function PersonalEfficiencyView({ token, onBack, onOpenTask }: { readonly token: string; readonly onBack: () => void; readonly onOpenTask?: (id: string) => void }) {
  const [period, setPeriod] = useState(() => personalPeriods()[0]!);
  const [retry, setRetry] = useState(0);
  const [resource, setResource] = useState<{ token: string; period: string; retry: number; data?: PersonalEfficiency; error?: string }>();
  const motionRef = useContextMotion(period, { enter: true });
  useEffect(() => {
    let active = true;
    void loadPersonalEfficiency(token, period).then((data) => {
      if (active) setResource({ token, period, retry, data });
    }).catch((cause: unknown) => {
      if (active) setResource({ token, period, retry, error: cause instanceof Error ? cause.message : "Не удалось загрузить сводку" });
    });
    return () => { active = false; };
  }, [period, retry, token]);
  const current = resource?.token === token && resource.period === period && resource.retry === retry ? resource : undefined;
  const data = current?.data;
  const employee = data?.employee;
  const workload = data ? [
    { key: "new", label: "Новые", count: data.workload.new },
    { key: "in-progress", label: "В работе", count: data.workload.inProgress },
    { key: "review", label: "На проверке", count: data.workload.awaitingReview },
    { key: "completed", label: "Завершены", count: data.workload.completed },
  ] : [];
  const total = workload.reduce((sum, item) => sum + item.count, 0);
  return <div className="personal-efficiency" ref={motionRef}>
    <header className="personal-eff-commandbar"><Button autoFocus icon={<ArrowLeft24Regular />} onClick={onBack}>К профилю</Button><label><span>Месяц расчёта</span><WorkspaceSelect aria-label="Месяц моей эффективности" value={period} onChange={(event) => setPeriod(event.target.value)}>{personalPeriods().map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</WorkspaceSelect></label><Button icon={<ArrowSync24Regular />} aria-label="Обновить мою эффективность" onClick={() => setRetry((value) => value + 1)} /></header>
    {!current ? <div className="personal-eff-loading"><Spinner label="Готовим вашу эффективность" /></div> : null}
    {current?.error ? <div className="personal-eff-error" role="alert"><h3>Не удалось загрузить эффективность</h3><p>{current.error}</p><Button onClick={() => setRetry((value) => value + 1)}>Повторить загрузку</Button></div> : null}
    {data && employee ? <>
      <section className="personal-eff-lead" aria-label="Выполнение задач в срок"><ScoreGauge employee={employee} /><div><span className="eff-kicker">Мой результат · {monthLabel(period)}</span><h2>{employee.name}</h2><p>Выполнение задач в срок</p><strong>{employee.onTimeCount} из {employee.eligibleCount} задач в расчёте</strong><small>{employee.percentage == null ? "Пока нет учитываемых задач. Это не 0%: будущие задачи и задачи без срока не снижают результат." : "Каждая задача имеет одинаковый вес. Своевременная сдача на проверку засчитывается, не дожидаясь решения постановщика."}</small>
        {employee.smallSample ? <p className="personal-eff-notice">Малая выборка — процент пока не описывает устойчивую тенденцию.</p> : null}
        {employee.historyCompleteness !== "complete" ? <p className="personal-eff-notice">{employee.historyCompleteness === "partial" ? "История этого месяца неполная." : "Достоверной истории за этот месяц пока нет."}</p> : null}
      </div></section>
      <div className="personal-eff-metrics" aria-label="Показатели за выбранный месяц">{[
        ["Вовремя", employee.onTimeCount, "success"], ["Просрочено", employee.overdueCount, "danger"], ["Возвраты", employee.returnedForRevisionCount, "review"], ["Исключено", employee.excludedCount, "neutral"],
      ].map(([label, count, tone]) => <article key={label} data-tone={tone}><span>{label}</span><strong>{count}</strong></article>)}</div>
      <section className="personal-eff-panel"><header><h3>Динамика по месяцам</h3><span>Только подтверждённая история</span></header><HistoryChart employee={employee} /></section>
      {data.taskDetailsVisible ? <>
        <section className="personal-eff-panel"><header><h3>Мои задачи сейчас</h3><span>Текущий список, независимо от месяца расчёта</span></header>
          <div className="personal-eff-workload-bar" aria-hidden="true">{workload.filter((item) => item.count > 0).map((item) => <i key={item.key} data-status={item.key} style={{ flexGrow: item.count }} />)}</div>
          <div className="personal-eff-workload">{workload.map((item) => <div key={item.key} data-status={item.key}><span>{item.label}</span><strong>{item.count}</strong></div>)}</div>
          {total === 0 ? <p>Пока нет задач, где вы исполнитель или соисполнитель.</p> : null}
          {data.recentTasks.length ? <><h4>Последние обновлённые активные задачи · до 10</h4><TaskList tasks={data.recentTasks} onOpenTask={onOpenTask} /></> : null}
        </section>
        <section className="personal-eff-panel"><header><h3>Что повлияло на показатель</h3><span>{data.impactTasks.length} из {data.impactTaskCount} доступных задач</span></header><p>Последние обновлённые задачи за {monthLabel(period)}. Показаны только карточки, к которым у вас сейчас есть доступ. Их число может отличаться от общего числа задач в расчёте.</p>
          {data.impactTasks.length ? <TaskList tasks={data.impactTasks} impact onOpenTask={onOpenTask} /> : <p className="personal-eff-empty">За этот месяц доступных задач, повлиявших на показатель, пока нет.</p>}
        </section>
      </> : <p className="personal-eff-notice">Личная сводка доступна. Просмотр карточек задач отключён вашими правами доступа.</p>}
      <details className="personal-eff-panel personal-eff-method"><summary>Как считается · {employee.methodologyVersion}</summary><p>Вовремя ÷ учтённые задачи × 100%. Своевременная отправка результата даёт зачёт всем исполнителям, назначенным на момент сдачи. Возврат отменяет зачёт этой сдачи; повторная сдача до срока восстанавливает его. Перенос уже пропущенного срока не стирает прежнюю просрочку.</p><p>Будущие задачи без результата и задачи без срока не снижают процент. Исключения требуют подтверждённой причины. Учёт ведётся по месяцам Asia/Tashkent с {new Date(employee.trackingStartedAt).toLocaleDateString("ru", { timeZone: "Asia/Tashkent" })}.</p><p>Это показатель соблюдения сроков, а не оценка ценности сотрудника. Его нельзя автоматически использовать для зарплаты, штрафов или кадровых решений.</p></details>
    </> : null}
  </div>;
}
