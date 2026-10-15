import { WorkspaceNotice } from "./WorkspaceNotice";
import { useId, useState } from "react";
import { Button, Checkbox, Combobox, Option } from "@fluentui/react-components";
import { Input } from "./WorkspaceInput";
import type { WorkspacePerson } from "@yuksalish/contracts";
import { Search20Regular } from "@fluentui/react-icons";
import { ProfileAvatar } from "./ProfileAvatar";
import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";
import { calendarRangeError, type CalendarFilters as Filters } from "./calendar-filters";

export function CalendarFilters({ value, onChange, onReset, people, token, currentUserId, disabled, compact = false }: {
  readonly value: Filters;
  readonly onChange: (filters: Filters) => void;
  readonly onReset: () => void;
  readonly people: readonly WorkspacePerson[];
  readonly token: string;
  readonly currentUserId: string;
  readonly disabled: boolean;
  readonly compact?: boolean;
}) {
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState<string>();
  const person = people.find(item => item.id === value.employeeId);
  const query = search?.trim().toLocaleLowerCase() ?? "";
  const candidates = people.filter(item => `${item.name} ${item.username ?? ""} ${item.jobTitle ?? ""}`.toLocaleLowerCase().includes(query));
  const issue = calendarRangeError(value.from, value.to);
  const activeCount = [value.employeeId, value.query.trim(), value.from || value.to, !value.showCancelled].filter(Boolean).length;
  return <section className="calendar-filters" aria-label="Фильтры календаря">
    {compact && <Button className="calendar-filter-toggle" disabled={disabled} aria-expanded={expanded} aria-controls={bodyId}
      onClick={() => setExpanded(current => !current)}>Фильтры{activeCount ? ` · ${activeCount}` : ""}<span aria-hidden="true">{expanded ? "−" : "+"}</span></Button>}
    <div id={bodyId} className="calendar-filter-body" hidden={compact && !expanded}>
    <div className="calendar-filter-fields">
      <div className="calendar-filter-field">
        <span>Сотрудник</span>
        <Combobox aria-label="Сотрудник в событиях" placeholder="Все сотрудники" disabled={disabled}
          value={search ?? person?.name ?? (value.employeeId ? "Выбранный сотрудник" : "Все сотрудники")} selectedOptions={[value.employeeId]}
          onChange={event => setSearch(event.target.value)} onBlur={() => setSearch(undefined)}
          onOptionSelect={(_, data) => { onChange({ ...value, employeeId: data.optionValue ?? "" }); setSearch(undefined); }}>
          <Option value="" text="Все сотрудники">Все сотрудники</Option>
          {candidates.map(item => <Option key={item.id} value={item.id} text={item.name}>
            <ProfileAvatar person={item} token={token} size={24} /><span>{item.name}</span>
          </Option>)}
          {!candidates.length && <Option disabled value="no-match">Сотрудники не найдены</Option>}
        </Combobox>
      </div>
      <div className="calendar-filter-field"><span>Поиск события</span>
        <Input aria-label="Поиск событий" placeholder="Название, место или описание" value={value.query} disabled={disabled}
          contentBefore={<Search20Regular />} onChange={(_, data) => onChange({ ...value, query: data.value })} />
      </div>
      <div className="calendar-filter-period">
        <div className="calendar-filter-field"><span>С даты</span><WorkspaceDateTimePicker mode="date" ariaLabel="События с даты"
          value={value.from} disabled={disabled} onChange={from => onChange({ ...value, from })} /></div>
        <div className="calendar-filter-field"><span>По дату</span><WorkspaceDateTimePicker mode="date" ariaLabel="События по дату"
          value={value.to} disabled={disabled} onChange={to => onChange({ ...value, to })} /></div>
      </div>
    </div>
    <div className="calendar-filter-options">
      <Button appearance="subtle" disabled={disabled} aria-pressed={value.employeeId === currentUserId}
        onClick={() => onChange({ ...value, employeeId: value.employeeId === currentUserId ? "" : currentUserId })}>Мои события</Button>
      <Checkbox label="Показывать отменённые" checked={value.showCancelled} disabled={disabled}
        onChange={(_, data) => onChange({ ...value, showCancelled: data.checked === true })} />
      <span>Организатор или участник · только доступные вам события</span>
      <Button appearance="subtle" disabled={disabled} onClick={() => { setSearch(undefined); onReset(); }}>Сбросить фильтры</Button>
    </div>
    </div>
    {issue && <WorkspaceNotice tone="error" className="calendar-filter-error" role="alert">{issue}</WorkspaceNotice>}
  </section>;
}
