import { useEffect, useRef, useState } from "react";
import type {
  AIReferentIncomingAccess as AccessConfiguration,
  AIReferentIncomingAccessUpdate,
  AIReferentIncomingRuleMode,
  WorkspacePerson,
} from "@yuksalish/contracts";
import { Button, Checkbox, Input, Spinner } from "@fluentui/react-components";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { loadAIReferentIncomingAccess, saveAIReferentIncomingAccess } from "./workspace-api";

const labels = { none: "Нет доступа", assigned: "Только назначенные Exat", all: "Все входящие" };

export function AIReferentIncomingAccess({ token, people }: {
  readonly token: string;
  readonly people: readonly WorkspacePerson[];
}) {
  const [config, setConfig] = useState<AccessConfiguration>();
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<AIReferentIncomingAccessUpdate>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);
  const rule = config?.rules.find((item) => item.userId === selected);
  const person = people.find((item) => item.id === selected);
  const locked = person?.role === "admin" || person?.role === "superadmin";
  const accounts = people.filter((item) => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())
    || (item.username ?? "").toLocaleLowerCase().includes(search.toLocaleLowerCase()) || item.id === selected);

  useEffect(() => {
    let alive = true;
    void loadAIReferentIncomingAccess(token).then((next) => {
      if (alive) { setConfig(next); setError(""); }
    }).catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : "Не удалось загрузить видимость.");
    });
    return () => { alive = false; };
  }, [token, attempt]);

  const choose = (userId: string) => {
    const next = config?.rules.find((item) => item.userId === userId);
    setSelected(userId);
    setDraft(next ? { mode: next.mode, responsibles: next.responsibles, expectedRevision: next.revision } : undefined);
    setError(""); setNotice("");
  };
  const changeMode = (mode: AIReferentIncomingRuleMode) => {
    setDraft((current) => current ? { ...current, mode, responsibles: [] } : current);
    setNotice("");
  };
  const save = async () => {
    if (!draft || !selected || locked || busy.current) return;
    busy.current = true; setSaving(true); setError(""); setNotice("");
    try {
      const saved = await saveAIReferentIncomingAccess(token, selected, draft);
      setConfig((current) => current ? { ...current, rules: current.rules.map((item) =>
        item.userId === selected ? saved : item) } : current);
      setDraft({ mode: saved.mode, responsibles: saved.responsibles, expectedRevision: saved.revision });
      setNotice(`Сохранено: ${labels[saved.effectiveMode]}. Новые запросы сразу учитывают настройку.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить видимость.");
    } finally { busy.current = false; setSaving(false); }
  };

  return <section className="ai-referent-page ai-referent-settings" aria-label="Видимость входящих писем">
    <div className="ai-referent-page-intro"><div><span className="ai-referent-eyebrow">Права на переписку</span>
      <h2>Кому видны входящие</h2><p>Выберите сотрудника и режим доступа. Изменяется только Workspace — настройки робота Exat остаются прежними.</p>
    </div><Button disabled={saving} onClick={() => { setAttempt((value) => value + 1); setSelected(""); setDraft(undefined); setConfig(undefined); setError(""); }}>Обновить настройки</Button></div>
    {error ? <p role="alert" className="ai-referent-feedback">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!config && !error ? <Spinner label="Загружаем видимость" /> : null}
    {config ? <div className="ai-referent-access-editor">
      <label>Найти сотрудника<Input aria-label="Поиск сотрудника для видимости" value={search} disabled={saving}
        onChange={(_event, data) => setSearch(data.value)} placeholder="Имя или логин" /></label>
      <label>Сотрудник<WorkspaceSelect aria-label="Сотрудник для видимости" value={selected} disabled={saving}
        onChange={(event) => choose(event.target.value)}><option value="">Выберите сотрудника</option>
        {accounts.map((item) => <option key={item.id} value={item.id}>{item.name} · @{item.username} · {labels[config.rules.find((row) => row.userId === item.id)?.effectiveMode ?? "none"]}</option>)}
      </WorkspaceSelect></label>
      {rule && draft ? <>
        <p className="ai-referent-settings-explain">Сейчас: {labels[rule.effectiveMode]}. {locked ? "Администраторы всегда видят все письма." : "Общие права модуля продолжают действовать; видимость не даёт права согласовывать или отправлять чужие письма."}</p>
        <label>Видимость<WorkspaceSelect aria-label="Режим видимости входящих" disabled={saving || locked} value={draft.mode}
          onChange={(event) => changeMode(event.target.value as AIReferentIncomingRuleMode)}>
          <option value="default">По умолчанию</option><option value="none">Нет доступа</option>
          <option value="assigned">Только назначенные Exat</option><option value="all">Все входящие</option>
        </WorkspaceSelect></label>
        {draft.mode === "default" ? <p className="ai-referent-settings-explain">По умолчанию председатель и назначенные заместители видят все входящие; Ботир Мардаев, Саида Мустафаева и Аскар Маматханов — только свои назначения Exat. Остальным входящие закрыты. Неоднозначные имена требуют явной привязки ниже.</p> : null}
        {draft.mode === "assigned" ? <fieldset className="ai-referent-access-bindings" disabled={saving || locked}>
          <legend>Ответственные в Exat</legend>
          <p>Отметьте, под каким именем робот регистрирует письма этого сотрудника. Привязка использует ID робота, а не похожесть имён.</p>
          {config.responsibles.length === 0 ? <p>Exat ещё не передал ответственных. Дождитесь синхронизации и обновите настройки.</p> : config.responsibles.map((item) =>
            <Checkbox key={`${item.agentId}:${item.externalId}`} label={`${item.displayName} · ${item.agentId} · ${item.externalId}`}
              checked={draft.responsibles.some((value) => value.agentId === item.agentId && value.externalId === item.externalId)}
              onChange={(_event, data) => setDraft((current) => current ? { ...current, responsibles: data.checked
                ? [...current.responsibles, { agentId: item.agentId, externalId: item.externalId }]
                : current.responsibles.filter((value) => value.agentId !== item.agentId || value.externalId !== item.externalId) } : current)} />)}
        </fieldset> : null}
        {draft.mode === "all" ? <p className="ai-referent-settings-explain">Сотруднику будут доступны все входящие, общий архив и Excel-журналы.</p> : null}
        <div className="ai-referent-settings-actions"><Button appearance="primary" disabled={saving || locked || (draft.mode === "assigned" && draft.responsibles.length === 0)} onClick={() => void save()}>
          {saving ? "Сохраняем…" : "Сохранить видимость"}</Button>
          <Button disabled={saving} onClick={() => choose(selected)}>Отменить изменения</Button></div>
      </> : null}
    </div> : null}
  </section>;
}
