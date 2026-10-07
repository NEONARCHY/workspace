import type { CalendarEventInput, PaymentProjectTargets } from "@yuksalish/contracts";

import { WorkspaceSelect } from "./WorkspaceSelect";

interface Props {
  readonly value: CalendarEventInput;
  readonly targets: PaymentProjectTargets;
  readonly onChange: (value: CalendarEventInput) => void;
}

export function CalendarProjectLinkFields({ value, targets, onChange }: Props) {
  return <div className="calendar-project-fields">
    <label>Проект · необязательно
      <WorkspaceSelect aria-label="Проект события" value={value.projectId ?? ""}
        onChange={(event) => onChange({
          ...value, projectId: event.target.value || null, workstreamId: null, projectItemId: null,
        })}>
        <option value="">Без проекта</option>
        {value.projectId && !targets.projects.some((project) => project.id === value.projectId)
          ? <option value={value.projectId}>Ранее выбранный проект</option> : null}
        {targets.projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.title}</option>)}
      </WorkspaceSelect>
    </label>
    <label>Направление
      <WorkspaceSelect aria-label="Направление события" value={value.workstreamId ?? ""}
        disabled={!value.projectId}
        onChange={(event) => onChange({ ...value, workstreamId: event.target.value || null, projectItemId: null })}>
        <option value="">Выберите направление</option>
        {value.workstreamId && !targets.workstreams.some((row) => row.id === value.workstreamId)
          ? <option value={value.workstreamId}>Ранее выбранное направление</option> : null}
        {targets.workstreams.filter((row) => row.projectId === value.projectId).map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}
      </WorkspaceSelect>
    </label>
    <label className="calendar-project-item-field">Работа направления · необязательно
      <WorkspaceSelect aria-label="Работа направления события" value={value.projectItemId ?? ""}
        disabled={!value.workstreamId}
        onChange={(event) => onChange({ ...value, projectItemId: event.target.value || null })}>
        <option value="">Без привязки к работе</option>
        {value.projectItemId && !targets.items.some((item) => item.id === value.projectItemId)
          ? <option value={value.projectItemId}>Ранее выбранная работа</option> : null}
        {targets.items.filter((item) => item.workstreamId === value.workstreamId).map((item) =>
          <option key={item.id} value={item.id}>{item.kind === "task" ? "Задача" : "Мероприятие"} · {item.title}</option>)}
      </WorkspaceSelect>
    </label>
  </div>;
}
