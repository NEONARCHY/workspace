import { useState } from "react";
import { Avatar } from "@fluentui/react-components";
import type { WorkspaceDepartment, WorkspacePerson } from "@yuksalish/contracts";
import { EmployeeScopeSwitch } from "./EmployeeScopeSwitch";
import { employeeScope, type EmployeeScope } from "./employee-scope";

interface Props {
  readonly label: string;
  readonly people: readonly WorkspacePerson[];
  readonly departments?: readonly WorkspaceDepartment[];
  readonly selectedIds: readonly string[];
  readonly onChange: (ids: string[]) => void;
  readonly disabled?: boolean;
}

export function ScopedPeopleCheckboxes({ label, people, departments, selectedIds, onChange, disabled = false }: Props) {
  const [scope, setScope] = useState<EmployeeScope>(() => employeeScope(
    people.find((person) => person.id === selectedIds[0])?.departmentId,
    departments ?? [],
  ));
  const visible = people.filter((person) => !departments || employeeScope(person.departmentId, departments) === scope);
  return <fieldset className="project-hub-people scoped-people-checkboxes" disabled={disabled}>
    <legend>{label} · выбрано {selectedIds.length}</legend>
    {departments ? <EmployeeScopeSwitch value={scope} onChange={setScope} disabled={disabled} label={`Группа: ${label}`} /> : null}
    <div className="scoped-people-checkboxes-list">
      {visible.map((person) => <label key={person.id}>
        <input type="checkbox" checked={selectedIds.includes(person.id)} onChange={(event) => onChange(event.target.checked
          ? [...selectedIds, person.id]
          : selectedIds.filter((id) => id !== person.id))} />
        <span className="workspace-person-choice"><Avatar name={person.name} size={24} color="colorful" aria-hidden="true" /><span>{person.name}</span></span>
      </label>)}
      {!visible.length ? <p role="status">В этой группе сотрудников нет.</p> : null}
    </div>
  </fieldset>;
}
