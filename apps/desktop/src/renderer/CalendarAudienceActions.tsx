import { Button } from "@fluentui/react-components";
import type { CalendarEventInput } from "@yuksalish/contracts";

type AudienceScope = NonNullable<CalendarEventInput["audienceScope"]>;

export function CalendarAudienceActions({ scope, count, busy, hasDepartments, onSelect }: {
  readonly scope?: AudienceScope | null;
  readonly count: number;
  readonly busy: boolean;
  readonly hasDepartments: boolean;
  readonly onSelect: (scope: AudienceScope) => void;
}) {
  return <div className="calendar-audience">
    <div className="calendar-audience-actions" role="group" aria-label="Пригласить всех сотрудников">
      {([["central", "Все ЦА"], ["regional", "Все регионы"], ["all", "ЦА и регионы"]] as const).map(([value, label]) => <Button
        key={value} type="button" disabled={busy || (value !== "all" && !hasDepartments)}
        aria-pressed={scope === value} onClick={() => onSelect(value)}>{label}</Button>)}
    </div>
    <p className="calendar-attendee-count">Выбрано участников: {count}</p>
    {scope ? <p>При сохранении пригласим всех активных сотрудников выбранной группы.
      {" "}Пересечения по времени проверит система; занятых сотрудников не исключаем.</p> : null}
  </div>;
}
