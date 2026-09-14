import { useState } from "react";
import { Avatar, Input, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { Checkmark20Regular, ChevronDown16Regular, Person20Regular, Search20Regular } from "@fluentui/react-icons";
import type { WorkspacePerson } from "@yuksalish/contracts";

/** Contextual owner selection; the supplied directory is the permission boundary. */
export function PersonPicker({ people, value, onChange, label, disabled = false }: {
  people: readonly WorkspacePerson[]; value: string; onChange: (id: string) => void; label: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = people.find(person => person.id === value);
  const normalized = query.trim().toLocaleLowerCase("ru");
  const visible = people.filter(person => `${person.name} ${person.jobTitle ?? ""}`.toLocaleLowerCase("ru").includes(normalized));
  return <Popover open={open} onOpenChange={(_, data) => { setOpen(data.open); if (data.open) setQuery(""); }} positioning="below-start" trapFocus>
    <PopoverTrigger disableButtonEnhancement>
      <button type="button" className="person-picker-trigger" aria-label={label} disabled={disabled}>
        {selected ? <Avatar name={selected.name} size={28} color="colorful" /> : <Person20Regular />}
        <span>{selected?.name ?? "Выберите сотрудника"}</span><ChevronDown16Regular />
      </button>
    </PopoverTrigger>
    <PopoverSurface className="person-picker-surface" aria-label={label}>
      <Input aria-label={`Поиск: ${label}`} placeholder="Имя или должность" contentBefore={<Search20Regular />} value={query} onChange={(_, data) => setQuery(data.value)} />
      <div className="person-picker-list" aria-label="Доступные сотрудники">
        {visible.map(person => <button type="button" key={person.id} aria-pressed={person.id === value} onClick={() => { onChange(person.id); setOpen(false); }}>
          <Avatar name={person.name} size={36} color="colorful" /><span><strong>{person.name}</strong><small>{person.jobTitle ?? "Сотрудник"}</small></span>{person.id === value ? <Checkmark20Regular /> : null}
        </button>)}
        {!visible.length && <p role="status">Сотрудники не найдены</p>}
      </div>
    </PopoverSurface>
  </Popover>;
}
