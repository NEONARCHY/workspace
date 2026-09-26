import { useEffect, useState } from "react";

import type { AIReferentRecipient, AIReferentRecipientRegistry } from "@yuksalish/contracts";
import { Input, Spinner } from "@fluentui/react-components";

import { AIReferentGooeySearch } from "./AIReferentGooeySearch";
import { loadAIReferentRecipients } from "./workspace-api";

const categories = [
  ["", "Все"],
  ["ministries", "Министерства"],
  ["agencies", "Агентства"],
  ["committees", "Комитеты"],
  ["international", "Международные"],
  ["other", "Другие"],
] as const;

interface RecipientPickerProps {
  readonly token: string;
  readonly organization: string;
  readonly address: string;
  readonly onSelect: (recipient: AIReferentRecipient) => void;
  readonly onManualChange: (organization: string, address: string) => void;
}

export function AIReferentRecipientPicker({
  token, organization, address, onSelect, onManualChange,
}: RecipientPickerProps) {
  const [mode, setMode] = useState<"search" | "selected" | "manual">(
    () => organization || address ? "selected" : "search",
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<AIReferentRecipientRegistry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (mode !== "search") return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void loadAIReferentRecipients(token, { query, category, offset })
        .then((data) => {
          if (!active) return;
          setResult(data);
        })
        .catch(() => {
          if (!active) return;
          setError("Не удалось загрузить адресную книгу. Можно повторить или ввести адрес вручную.");
        })
        .finally(() => { if (active) setLoading(false); });
    }, query ? 180 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [token, mode, query, category, offset, retry]);

  const changeQuery = (value: string) => { setQuery(value); setOffset(0); setResult(null); };
  const changeCategory = (value: string) => { setCategory(value); setOffset(0); setResult(null); };
  const choose = (recipient: AIReferentRecipient) => {
    if (!recipient.addresses.length) return;
    onSelect(recipient);
    setMode("selected");
  };

  return (
    <section className="ai-referent-recipient-picker" aria-label="Получатель письма">
      <div className="ai-referent-picker-heading">
        <div><strong>Кому отправить</strong><small>Адресная книга Exat · общая с Telegram-ботом</small></div>
        {mode === "selected" ? <button type="button" onClick={() => setMode("search")}>Изменить</button> : null}
        {mode === "manual" ? <button type="button" onClick={() => setMode("search")}>Найти в справочнике</button> : null}
      </div>
      {mode === "selected" ? (
        <div className="ai-referent-picker-selected">
          <span className="ai-referent-picker-symbol" aria-hidden="true">↗</span>
          <span><strong>{organization || "Организация не указана"}</strong><small>{address || "Адрес не указан"}</small></span>
        </div>
      ) : null}
      {mode === "manual" ? (
        <div className="ai-referent-picker-manual">
          <label>Организация-получатель<Input value={organization} onChange={(_event, data) => onManualChange(data.value, address)} /></label>
          <label>Адрес или получатель<Input value={address} onChange={(_event, data) => onManualChange(organization, data.value)} /></label>
          <small>Проверьте адрес и канал отправки перед согласованием.</small>
        </div>
      ) : null}
      {mode === "search" ? (
        <div className="ai-referent-picker-search">
          <AIReferentGooeySearch
            value={query}
            onValueChange={changeQuery}
            placeholder="Название организации или адрес"
            ariaLabel="Поиск адресата"
            autoComplete="off"
            collapsedWidth={290}
          />
          <div className="ai-referent-picker-categories" aria-label="Категории организаций">
            {categories.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={category === key} onClick={() => changeCategory(key)}>{label}</button>
            ))}
          </div>
          <div className="ai-referent-picker-results" aria-live="polite">
            {loading ? <div className="ai-referent-picker-message"><Spinner size="tiny" label="Ищем адресатов…" /></div> : null}
            {!loading && error ? <div className="ai-referent-picker-message" role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>Повторить</button></div> : null}
            {!loading && !error && result?.updatedAt === null ? <div className="ai-referent-picker-message">Справочник ещё не синхронизирован с ПК референта.</div> : null}
            {!loading && !error && result?.updatedAt && !result.entries.length ? <div className="ai-referent-picker-message">По этому запросу адресатов нет.</div> : null}
            {!loading && !error && result?.entries.map((entry) => (
              <button className="ai-referent-picker-result" type="button" key={entry.id} disabled={!entry.addresses.length} onClick={() => choose(entry)}>
                <span className="ai-referent-picker-result-mark" aria-hidden="true">{entry.name.slice(0, 1)}</span>
                <span><strong>{entry.name}</strong><small>{entry.addresses[0] || "Адрес пока не настроен"}</small></span>
                <em>{entry.route === "exat" ? "E-XAT" : "Webmail"}</em>
              </button>
            ))}
          </div>
          <div className="ai-referent-picker-bottom">
            <span>{result?.updatedAt ? `${result.totalCount} адресатов` : ""}</span>
            <div>
              {offset > 0 ? <button type="button" onClick={() => setOffset(Math.max(0, offset - 8))}>Назад</button> : null}
              {result && offset + result.entries.length < result.totalCount ? <button type="button" onClick={() => setOffset(offset + 8)}>Ещё →</button> : null}
              <button type="button" onClick={() => setMode("manual")}>Ввести вручную</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
