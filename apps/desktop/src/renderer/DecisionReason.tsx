import { useState } from "react";
import { Button, Textarea } from "@fluentui/react-components";

/** Electron does not support window.prompt; decisions use a nonblocking form. */
export function DecisionReason({ title, onConfirm, onCancel }: {
  readonly title: string;
  readonly onConfirm: (reason: string) => Promise<boolean>;
  readonly onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (busy || !reason.trim()) return;
    setBusy(true);
    setError("");
    try { if (await onConfirm(reason.trim())) onCancel(); else setError("Не удалось сохранить решение. Обновите данные и проверьте состояние заявки."); }
    catch (error) { setError(error instanceof Error ? error.message : "Не удалось сохранить решение."); }
    finally { setBusy(false); }
  };
  return <form className="decision-reason" aria-label={title} onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <strong>{title}</strong>
    <Textarea aria-label="Причина решения" value={reason} onChange={(_, data) => setReason(data.value)} disabled={busy} />
    {error ? <p role="alert">{error}</p> : null}
    <div><Button type="submit" appearance="primary" disabled={busy || !reason.trim()}>Подтвердить решение</Button><Button type="button" disabled={busy} onClick={onCancel}>Отмена</Button></div>
  </form>;
}
