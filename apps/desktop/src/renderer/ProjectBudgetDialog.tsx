import { useEffect, useState } from "react";
import { Button, DialogSurface, Input } from "@fluentui/react-components";
import type { ProjectBudgetArticleInput, ProjectBudgetSummary, ProjectHubProject } from "@yuksalish/contracts";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { addProjectBudgetArticle, loadProjectBudget } from "./workspace-api";
import "./project-budget.css";

interface Props {
  readonly token: string;
  readonly project: ProjectHubProject;
  readonly onClose: () => void;
}
// Exact decimal strings never pass through Number, including negative remainders.
export function exactBudgetMoney(value: string, currency: string): string {
  const [integer = "0", fraction] = value.split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${fraction ? `,${fraction}` : ""} ${currency}`;
}
const empty: ProjectBudgetArticleInput = { title: "", amount: "0", currency: "UZS", funding: "unspecified" };
export function ProjectBudgetDialog({ token, project, onClose }: Props) {
  const [summary, setSummary] = useState<ProjectBudgetSummary>();
  const [article, setArticle] = useState<ProjectBudgetArticleInput>({ ...empty, currency: project.currency });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [creationKey, setCreationKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let cancelled = false;
    void loadProjectBudget(token, project.id).then((value) => {
      if (!cancelled) setSummary(value);
    }).catch((failure: unknown) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : "Не удалось загрузить бюджет.");
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [token, project.id, refresh]);
  const save = async () => {
    if (busy) return;
    setBusy(true); setError("");
    let refreshScheduled = false;
    try {
      await addProjectBudgetArticle(token, project.id, { ...article, idempotencyKey: creationKey });
      setCreationKey(crypto.randomUUID());
      setArticle({ ...empty, currency: project.currency }); setAdding(false);
      setRefresh((value) => value + 1);
      refreshScheduled = true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не удалось добавить статью.");
    } finally { if (!refreshScheduled) setBusy(false); }
  };
  return <WorkspaceDialog open onOpenChange={(_, data) => { if (!data.open && !busy) onClose(); }}>
    <DialogSurface className="project-budget-dialog" aria-labelledby="project-budget-title">
      <header><h2 id="project-budget-title">Бюджет и расходы · {project.title}</h2><Button disabled={busy} onClick={onClose}>Закрыть</Button></header>
      <div className="project-budget-scroll" aria-busy={busy}>
        <p>Расход фиксируется один раз после «Выполнено» заявки на оплату. Согласование и завершение задачи не списывают бюджет.</p>
        <p>План проекта: {exactBudgetMoney(String(project.budget), project.currency)}. План сохраняется неизменным при учёте оплат.</p>
        {busy ? <p role="status">Загружаем бюджет…</p> : null}
        {summary ? <>
          <p>Остаток плана проекта в {project.currency}: <strong>{exactBudgetMoney(summary.remainingProjectAmount, project.currency)}</strong></p>
          <h3>Фактические расходы по валютам</h3>
          {summary.actualByCurrency.length ? summary.actualByCurrency.map((total) => <p key={total.currency}>{exactBudgetMoney(total.amount, total.currency)}</p>) : <p>Учтённых оплат пока нет.</p>}
          <h3>Бюджетные статьи</h3>
          <div className="project-budget-table"><table><thead><tr><th>Статья</th><th>План</th><th>Факт</th><th>Остаток</th></tr></thead>
            <tbody>{summary.articles.map((row) => <tr key={row.id}><th scope="row">{row.title}<small>{row.funding === "donor" ? "Донор" : row.funding === "own" ? "Собственный вклад" : "Источник уточняется"}</small></th>
              <td>{exactBudgetMoney(row.amount, row.currency)}</td><td>{exactBudgetMoney(row.actualAmount, row.currency)}</td><td>{exactBudgetMoney(row.remainingAmount, row.currency)}</td></tr>)}</tbody></table></div>
          {!summary.articles.length ? <p>Статей пока нет. Их можно добавить вручную или из проверенного импорта.</p> : null}
          <p>В общих расходах учитываются и оплаты без статьи. Валюты не конвертируются. Исторические завершённые заявки и прежние проектные согласования не пересчитаны.</p>
        </> : null}
        {adding && project.canEdit ? <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label>Название статьи<Input required maxLength={500} disabled={busy} value={article.title} onChange={(_, data) => setArticle({ ...article, title: data.value })} /></label>
          <label>Плановая сумма<Input required inputMode="decimal" maxLength={30} disabled={busy} value={article.amount} onChange={(_, data) => setArticle({ ...article, amount: data.value })} /></label>
          <label>Валюта<WorkspaceSelect disabled={busy} value={article.currency} onChange={(event) => setArticle({ ...article, currency: event.target.value === "USD" ? "USD" : event.target.value === "EUR" ? "EUR" : "UZS" })}><option>UZS</option><option>USD</option><option>EUR</option></WorkspaceSelect></label>
          <label>Источник финансирования<WorkspaceSelect disabled={busy} value={article.funding} onChange={(event) => setArticle({ ...article, funding: event.target.value === "donor" ? "donor" : event.target.value === "own" ? "own" : "unspecified" })}><option value="unspecified">Уточнить</option><option value="donor">Донор</option><option value="own">Собственный вклад</option></WorkspaceSelect></label>
          <p>Плановая статья сохраняется отдельно от общего бюджета проекта. Редактирование или удаление сохранённой статьи в этой версии не предусмотрено.</p>
          <Button type="submit" appearance="primary" disabled={busy || !article.title.trim()}>Сохранить статью</Button><Button disabled={busy} onClick={() => setAdding(false)}>Отмена</Button>
        </form> : null}
      </div>
      <footer>{error ? <p role="alert">{error}</p> : null}<Button disabled={busy} onClick={() => { setBusy(true); setError(""); setRefresh((value) => value + 1); }}>Обновить бюджет</Button>
        {project.canEdit && !adding ? <Button disabled={busy} onClick={() => {
          setCreationKey(crypto.randomUUID());
          setArticle({ ...empty, currency: project.currency });
          setError(""); setAdding(true);
        }}>Добавить статью</Button> : null}</footer>
    </DialogSurface>
  </WorkspaceDialog>;
}
