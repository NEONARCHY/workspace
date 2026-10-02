import type { EmployeeScope } from "./employee-scope";
import { SlidingSegmented } from "./SlidingSegmented";

export function EmployeeScopeSwitch({ value, onChange, label = "Сотрудники", disabled = false }: {
  readonly value: EmployeeScope;
  readonly onChange: (value: EmployeeScope) => void;
  readonly label?: string;
  readonly disabled?: boolean;
}) {
  return <SlidingSegmented className="employee-scope-switch" role="group" aria-label={label}>
    <button type="button" aria-pressed={value === "central"} disabled={disabled} onClick={() => onChange("central")}>Центральный аппарат</button>
    <button type="button" aria-pressed={value === "regional"} disabled={disabled} onClick={() => onChange("regional")}>Регионы</button>
  </SlidingSegmented>;
}
