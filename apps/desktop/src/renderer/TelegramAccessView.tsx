import { useEffect, useMemo, useState } from "react";

import type {
  TelegramAccessPerson,
  TelegramAccessRegistry,
  TelegramBotDescriptor,
  TelegramBotKey,
} from "@yuksalish/contracts";

import { loadTelegramAccess, saveTelegramAccess } from "./workspace-api";

const regions = [
  "Андижон вилояти", "Бухоро вилояти", "Фарғона вилояти", "Жиззах вилояти",
  "Наманган вилояти", "Навоий вилояти", "Қашқадарё вилояти",
  "Қорақалпоғистон Республикаси", "Самарқанд вилояти", "Сирдарё вилояти",
  "Сурхондарё вилояти", "Тошкент шаҳри", "Тошкент вилояти", "Хоразм вилояти",
] as const;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось выполнить действие. Попробуйте ещё раз.";
}

function PersonAccessRow({
  person, bots, token, onSaved,
}: {
  readonly person: TelegramAccessPerson;
  readonly bots: readonly TelegramBotDescriptor[];
  readonly token: string;
  readonly onSaved: (person: TelegramAccessPerson) => void;
}) {
  const [telegramId, setTelegramId] = useState(person.telegramId ?? "");
  const [selected, setSelected] = useState<readonly TelegramBotKey[]>(person.botKeys);
  const [hisobotScope, setHisobotScope] = useState<"central" | "hudud">(person.hisobotScope ?? "central");
  const [hisobotRegion, setHisobotRegion] = useState(person.hisobotRegion ?? regions[0]);
  const [reportRequired, setReportRequired] = useState(person.hisobotReportRequired);
  const [managementAccess, setManagementAccess] = useState(person.hisobotManager);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = telegramId !== (person.telegramId ?? "") ||
    selected.length !== person.botKeys.length ||
    selected.some((key) => !person.botKeys.includes(key)) ||
    (selected.includes("hisobot") && (
      hisobotScope !== (person.hisobotScope ?? "central") ||
      (hisobotScope === "hudud" && hisobotRegion !== person.hisobotRegion) ||
      reportRequired !== person.hisobotReportRequired ||
      managementAccess !== person.hisobotManager
    ));

  const toggle = (key: TelegramBotKey) => {
    setSelected((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key]);
    setError("");
    setNotice("");
  };

  const save = async () => {
    const id = telegramId.trim();
    if (selected.length && !id) {
      setError("Сначала укажите Telegram ID, затем выдайте доступ к ботам.");
      return;
    }
    if (id && !/^[1-9][0-9]{0,15}$/.test(id)) {
      setError("Telegram ID должен содержать от 1 до 16 цифр и не начинаться с нуля.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await saveTelegramAccess(token, person.userId, {
        telegramId: id || null,
        botKeys: selected,
        hisobotScope: selected.includes("hisobot") ? hisobotScope : null,
        hisobotRegion: selected.includes("hisobot") && hisobotScope === "hudud" ? hisobotRegion : null,
        hisobotReportRequired: reportRequired,
        hisobotManager: managementAccess,
        expectedRevision: person.revision,
      });
      onSaved(saved);
      setNotice(saved.telegramId
        ? "Сохранено. Доступ к подключённым ботам действует сразу."
        : "Telegram ID и доступы удалены.");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const initials = person.fullName.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return (
    <article className="telegram-access-row" aria-label={`${person.fullName}, @${person.username}`}>
      <div className="telegram-access-person">
        <span className="telegram-access-avatar" aria-hidden="true">{initials}</span>
        <div className="telegram-access-person-copy">
          <strong>{person.fullName}</strong>
          <span>@{person.username}{person.jobTitle ? ` · ${person.jobTitle}` : ""}</span>
        </div>
      </div>
      <div className="telegram-access-editor">
        <label className="telegram-access-id-field">
          <span>Telegram ID</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={telegramId}
            onChange={(event) => { setTelegramId(event.target.value.trim()); setError(""); setNotice(""); }}
            placeholder="Например, 123456789"
            disabled={busy}
            aria-describedby={`telegram-status-${person.userId}`}
          />
        </label>
        <span
          className={`telegram-access-status ${person.verified ? "is-verified" : ""}`}
          id={`telegram-status-${person.userId}`}
        >
          {person.verified ? "ID действует" : person.telegramId ? "Сохраните ID повторно" : "ID не указан"}
        </span>
      </div>
      <fieldset className="telegram-access-bots" disabled={busy}>
        <legend>Доступ к ботам</legend>
        <div className="telegram-access-bot-grid">
          {bots.map((bot) => (
            <label className="telegram-access-bot" key={bot.key}>
              <input
                type="checkbox"
                checked={selected.includes(bot.key)}
                onChange={() => toggle(bot.key)}
                aria-label={`${bot.label}${bot.connected ? "" : ", интеграция ещё не подключена"}`}
              />
              <span className="telegram-access-bot-mark" aria-hidden="true">✓</span>
              <span>{bot.label}<small>{bot.connected ? "Подключён" : "Ожидает интеграции"}</small></span>
            </label>
          ))}
        </div>
      </fieldset>
      {selected.includes("hisobot") ? <div className="telegram-access-hisobot" aria-label="Настройки AI Hisobot">
        <label>Контур отчётности
          <select value={hisobotScope} onChange={(event) => setHisobotScope(event.target.value as "central" | "hudud")} disabled={busy}>
            <option value="central">Центральный аппарат</option>
            <option value="hudud">Территориальное подразделение</option>
          </select>
        </label>
        {hisobotScope === "hudud" ? <label>Регион
          <select value={hisobotRegion} onChange={(event) => setHisobotRegion(event.target.value)} disabled={busy}>
            {regions.map((region) => <option key={region} value={region}>{region}</option>)}
          </select>
        </label> : null}
        <label className="telegram-access-hisobot-check"><input type="checkbox" checked={reportRequired} onChange={(event) => setReportRequired(event.target.checked)} disabled={busy} /> Сдаёт ежедневный отчёт</label>
        <label className="telegram-access-hisobot-check"><input type="checkbox" checked={managementAccess} onChange={(event) => setManagementAccess(event.target.checked)} disabled={busy} /> Видит все отчёты</label>
      </div> : null}
      <div className="telegram-access-row-footer">
        <div className="telegram-access-messages" aria-live="polite">
          {error ? <span className="telegram-access-error" role="alert">{error}</span> : null}
          {!error && notice ? <span>{notice}</span> : null}
        </div>
        <div className="telegram-access-actions">
          <button type="button" className="telegram-access-primary" onClick={() => void save()} disabled={!dirty || busy}>
            {busy ? "Подождите…" : "Сохранить"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function TelegramAccessView({ token }: { readonly token: string }) {
  const [registry, setRegistry] = useState<TelegramAccessRegistry>();
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      setRegistry(await loadTelegramAccess(token));
      setRefreshEpoch((current) => current + 1);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    void loadTelegramAccess(token).then((result) => {
      if (active) { setRegistry(result); setLoading(false); }
    }).catch((caught: unknown) => {
      if (active) { setError(errorText(caught)); setLoading(false); }
    });
    return () => { active = false; };
  }, [token]);
  const people = useMemo(() => (registry?.people ?? []).filter((person) =>
    `${person.fullName} ${person.username} ${person.jobTitle ?? ""}`
      .toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU"))), [registry, query]);
  const verified = registry?.people.filter((person) => person.verified).length ?? 0;
  const referentAccess = registry?.people.filter((person) => person.verified && person.botKeys.includes("ai_referent")).length ?? 0;
  return <section className="telegram-access-view" aria-labelledby="telegram-access-title">
    <div className="telegram-access-header">
      <div>
        <p className="telegram-access-eyebrow">Управление интеграциями</p>
        <h1 id="telegram-access-title">Доступ к Telegram-ботам</h1>
        <p>Один Telegram ID сотрудника, отдельное разрешение для каждого бота.</p>
      </div>
      <button type="button" className="telegram-access-secondary" onClick={() => void refresh()} disabled={loading}>
        Обновить список
      </button>
    </div>
    {registry ? <div className="telegram-access-overview" aria-label="Состояние привязок">
      <span><strong>{registry.people.length}</strong> действующих сотрудников</span>
      <span><strong>{verified}</strong> с действующим ID</span>
      <span><strong>{referentAccess}</strong> с доступом к AI Referent</span>
    </div> : null}
    <div className="telegram-access-guide">
      <span className="telegram-access-guide-icon" aria-hidden="true">↗</span>
      <p>Укажите Telegram ID, отметьте нужных ботов и сохраните строку. Для AI Hisobot также выберите контур и регион, а для руководства снимите обязанность сдавать отчёт. Чтобы получать сообщения, сотруднику нужно открыть чат с ботом и нажать «Старт».</p>
    </div>
    <label className="telegram-access-search">
      <span>Найти сотрудника</span>
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, логин или должность" />
    </label>
    {error ? <div className="telegram-access-page-error" role="alert">{error} <button type="button" onClick={() => void refresh()}>Повторить</button></div> : null}
    {loading && !registry ? <p className="telegram-access-loading" role="status">Загружаем сотрудников…</p> : null}
    {registry ? <div className="telegram-access-list" aria-label="Сотрудники и доступ к ботам">
      {people.length ? people.map((person) => <PersonAccessRow
        key={`${person.userId}:${refreshEpoch}`}
        person={person}
        bots={registry.bots}
        token={token}
        onSaved={(saved) => setRegistry((current) => current ? {
          ...current, people: current.people.map((item) => item.userId === saved.userId ? saved : item),
        } : current)}
      />) : <p className="telegram-access-empty">По этому запросу сотрудников нет.</p>}
    </div> : null}
  </section>;
}
