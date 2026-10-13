import type { CSSProperties } from "react";
import type { CalendarEvent, CalendarEventIconKey, CalendarEventInput } from "@yuksalish/contracts";
import { Button, Tooltip } from "@fluentui/react-components";
import { TreePine, Droplets, Ear, Users, Handshake, Plane, FolderKanban, HeartHandshake, Mountain, FileSignature, Files, GraduationCap, Mic, Video } from "lucide-react";

export const calendarIcons = [
  ["trees", "Три дерева", TreePine], ["blood", "Сдача крови", Droplets],
  ["hearing", "Слушание", Ear], ["assembly", "Собрание", Users],
  ["meeting", "Встреча", Handshake], ["trip", "Поездка", Plane],
  ["project", "Проект", FolderKanban], ["teambuilding", "Тимбилдинг", HeartHandshake],
  ["mountains", "Горы", Mountain], ["contract", "Договор", FileSignature],
  ["memorandum", "Меморандум", Files], ["training", "Тренинг", GraduationCap],
  ["interview", "Интервью", Mic],
] as const;

const colors = [
  ["#4C96A5", "Лагуна"], ["#648ABD", "Небо"], ["#608D73", "Шалфей"],
  ["#C29A4B", "Песок"], ["#AE7B65", "Терракота"], ["#A87189", "Роза"],
  ["#8981B2", "Лаванда"], ["#778C9D", "Графит"],
] as const;

export function calendarAppearanceStyle(event: Pick<CalendarEvent, "color">): CSSProperties | undefined {
  // Only validated RGB tokens reach CSS; never interpolate arbitrary server text.
  return event.color && event.color.length === 7 && /^#[\da-f]{6}$/i.test(event.color)
    ? { "--ws-surface-accent": event.color } as CSSProperties : undefined;
}

export function CalendarIcon({ iconKey, zoom = false }: { readonly iconKey?: CalendarEventIconKey | null; readonly zoom?: boolean }) {
  const Icon = zoom ? Video : calendarIcons.find(([key]) => key === iconKey)?.[2] ?? Handshake;
  return <span className={`calendar-event-icon${iconKey === "trees" && !zoom ? " is-trees" : ""}`} aria-hidden="true">
    {iconKey === "trees" && !zoom ? <><TreePine /><TreePine /><TreePine /></> : <Icon />}
  </span>;
}

export function CalendarAppearance({ draft, disabled, onChange }: {
  readonly draft: CalendarEventInput; readonly disabled?: boolean;
  readonly onChange: (draft: CalendarEventInput) => void;
}) {
  const color = draft.color ?? colors[0][0];
  return <div className="calendar-appearance">
    <fieldset disabled={disabled}><legend>Цвет события</legend>
      <div className="calendar-color-options">{colors.map(([value, label]) => <Button key={value} type="button" size="small" aria-label={`Цвет: ${label}`} aria-pressed={color.toLowerCase() === value.toLowerCase()}
        style={{ "--calendar-choice-color": value } as CSSProperties} onClick={() => onChange({ ...draft, color: value })}><span aria-hidden="true" />{label}</Button>)}</div>
      <label className="calendar-custom-color">Свой цвет <input type="color" aria-label="Свой цвет события" value={color} onChange={event => onChange({ ...draft, color: event.target.value })} /></label>
    </fieldset>
    <fieldset disabled={disabled}><legend>Иконка события</legend>
      <div className="calendar-icon-options">{calendarIcons.map(([key, label]) => <Tooltip key={key} content={label} relationship="description">
        <Button type="button" size="small" aria-label={label} disabled={disabled} aria-pressed={(draft.iconKey ?? "meeting") === key} onClick={() => onChange({ ...draft, iconKey: key })}
          icon={<CalendarIcon iconKey={key} />} />
      </Tooltip>)}</div>
    </fieldset>
    <div className="calendar-appearance-preview calendar-agenda-card" style={calendarAppearanceStyle({ color })} aria-label="Предпросмотр оформления события">
      <CalendarIcon iconKey={draft.iconKey} /><strong>{draft.title.trim() || "Ваше событие"}</strong>
    </div>
  </div>;
}
