import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, Input, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { Checkmark20Regular, ChevronDown16Regular, Dismiss16Regular, Person20Regular, Search20Regular } from "@fluentui/react-icons";
import type { WorkspaceDepartment, WorkspacePerson } from "@yuksalish/contracts";
import { ProfileAvatar } from "./ProfileAvatar";
import { EmployeeScopeSwitch } from "./EmployeeScopeSwitch";
import { employeeScope, type EmployeeScope } from "./employee-scope";
import { useContextMotion } from "./useContextMotion";

/** Contextual owner selection; the supplied directory is the permission boundary. */
export function PersonPicker({ people, departments, value, onChange, label, disabled = false, emptyLabel = "Выберите сотрудника", token }: {
  people: readonly WorkspacePerson[]; departments?: readonly WorkspaceDepartment[]; value: string; onChange: (id: string) => void; label: string; disabled?: boolean; emptyLabel?: string; token?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<EmployeeScope>("central");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<{
    position: "above" | "below"; align: "start" | "end"; listHeight: number;
  }>({ position: "below", align: "start", listHeight: 280 });
  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 20;
    const above = rect.top - 20;
    // Choose the side for the full bounded list once, not at every tween frame.
    // Otherwise a growing list can repeatedly flip across its trigger.
    const position = below >= 420 || below >= above ? "below" : "above";
    const width = Math.min(370, window.innerWidth - 40);
    setPlacement({ position,
      align: rect.left + width > window.innerWidth - 20 && rect.right >= width + 20 ? "end" : "start",
      listHeight: Math.min(280, Math.max(48, (position === "below" ? below : above) - (departments ? 124 : 70))),
    });
  }, [departments]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, place]);
  const listMotion = useContextMotion(scope, { resize: true, fade: false });
  const selected = people.find(person => person.id === value);
  const normalized = query.trim().toLocaleLowerCase("ru");
  const visible = people.filter(person => (!departments || employeeScope(person.departmentId, departments) === scope) && `${person.name} ${person.jobTitle ?? ""}`.toLocaleLowerCase("ru").includes(normalized));
  return <Popover open={open} onOpenChange={(_, data) => { setOpen(data.open); if (data.open) { place(); setQuery(""); setScope(departments ? employeeScope(selected?.departmentId, departments) : "central"); } }} positioning={{ position: placement.position, align: placement.align, pinned: true }} trapFocus>
    <PopoverTrigger disableButtonEnhancement>
      <button ref={triggerRef} type="button" className="person-picker-trigger" aria-label={label} disabled={disabled}>
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
      <div className="person-picker-list-viewport" ref={listMotion} style={{ maxHeight: placement.listHeight }}>
      <div className="person-picker-list" aria-label="Доступные сотрудники">
        {visible.map(person => <button type="button" key={person.id} aria-pressed={person.id === value} onClick={() => { onChange(person.id); setOpen(false); }}>
          {token ? <ProfileAvatar person={person} token={token} size={36} /> : <Avatar name={person.name} size={36} color="colorful" />}<span><strong>{person.name}</strong><small>{person.jobTitle ?? "Сотрудник"}</small></span>{person.id === value ? <Checkmark20Regular /> : null}
        </button>)}
        {!visible.length && <p role="status">Сотрудники не найдены</p>}
      </div>
      </div>
    </PopoverSurface>
  </Popover>;
}
