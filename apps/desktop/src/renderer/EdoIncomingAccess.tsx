import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Input, Spinner } from "@fluentui/react-components";
import type { EdoAccessConfiguration, EdoAccessUpdate, EdoVisibility, WorkspacePerson } from "@yuksalish/contracts";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { loadEdoAccess, saveEdoAccess } from "./workspace-api";

export const edoVisibilityLabels: Record<EdoVisibility, string> = {
  assigned: "Только свои письма",
  departments: "Свои письма и письма подразделений",
  all: "Все входящие письма",
};

export function EdoIncomingAccess({ token, people }: {
  readonly token: string;
  readonly people: readonly WorkspacePerson[];
}) {
  const [config, setConfig] = useState<EdoAccessConfiguration>();
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<EdoAccessUpdate>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);
  const rule = config?.rules.find((item) => item.userId === selected);
  const names = new Map(people.map((person) => [person.id, person.name]));
  const options = config?.rules.filter((item) => item.userId === selected
    || (names.get(item.userId) ?? item.userId).toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [];

  useEffect(() => {
    let alive = true;
    void loadEdoAccess(token).then((value) => {
      if (alive) { setConfig(value); setError(""); }
    }).catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : "Не удалось загрузить настройки.");
    });
    return () => { alive = false; };
  }, [token, attempt]);

  const choose = (id: string) => {
    const value = config?.rules.find((item) => item.userId === id);
    setSelected(id);
    setDraft(value ? { mode: value.mode, departmentIds: value.departmentIds, expectedRevision: value.revision } : undefined);
    setError(""); setNotice("");
  };
  const reload = () => {
    setConfig(undefined); setSelected(""); setDraft(undefined); setError(""); setNotice("");
    setAttempt((value) => value + 1);
  };
  const save = async () => {
    if (!draft || !rule?.editable || busy.current) return;
    busy.current = true; setSaving(true); setError(""); setNotice("");
    try {
      const saved = await saveEdoAccess(token, selected, draft);
      setConfig((current) => current ? { ...current, rules: current.rules.map((item) => item.userId === saved.userId ? saved : item) } : current);
      setDraft({ mode: saved.mode, departmentIds: saved.departmentIds, expectedRevision: saved.revision });
      setNotice("Видимость сохранена. Новые запросы сотрудника учитывают это правило.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить видимость.");
    } finally { busy.current = false; setSaving(false); }
  };

  return <section className="edo-access-panel" aria-label="Настройка видимости писем">
    <div className="edo-access-intro"><div><h2>Кому доступны письма</h2>
      <p>Администраторы и суперадминистратор видят все входящие. Для руководителей можно выбрать подразделения или открыть весь реестр.</p>
      <p>Настройка разрешает читать карточки и вложения. Выполнять письмо и добавлять исполнителей по-прежнему могут только назначенные исполнители.</p>
    </div><Button disabled={saving} onClick={reload}>Обновить настройки</Button></div>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!config && !error ? <Spinner label="Загружаем настройки доступа" /> : null}
    {config ? <div className="edo-access-form">
      <label>Найти сотрудника<Input aria-label="Поиск сотрудника для доступа к письмам" value={search} disabled={saving}
        onChange={(_event, data) => setSearch(data.value)} placeholder="Имя сотрудника" /></label>
      <label>Сотрудник<WorkspaceSelect aria-label="Сотрудник для доступа к письмам" value={selected} disabled={saving}
        onChange={(event) => choose(event.target.value)}><option value="">Выберите сотрудника</option>
        {options.map((item) => <option key={item.userId} value={item.userId}>{names.get(item.userId) ?? item.userId} · {edoVisibilityLabels[item.mode]}</option>)}
      </WorkspaceSelect></label>
      {rule && draft ? <>
        <p>Сохранённое правило: {edoVisibilityLabels[rule.mode]}. {!rule.editable ? "Полный просмотр закреплён за ролью администратора." : ""}</p>
        <label>Доступные письма<WorkspaceSelect aria-label="Видимость писем" value={draft.mode} disabled={saving || !rule.editable}
          onChange={(event) => {
            const mode = event.target.value as EdoVisibility;
            setDraft({ ...draft, mode, departmentIds: [] }); setNotice("");
          }}>
          {Object.entries(edoVisibilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </WorkspaceSelect></label>
        {draft.mode === "departments" ? <fieldset disabled={saving || !rule.editable}>
          <legend>Подразделения</legend>
          <p>Письма действующих сотрудников выбранных подразделений и личные назначения руководителя. Вложенные отделы выбираются отдельно; переводы сотрудников учитываются при следующем запросе.</p>
          {config.departments.length ? config.departments.map((item) => <Checkbox key={item.id} label={item.name}
            checked={draft.departmentIds.includes(item.id)}
            onChange={(_event, data) => {
              setDraft({ ...draft, departmentIds: data.checked ? [...draft.departmentIds, item.id] : draft.departmentIds.filter((id) => id !== item.id) });
              setNotice("");
            }} />) : <p>Сначала добавьте подразделения в справочнике сотрудников.</p>}
        </fieldset> : null}
        <div className="edo-access-actions"><Button appearance="primary" disabled={saving || !rule.editable || (draft.mode === "departments" && !draft.departmentIds.length)}
          onClick={() => void save()}>{saving ? "Сохраняем…" : "Сохранить видимость"}</Button>
          <Button disabled={saving} onClick={() => choose(selected)}>Отменить изменения</Button></div>
      </> : null}
    </div> : null}
  </section>;
}
