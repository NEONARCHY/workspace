import { Button } from "@fluentui/react-components";
import type { WorkspacePerson } from "@yuksalish/contracts";
import { PersonPicker } from "./PersonPicker";
import { WorkspaceSelect } from "./WorkspaceSelect";

function isDeputy(person: WorkspacePerson): boolean {
  const title = (person.jobTitle ?? "").replace(/[‘’ʻʼ`]/g, "'").trim().toLowerCase().replace(/\s+/g, " ");
  return person.status !== "blocked" && person.status !== "archived" && person.status !== "pending"
    && /^rais(?:ning)? (?:birinchi )?o'rinbosari(?:\s*[–—-]\s*ijrochi direktor)?$/.test(title);
}

export function ProjectPaymentRouteFields({ people, value, onChange, disabled }: {
  readonly people: readonly WorkspacePerson[];
  readonly value: readonly string[] | null | undefined;
  readonly onChange: (ids: readonly string[] | null) => void;
  readonly disabled: boolean;
}) {
  const ids = value ?? [];
  const name = (id: string) => people.find((person) => person.id === id)?.name ?? "Недоступный сотрудник";
  const move = (index: number, delta: number) => {
    const next = [...ids];
    [next[index], next[index + delta]] = [next[index + delta]!, next[index]!];
    onChange(next);
  };
  return <fieldset className="project-hub-approvers" disabled={disabled}>
    <legend>Согласование заявок на оплату</legend>
    <label>После главного бухгалтера<WorkspaceSelect
      aria-label="Маршрут оплаты после главбуха" disabled={disabled}
      value={value == null ? "legacy" : "custom"}
      onChange={(event) => onChange(event.target.value === "legacy" ? null : ids)}
    >
      <option value="legacy">Прежний маршрут</option>
      <option value="custom">Выбранные заместители или сразу председателю</option>
    </WorkspaceSelect></label>
    <p>Работа с членами Юксалиш, финансисты, помощник, главбух и остальные этапы сохраняются. Настройка действует только на новые заявки.</p>
    {value != null ? <>
      <p>Без выбранных заместителей заявка идёт сразу председателю. Добавьте заместителей, если нужны их решения: согласуют все, по порядку.</p>
      <PersonPicker label="Добавить заместителя в маршрут оплаты" people={people.filter((person) => isDeputy(person) && !ids.includes(person.id))}
        value="" disabled={disabled} onChange={(id) => onChange([...ids, id])} />
      {ids.map((id, index) => <div key={id}><b>{index + 1}</b><span>{name(id)}</span>
        <Button type="button" appearance="subtle" aria-label={`Выше: ${name(id)}`} disabled={disabled || index === 0} onClick={() => move(index, -1)}>↑</Button>
        <Button type="button" appearance="subtle" aria-label={`Ниже: ${name(id)}`} disabled={disabled || index === ids.length - 1} onClick={() => move(index, 1)}>↓</Button>
        <Button type="button" appearance="subtle" aria-label={`Убрать из маршрута оплаты: ${name(id)}`} disabled={disabled} onClick={() => onChange(ids.filter((value) => value !== id))}>Убрать</Button>
      </div>)}
      <p role="status">Главбух → {ids.length ? `${ids.map(name).join(" → ")} → ` : ""}Председатель</p>
    </> : <p>Сохраняется действующее назначение заместителя, включая особый маршрут «Субсидии».</p>}
  </fieldset>;
}
