import { useEffect, useId, useState } from "react";
import { Button, Combobox, Option } from "@fluentui/react-components";
import type { TaskPlan } from "@yuksalish/contracts";
import { loadTaskPlans } from "./workspace-api";

export function TaskPlanPicker({ token, plans, loading = false, error = "", onRetry,
  value, onChange, disabled = false, readOnly = false }: {
  readonly token?: string;
  readonly plans?: readonly TaskPlan[];
  readonly loading?: boolean;
  readonly error?: string;
  readonly onRetry?: () => void;
  readonly value: readonly string[];
  readonly onChange: (ids: readonly string[]) => void;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
}) {
  const id = useId();
  const [revision, setRevision] = useState(0);
  const key = `${token}:${revision}`;
  const [state, setState] = useState<{ key: string; plans: readonly TaskPlan[]; error: string }>({ key: "", plans: [], error: "" });
  const [query, setQuery] = useState<string>();
  useEffect(() => {
    if (plans !== undefined || !token) return;
    let active = true;
    void loadTaskPlans(token).then(result => {
      if (active) setState({ key, plans: result, error: "" });
    }).catch(() => {
      if (active) setState({ key, plans: [], error: "Не удалось загрузить планы." });
    });
    return () => { active = false; };
  }, [key, token, plans]);
  const pending = plans !== undefined ? loading : Boolean(token) && state.key !== key;
  const issue = plans !== undefined ? error : state.key === key ? state.error : "";
  const options = plans ?? (state.key === key ? state.plans : []);
  const selected = value.map(planId => options.find(plan => plan.id === planId));
  const matches = options.filter(plan => (plan.status === "active" || value.includes(plan.id))
    && plan.title.toLocaleLowerCase("ru").includes(query?.trim().toLocaleLowerCase("ru") ?? ""));
  const summary = selected.length === 1 ? selected[0]?.title ?? "Ранее выбранный план"
    : selected.length ? `Выбрано планов: ${selected.length}` : "";
  return <div className="task-plan-picker">
    <label id={`${id}-label`} htmlFor={id}>Планы · необязательно</label>
    <Combobox id={id} aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`}
      expandIcon={{ "aria-label": "Выбрать планы" }}
      multiselect selectedOptions={[...value]} value={query ?? summary}
      placeholder={pending ? "Загрузка планов…" : "Без плана"} disabled={disabled || readOnly || pending || Boolean(issue)}
      onChange={event => setQuery(event.target.value)} onBlur={() => setQuery(undefined)}
      onOptionSelect={(_, data) => { onChange(data.selectedOptions); setQuery(undefined); }}>
      {matches.map(plan => <Option key={plan.id} value={plan.id} text={plan.title}>
        {plan.title}{plan.status === "completed" ? " · завершён" : ""}
      </Option>)}
      {!matches.length && <Option value="no-match" disabled>Планы не найдены</Option>}
    </Combobox>
    <small id={`${id}-hint`}>{readOnly ? "Связи с планами меняет постановщик или уполномоченный сотрудник."
      : "Можно выбрать несколько планов. Привязка сохранится вместе с задачей."}</small>
    {value.length > 0 && <div className="task-plan-picker-selected">
      {value.map((planId, index) => <span key={planId}>{selected[index]?.title ?? "Ранее выбранный план"}</span>)}
      {!readOnly && <Button type="button" appearance="subtle" size="small" disabled={disabled || pending || Boolean(issue)} onClick={() => onChange([])}>Убрать все планы</Button>}
    </div>}
    {issue && <div role="alert" className="task-plan-error">{issue} <Button type="button" appearance="subtle" size="small" disabled={disabled}
      onClick={() => plans !== undefined ? onRetry?.() : setRevision(current => current + 1)}>Повторить загрузку планов</Button></div>}
  </div>;
}
