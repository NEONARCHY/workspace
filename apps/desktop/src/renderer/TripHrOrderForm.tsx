import { useId, useState } from "react";
import { Button, Textarea } from "@fluentui/react-components";
import type { TripOrderInput, TripRequest } from "@yuksalish/contracts";
import { Input } from "./WorkspaceInput";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";

export function TripHrOrderForm({ request, busy, onComplete, revision = false, registrationOnly = false }: {
  readonly request: TripRequest;
  readonly busy: boolean;
  readonly revision?: boolean;
  readonly registrationOnly?: boolean;
  readonly onComplete: (fields: TripOrderInput) => Promise<boolean>;
}) {
  const id = useId();
  const [fields, setFields] = useState<TripOrderInput>(() => ({
    orderNumber: (revision || registrationOnly) && !(request.orderManuallyRegistered ?? request.hrProcessingRequired)
      ? "" : request.orderNumber ?? "",
    orderSeries: request.orderSeries || "а/ф",
    orderPurpose: registrationOnly ? "" : request.orderPurpose || request.purpose,
  }));
  const [orderDate, setOrderDate] = useState(() => registrationOnly && request.orderIssuedAt
    ? new Date(request.orderIssuedAt).toLocaleDateString("sv-SE", { timeZone: "Asia/Tashkent" }) : "");
  const [error, setError] = useState("");
  const submit = async () => {
    if (busy) return;
    if (!fields.orderNumber.trim() || !fields.orderSeries.trim()) {
      setError("Укажите номер и серию приказа."); return;
    }
    setError("");
    await onComplete({ orderNumber: fields.orderNumber.trim(), orderSeries: fields.orderSeries.trim(),
      orderPurpose: fields.orderPurpose.trim(), ...(orderDate ? { orderDate } : {}) });
  };
  return <form className="trip-hr-order-form" aria-label={registrationOnly ? "Кадровые реквизиты приказа" : revision ? "Новая версия приказа" : "Кадровое оформление приказа"} aria-busy={busy}
    noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3>{registrationOnly ? "Номер, серия и дата приказа" : revision ? "Новая версия приказа" : "Оформление приказа"}</h3>
    <p>{registrationOnly ? "Меняются только реквизиты. Прежнее согласование, текст и подпись сохраняются; предыдущий PDF останется в истории. Начатое переоформление будет закрыто без новой резолюции." : "Укажите реквизиты бумажного приказа. Цель можно уточнить для приказа; текст билдирги сохранится."}</p>
    <div className="trip-hr-order-numbers">
      <label htmlFor={`${id}-number`}>Номер приказа *<Input id={`${id}-number`} maxLength={40} required
        value={fields.orderNumber} disabled={busy} onChange={(_, data) => setFields(current => ({ ...current, orderNumber: data.value }))} /></label>
      <label htmlFor={`${id}-series`}>Серия приказа *<Input id={`${id}-series`} maxLength={24} required
        value={fields.orderSeries} disabled={busy} onChange={(_, data) => setFields(current => ({ ...current, orderSeries: data.value }))} /></label>
    </div>
    <label>Дата приказа (необязательно)<WorkspaceDateTimePicker mode="date"
      ariaLabel="Дата приказа (необязательно)" value={orderDate} disabled={busy} onChange={setOrderDate} /></label>
    <p>{registrationOnly ? "Если дата не указана, сохранится прежняя дата приказа." : "Если дата не указана, будет использована текущая дата."}</p>
    {!registrationOnly ? <label htmlFor={`${id}-purpose`}>Цель поездки в приказе<Textarea id={`${id}-purpose`} maxLength={4000}
      value={fields.orderPurpose} disabled={busy} resize="vertical" rows={4}
      onChange={(_, data) => setFields(current => ({ ...current, orderPurpose: data.value }))} /></label> : null}
    {error && <WorkspaceNotice tone="error" role="alert">{error}</WorkspaceNotice>}
    <Button type="submit" appearance="primary" disabled={busy}>{busy ? "Оформляем…" : registrationOnly ? "Сохранить реквизиты" : revision ? "Сохранить новую версию" : "Оформлено"}</Button>
  </form>;
}
