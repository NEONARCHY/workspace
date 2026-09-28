import { useState } from "react";
import { Avatar, Input, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { Checkmark20Regular, ChevronDown16Regular, Dismiss16Regular, Person20Regular, Search20Regular } from "@fluentui/react-icons";
import type { WorkspaceDepartment, WorkspacePerson } from "@yuksalish/contracts";
import { ProfileAvatar } from "./ProfileAvatar";
import { EmployeeScopeSwitch } from "./EmployeeScopeSwitch";
import { employeeScope, type EmployeeScope } from "./employee-scope";

/** Contextual owner selection; the supplied directory is the permission boundary. */
export function PersonPicker({ people, departments, value, onChange, label, disabled = false, emptyLabel = "Выберите сотрудника", token }: {
  people: readonly WorkspacePerson[]; departments?: readonly WorkspaceDepartment[]; value: string; onChange: (id: string) => void; label: string; disabled?: boolean; emptyLabel?: string; token?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<EmployeeScope>("central");
  const selected = people.find(person => person.id === value);
  const normalized = query.trim().toLocaleLowerCase("ru");
  const visible = people.filter(person => (!departments || employeeScope(person.departmentId, departments) === scope) && `${person.name} ${person.jobTitle ?? ""}`.toLocaleLowerCase("ru").includes(normalized));
  return <Popover open={open} onOpenChange={(_, data) => { setOpen(data.open); if (data.open) { setQuery(""); setScope(departments ? employeeScope(selected?.departmentId, departments) : "central"); } }} positioning="below-start" trapFocus>
    <PopoverTrigger disableButtonEnhancement>
      <button type="button" className="person-picker-trigger" aria-label={label} disabled={disabled}>
        {selected ? <span className="person-picker-value">
          {token ? <ProfileAvatar person={selected} token={token} size={28} /> : <Avatar name={selected.name} size={28} color="colorful" />}
          <span>{selected.name}</span>
        </span> : <><Person20Regular /><span>{emptyLabel}</span></>}
        <ChevronDown16Regular />
      </button>
    </PopoverTrigger>
    <PopoverSurface className="person-picker-surface" aria-label={label}>
      {departments ? <EmployeeScopeSwitch value={scope} onChange={setScope} label={`Группа сотрудников: ${label}`} /> : null}
      <div className="person-picker-search-row">
        <Input aria-label={`Поиск: ${label}`} placeholder="Имя или должность" contentBefore={<Search20Regular />} value={query} onChange={(_, data) => setQuery(data.value)} />
        {value ? <button type="button" aria-label="Снять выбор сотрудника" title="Снять выбор" onClick={() => { onChange(""); setOpen(false); }}><Dismiss16Regular /></button> : null}
      </div>
      <div className="person-picker-list" aria-label="Доступные сотрудники">
        {visible.map(person => <button type="button" key={person.id} aria-pressed={person.id === value} onClick={() => { onChange(person.id); setOpen(false); }}>
          {token ? <ProfileAvatar person={person} token={token} size={36} /> : <Avatar name={person.name} size={36} color="colorful" />}<span><strong>{person.name}</strong><small>{person.jobTitle ?? "Сотрудник"}</small></span>{person.id === value ? <Checkmark20Regular /> : null}
        </button>)}
        {!visible.length && <p role="status">Сотрудники не найдены</p>}
      </div>
    </PopoverSurface>
  </Popover>;
}
