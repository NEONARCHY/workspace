import { useId, useState } from "react";
import { Button, Textarea } from "@fluentui/react-components";
import type { TripOrderInput, TripRequest } from "@yuksalish/contracts";
import { Input } from "./WorkspaceInput";
import { WorkspaceNotice } from "./WorkspaceNotice";

export function TripHrOrderForm({ request, busy, onComplete }: {
  readonly request: TripRequest;
  readonly busy: boolean;
  readonly onComplete: (fields: TripOrderInput) => Promise<boolean>;
}) {
  const id = useId();
  const [fields, setFields] = useState<TripOrderInput>(() => ({
    orderNumber: request.orderNumber ?? "", orderSeries: request.orderSeries || "а/ф",
    orderPurpose: request.orderPurpose || request.purpose,
  }));
  const [error, setError] = useState("");
  const submit = async () => {
    if (busy) return;
    if (!fields.orderNumber.trim() || !fields.orderSeries.trim()) {
      setError("Укажите номер и серию приказа."); return;
    }
    setError("");
    await onComplete({ orderNumber: fields.orderNumber.trim(), orderSeries: fields.orderSeries.trim(),
      orderPurpose: fields.orderPurpose.trim() });
  };
  return <form className="trip-hr-order-form" aria-label="Кадровое оформление приказа" aria-busy={busy}
    noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3>Оформление приказа</h3>
    <p>Укажите реквизиты бумажного приказа. Цель можно уточнить для приказа; текст билдирги сохранится.</p>
    <div className="trip-hr-order-numbers">
      <label htmlFor={`${id}-number`}>Номер приказа *<Input id={`${id}-number`} maxLength={40} required
        value={fields.orderNumber} disabled={busy} onChange={(_, data) => setFields(current => ({ ...current, orderNumber: data.value }))} /></label>
      <label htmlFor={`${id}-series`}>Серия приказа *<Input id={`${id}-series`} maxLength={24} required
        value={fields.orderSeries} disabled={busy} onChange={(_, data) => setFields(current => ({ ...current, orderSeries: data.value }))} /></label>
    </div>
    <label htmlFor={`${id}-purpose`}>Цель поездки в приказе<Textarea id={`${id}-purpose`} maxLength={4000}
      value={fields.orderPurpose} disabled={busy} resize="vertical" rows={4}
      onChange={(_, data) => setFields(current => ({ ...current, orderPurpose: data.value }))} /></label>
    {error && <WorkspaceNotice tone="error" role="alert">{error}</WorkspaceNotice>}
    <Button type="submit" appearance="primary" disabled={busy}>{busy ? "Оформляем…" : "Оформлено"}</Button>
  </form>;
}
