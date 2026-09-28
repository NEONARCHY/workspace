import { useCallback, useEffect, useRef, useState } from "react";

import type { AIReferentManualRecipientInput, AIReferentRecipient } from "@yuksalish/contracts";
import { Button, Input, Spinner } from "@fluentui/react-components";

import { WorkspaceSelect } from "./WorkspaceSelect";
import {
  addAIReferentManualRecipient,
  loadAIReferentManualRecipients,
  removeAIReferentManualRecipient,
} from "./workspace-api";

interface Props {
  readonly token: string;
  readonly readOnly: boolean;
}

const categoryNames: Record<AIReferentRecipient["categoryKey"], string> = {
  ministries: "Министерство",
  agencies: "Агентство",
  committees: "Комитет",
  international: "Международная организация",
  other: "Другая организация",
};
const categoryKeys: readonly AIReferentRecipient["categoryKey"][] = [
  "ministries", "agencies", "committees", "international", "other",
];

const initialDraft: AIReferentManualRecipientInput = {
  name: "", address: "", categoryKey: "other",
};

export function AIReferentAddressBook({ token, readOnly }: Props) {
  const [entries, setEntries] = useState<readonly AIReferentRecipient[]>([]);
  const [draft, setDraft] = useState<AIReferentManualRecipientInput>(initialDraft);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await loadAIReferentManualRecipients(token));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить адресную книгу.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { queueMicrotask(() => { void refresh(); }); }, [refresh]);

  const save = async () => {
    if (busyRef.current || readOnly) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const entry = await addAIReferentManualRecipient(token, {
        ...draft, name: draft.name.trim(), address: draft.address.trim(),
      });
      setEntries((current) => [entry, ...current]);
      setDraft(initialDraft);
      setNotice("Адрес добавлен. Он доступен сотрудникам в Workspace и Telegram; автономная копия бота обновится при синхронизации.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось добавить адрес.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const remove = async (entry: AIReferentRecipient) => {
    if (busyRef.current || readOnly || !entry.id.startsWith("manual-")) return;
    if (!window.confirm(`Убрать «${entry.name}» из общего справочника? Уже созданные письма не изменятся.`)) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await removeAIReferentManualRecipient(token, entry.id.slice("manual-".length));
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setNotice("Адрес убран из общего справочника. Бот обновит автономную копию при синхронизации.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось удалить адрес.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const route = draft.address.trim().toLowerCase().endsWith("@exat.uz") ? "E-XAT" : "Webmail";
  return <section className="ai-referent-page ai-referent-address-book" aria-label="Адресная книга AI Referent">
    <div className="ai-referent-page-intro"><div>
      <span className="ai-referent-eyebrow">Общий справочник</span>
      <h2>Адресная книга</h2>
      <p>Добавленные здесь организации видят все сотрудники в поиске получателя — и в Workspace, и в Telegram-боте.</p>
    </div><span className="ai-referent-page-aside">{entries.length} добавлено администраторами</span></div>
    <div className="ai-referent-address-layout">
      <form className="ai-referent-address-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <h3>Новый адресат</h3>
        <p>Проверьте адрес перед сохранением. Домен @exat.uz направляет письмо через E-XAT, остальные — через Webmail.</p>
        <label>Название организации<Input required maxLength={300} disabled={readOnly || busy}
          value={draft.name} onChange={(_event, data) => setDraft((current) => ({ ...current, name: data.value }))} /></label>
        <label>E-XAT-адрес или email<Input required type="email" maxLength={500} disabled={readOnly || busy}
          value={draft.address} onChange={(_event, data) => setDraft((current) => ({ ...current, address: data.value }))} /></label>
        <label>Категория<WorkspaceSelect disabled={readOnly || busy} value={draft.categoryKey}
          onChange={(event) => {
            const key = categoryKeys.find((candidate) => candidate === event.target.value);
            if (key) setDraft((current) => ({ ...current, categoryKey: key }));
          }}>
          {categoryKeys.map((key) => <option key={key} value={key}>{categoryNames[key]}</option>)}
        </WorkspaceSelect></label>
        <div className="ai-referent-address-form-footer"><span>Канал: {route}</span>
          <Button appearance="primary" type="submit" disabled={readOnly || busy || !draft.name.trim() || !draft.address.trim()}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </Button></div>
      </form>
      <div className="ai-referent-address-list" aria-label="Адресаты, добавленные администраторами">
        <div className="ai-referent-address-list-heading"><h3>Добавленные организации</h3>
          <Button appearance="subtle" disabled={loading || busy} onClick={() => void refresh()}>Обновить</Button></div>
        {loading ? <Spinner label="Загружаем адресатов" /> : null}
        {!loading && !entries.length ? <p className="ai-referent-address-empty">Пока нет добавленных адресов. Справочник робота продолжает работать как прежде.</p> : null}
        {entries.map((entry) => <div className="ai-referent-address-row" key={entry.id}>
          <span className="ai-referent-address-mark" aria-hidden="true">{entry.name.slice(0, 1)}</span>
          <span className="ai-referent-address-copy"><strong>{entry.name}</strong><small>{entry.addresses[0]} · {entry.route === "exat" ? "E-XAT" : "Webmail"}</small></span>
          {!readOnly ? <Button appearance="subtle" disabled={busy} aria-label={`Удалить адрес ${entry.name}`}
            onClick={() => void remove(entry)}>Удалить</Button> : null}
        </div>)}
      </div>
    </div>
    {error ? <p className="ai-referent-feedback" role="alert">{error}</p> : null}
    {notice ? <p className="ai-referent-feedback" role="status">{notice}</p> : null}
  </section>;
}
