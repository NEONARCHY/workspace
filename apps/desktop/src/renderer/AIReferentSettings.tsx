import { formatRussianDateTime } from "./date-time-format";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { startVisiblePolling } from "./visible-polling";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AIReferentConfiguration, AIReferentConfigurationUpdate, WorkspacePerson } from "@yuksalish/contracts";
import { Button, Checkbox, Input } from "@fluentui/react-components";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { loadAIReferentConfiguration, saveAIReferentConfiguration } from "./workspace-api";

interface Props {
  readonly token: string;
  readonly people: readonly WorkspacePerson[];
  readonly readOnly?: boolean;
}

export function AIReferentSettings({ token, people, readOnly = false }: Props) {
  const [config, setConfig] = useState<AIReferentConfiguration>();
  const [draft, setDraft] = useState<AIReferentConfigurationUpdate>();
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  const reader = useRef<ReturnType<typeof startVisiblePolling> | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [checkedAt, setCheckedAt] = useState(0);
  const accounts = people.filter((person) => person.status === "active");

  const accept = useCallback((next: AIReferentConfiguration, force = false) => {
    setConfig(next);
    setCheckedAt(Date.now());
    if (!dirtyRef.current || force) {
      setDraft({ expectedRevision: next.revision, reviewers: next.reviewers.map((item) => ({
        key: item.key, username: item.username, telegramId: item.telegramId, enabled: item.enabled,
      })) });
      dirtyRef.current = false;
      setDirty(false);
    }
  }, []);

  const refresh = useCallback(() => reader.current?.refresh(), []);

  useEffect(() => {
    const poll = startVisiblePolling(signal => loadAIReferentConfiguration(token, signal), next => { accept(next); setError(""); },
      reason => setError(reason instanceof Error ? reason.message : "Не удалось загрузить настройки."), 15_000, () => busyRef.current);
    reader.current = poll;
    return () => { reader.current = undefined; poll(); };
  }, [accept, token]);

  const change = (index: number, patch: Partial<AIReferentConfigurationUpdate["reviewers"][number]>) => {
    dirtyRef.current = true;
    setDirty(true);
    setNotice("");
    setDraft((current) => current ? { ...current,
      reviewers: current.reviewers.map((item, i) => i === index ? { ...item, ...patch } : item),
    } : current);
  };

  const save = async () => {
    if (!draft || busyRef.current || readOnly) return;
    busyRef.current = true;
    reader.current?.invalidate();
    setSaving(true);
    setError("");
    try {
      accept(await saveAIReferentConfiguration(token, draft), true);
      setNotice("Сохранено. Робот применит настройки при следующем подключении. Новый Telegram ID нужно подтвердить через «Доступ к Telegram-ботам».");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить настройки.");
    } finally { busyRef.current = false; setSaving(false); }
  };

  return <section className="ai-referent-page ai-referent-settings" aria-label="Настройки согласующих">
    <div className="ai-referent-page-intro"><div><span className="ai-referent-eyebrow">Маршрут согласования</span><h2>Люди и каналы</h2>
      <p>Каждая роль связана с аккаунтом Workspace и, при необходимости, с личным Telegram. Должность не определяет право согласования.</p></div>
      {config ? <span className="ai-referent-page-aside">Действуют {config.reviewers.filter((item) => item.canApprove).length} из {config.reviewers.length} назначений</span> : null}
    </div>
    <p className="ai-referent-settings-explain">Изменения общие для Workspace и робота. Открытые письма маршрута получит новый согласующий; прежние решения останутся в истории.</p>
    {error ? <WorkspaceNotice tone="error" role="alert" className="ai-referent-feedback">{error}</WorkspaceNotice> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!draft ? <>{!error ? <LoadingSkeleton layout="form" label="Загружаем настройки" /> : null}<Button onClick={() => void refresh()}>Повторить</Button></> : null}
    {draft && config ? <>
      {draft.expectedRevision !== config.revision ? <WorkspaceNotice tone="warning" role="status" className="ai-referent-feedback">
        Настройки изменены на другом устройстве. Ваш ввод сохранён; сравните его с актуальной версией перед повторным сохранением.
      </WorkspaceNotice> : null}
      <div className="ai-referent-settings-grid">
        {draft.reviewers.map((item, index) => {
          const saved = config.reviewers.find((row) => row.key === item.key);
          const person = accounts.find((row) => row.username === item.username);
          return <fieldset key={item.key} disabled={saving || readOnly} className="ai-referent-reviewer-card">
            <legend>{saved?.label || item.key}</legend>
            <span className={`ai-referent-reviewer-state ${saved?.canApprove ? "active" : ""}`}>{saved?.canApprove ? "Может согласовывать" : "Пока недоступен"}</span>
            <label>Аккаунт Workspace<WorkspaceSelect aria-label={`Аккаунт ${saved?.label}`}
              value={item.username} onChange={(event) => change(index, { username: event.target.value })}>
              <option value="">Выберите сотрудника</option>
              {item.username && !person ? <option value={item.username}>@{item.username} — недоступен</option> : null}
              {accounts.map((account) => <option key={account.id} value={account.username}>
                {account.name} · @{account.username}
              </option>)}
            </WorkspaceSelect></label>
            {!item.username ? <small>Первоначальный аккаунт: @{saved?.suggestedUsername}</small> : null}
            <label>Telegram ID<Input aria-label={`Telegram ID ${saved?.label}`} inputMode="numeric"
              value={item.telegramId ?? ""} onChange={(_event, data) => change(index, { telegramId: data.value.trim() || null })} />
            </label>
            <small>Новый ID подтверждается в «Доступе к Telegram-ботам». Там же выдаётся отдельный доступ к боту; право согласования остаётся здесь.</small>
            <Checkbox checked={item.enabled} label="Разрешить согласование"
              onChange={(_event, data) => change(index, { enabled: data.checked === true })} />
            {saved?.enabled && !saved.canApprove ? <small>
              Назначение не действует: аккаунт неактивен или согласование запрещено правами модуля.
            </small> : null}
          </fieldset>;
        })}
      </div>
      <div className="ai-referent-settings-actions">
        <Button appearance="primary" disabled={readOnly || !dirty || saving || draft.expectedRevision !== config.revision}
          onClick={() => void save()}>{saving ? "Сохраняем…" : "Сохранить настройки"}</Button>
        <Button disabled={saving || !dirty} onClick={() => { accept(config, true); setError(""); setNotice(""); }}>
          {dirty ? "Сбросить ввод к актуальной версии" : "Настройки актуальны"}
        </Button>
        <small>Версия {config.revision}</small>
      </div>
      <div className="ai-referent-runtime-status" aria-live="polite">
        <h3>Применение на ПК референта</h3>
        {config.runtimes.length === 0 ? <p>Робот ещё не подтвердил применение настроек.</p> : config.runtimes.map((runtime) =>
          <p key={runtime.agentId}>{runtime.agentName}: {runtime.error || (runtime.appliedRevision === config.revision
            ? `применена версия ${runtime.appliedRevision}` : `ожидает обновления до версии ${config.revision}`)}
            {checkedAt - new Date(runtime.lastSeenAt).getTime() > 90_000 ? " · давно не выходил на связь" : ""}
            {runtime.appliedAt ? ` · ${formatRussianDateTime(new Date(runtime.appliedAt))}` : ""}</p>)}
      </div>
    </> : null}
  </section>;
}
