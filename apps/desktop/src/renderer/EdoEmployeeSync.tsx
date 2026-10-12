import { useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import type { EdoEmployeeSyncStatus } from "@yuksalish/contracts";
import { loadEdoEmployeeSync, retryEdoEmployeeSync } from "./workspace-api";

const labels = {
  pending: "Ожидает синхронизации",
  synced: "Синхронизирован",
  retry: "Ожидает повтора",
  conflict: "Требует проверки",
} as const;

export function EdoEmployeeSync({ token }: { readonly token: string }) {
  return <EdoEmployeeSyncSession key={token} token={token} />;
}

function EdoEmployeeSyncSession({ token }: { readonly token: string }) {
  const [opened, setOpened] = useState(false);
  const [data, setData] = useState<EdoEmployeeSyncStatus>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    void loadEdoEmployeeSync(token).then((value) => {
      if (alive) { setData(value); setError(""); }
    }).catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : "Не удалось проверить синхронизацию.");
    });
    return () => { alive = false; };
  }, [opened, token, attempt]);

  const retry = async (userId: string) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await retryEdoEmployeeSync(token, userId);
      setNotice("Повтор поставлен в очередь. Это ещё не подтверждение синхронизации.");
      setAttempt((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось повторить синхронизацию.");
    } finally { pending.current = false; setBusy(false); }
  };

  return <details onToggle={(event) => setOpened(event.currentTarget.open)}>
    <summary>Синхронизация сотрудников с ЭДО</summary>
    {opened ? <div className="edo-access-form">
      <p>Личные привязки сохраняются. Новые сотрудники передаются автоматически после включения интеграции. Видимость писем настраивается отдельно.</p>
      <Button disabled={busy} onClick={() => setAttempt((value) => value + 1)}>Обновить синхронизацию</Button>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!data && !error ? <Spinner label="Проверяем синхронизацию сотрудников" /> : null}
      {data ? <>
        <p>{!data.enabled ? "Автоматическая синхронизация выключена." : !data.configured
          ? "Настройки подключения не готовы. Обратитесь к администратору сервера."
          : "Автоматическая синхронизация включена."}</p>
        {!data.entries.length ? <p>Заданий синхронизации пока нет.</p> : <ul>
          {data.entries.map((item) => <li key={item.userId}>
            {item.name} — {labels[item.status]}{item.edoUserId !== null ? ` · ID ЭДО ${item.edoUserId}` : ""}
            {item.lastErrorCode ? ` · ${item.lastErrorCode}` : ""}
            {item.status === "retry" || item.status === "conflict" ? <Button
              aria-label={`Повторить синхронизацию: ${item.name}`}
              disabled={busy || !data.enabled || !data.configured || item.lastErrorCode === "invalid_snapshot"}
              onClick={() => void retry(item.userId)}>Повторить</Button> : null}
          </li>)}
        </ul>}
      </> : null}
    </div> : null}
  </details>;
}
