import { useState } from "react";
import { Button, Textarea } from "@fluentui/react-components";
import type {
  AIReferentAction,
  AIReferentMailingRecipient,
  AIReferentMailingRecipientInput,
  AIReferentRecipient,
  AIReferentRoute,
} from "@yuksalish/contracts";
import { AIReferentRecipientPicker } from "./AIReferentRecipientPicker";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { WorkspaceSelect } from "./WorkspaceSelect";

const emailPattern = /^[A-Za-z0-9_][A-Za-z0-9._%+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/;

function emailRoute(address: string): AIReferentRoute {
  return address.toLowerCase().endsWith("@exat.uz") ? "exat" : "webmail";
}

function channelName(route: AIReferentRoute) {
  return route === "exat" ? "E-XAT" : "Webmail";
}

export type MailingDraftRecipient = AIReferentMailingRecipientInput & { readonly route: AIReferentRoute };

interface EditorProps {
  readonly token: string;
  readonly recipients: readonly MailingDraftRecipient[];
  readonly onChange: (recipients: readonly MailingDraftRecipient[]) => void;
  readonly disabled: boolean;
}

export function AIReferentMailingEditor({ token, recipients, onChange, disabled }: EditorProps) {
  const [directory, setDirectory] = useState<AIReferentRecipient>();
  const [organization, setOrganization] = useState("");
  const [address, setAddress] = useState("");
  const [pickerVersion, setPickerVersion] = useState(0);
  const [bulk, setBulk] = useState("");
  const [error, setError] = useState("");

  function add(items: readonly MailingDraftRecipient[]) {
    const seen = new Set(recipients.map((item) => item.address.toLowerCase()));
    for (const item of items) {
      const key = item.address.toLowerCase();
      if (seen.has(key)) { setError(`Адрес ${item.address} уже есть в списке.`); return false; }
      seen.add(key);
    }
    if (seen.size > 50) { setError("В рассылке может быть до 50 адресатов."); return false; }
    onChange([...recipients, ...items]);
    setError("");
    return true;
  }

  function addSelected() {
    const value = address.trim();
    if (!value || (!emailPattern.test(value) && (!directory || value.includes("@")))) {
      setError("Выберите адрес из справочника или введите корректный email.");
      return;
    }
    const route = emailPattern.test(value) ? emailRoute(value) : directory?.route;
    if (!route) return;
    if (add([{ address: value, organization: organization.trim() || value, directoryId: directory?.id, route }])) {
      setDirectory(undefined);
      setOrganization("");
      setAddress("");
      setPickerVersion((version) => version + 1);
    }
  }

  function addBulk() {
    const addresses = bulk.split(/[\s,;]+/).filter(Boolean);
    const invalid = addresses.find((value) => !emailPattern.test(value));
    if (invalid) { setError(`Проверьте адрес ${invalid}.`); return; }
    if (addresses.length && add(addresses.map((value) => ({
      address: value, organization: value, route: emailRoute(value),
    })))) setBulk("");
  }

  return <section className="ai-referent-mailing-editor" aria-label="Адресаты рассылки">
    <AIReferentRecipientPicker
      key={pickerVersion}
      token={token}
      organization={organization}
      address={address}
      onSelect={(entry) => {
        setDirectory(entry);
        setOrganization(entry.addressBookOrganization || entry.name);
        setAddress(entry.addresses.length === 1 ? entry.addresses[0] ?? "" : "");
        setError("");
      }}
      onManualChange={(name, value) => { setDirectory(undefined); setOrganization(name); setAddress(value); }}
    />
    {directory && directory.addresses.length > 1 ? <label>
      Адрес организации
      <WorkspaceSelect aria-label="Адрес организации" value={address} disabled={disabled} onChange={(event) => setAddress(event.target.value)}>
        <option value="">Выберите адрес</option>
        {directory.addresses.map((value) => <option key={value} value={value}>{value}</option>)}
      </WorkspaceSelect>
    </label> : null}
    <Button disabled={disabled || !address.trim()} onClick={addSelected}>Добавить получателя</Button>
    <label>Вставить список email
      <Textarea value={bulk} disabled={disabled} onChange={(_event, data) => setBulk(data.value)} />
    </label>
    <Button disabled={disabled || !bulk.trim()} onClick={addBulk}>Добавить список</Button>
    {error ? <WorkspaceNotice tone="error" role="alert">{error}</WorkspaceNotice> : null}
    <strong aria-live="polite">Получатели · {recipients.length}</strong>
    {recipients.length ? <ul className="ai-referent-mailing-list">
      {recipients.map((item) => <li key={item.address.toLowerCase()}>
        <span>{item.organization === item.address ? item.address : `${item.organization} · ${item.address}`}
          <small>{channelName(item.route)}</small>
        </span>
        <Button size="small" disabled={disabled} aria-label={`Убрать ${item.address}`}
          onClick={() => onChange(recipients.filter((recipient) => recipient !== item))}>Убрать</Button>
      </li>)}
    </ul> : null}
    <small>От 2 до 50 адресатов. Все получат один и тот же документ и приложения.</small>
  </section>;
}

type RecipientAction = Extract<AIReferentAction, "retry_recipient" | "confirm_recipient_sent" | "confirm_recipient_not_sent">;
const resultLabels: Readonly<Record<AIReferentMailingRecipient["status"], string>> = {
  draft: "Ожидает согласования",
  queued: "В очереди",
  sending: "Отправляется",
  sent: "Отправка подтверждена",
  failed: "Ошибка отправки",
  unknown: "Результат неизвестен",
  stopped: "Остановлено",
};

const recipientActionLabels: Readonly<Record<RecipientAction, string>> = {
  retry_recipient: "Повторить отправку",
  confirm_recipient_sent: "Отправка подтверждена",
  confirm_recipient_not_sent: "Письмо не отправлено",
};

export function isMailingRecipientAction(action: AIReferentAction): action is RecipientAction {
  return action === "retry_recipient" || action === "confirm_recipient_sent" || action === "confirm_recipient_not_sent";
}

interface ResultsProps {
  readonly recipients: readonly AIReferentMailingRecipient[];
  readonly actions: readonly AIReferentAction[];
  readonly disabled: boolean;
  readonly onAction: (action: RecipientAction, recipientId: string, comment: string) => Promise<boolean>;
}

export function AIReferentMailingResults({ recipients, actions, disabled, onAction }: ResultsProps) {
  const [decision, setDecision] = useState<{ recipient: AIReferentMailingRecipient; action: RecipientAction }>();
  const [comment, setComment] = useState("");
  const sent = recipients.filter((recipient) => recipient.status === "sent").length;

  return <section className="ai-referent-detail-card ai-referent-mailing-results" aria-label="Получатели рассылки">
    <h3>Получатели · {recipients.length}</h3>
    <p>Отправка подтверждена для {sent} из {recipients.length}. Отправитель — организационный ящик референта.</p>
    <div className="ai-referent-mailing-table" role="region" aria-label="Результаты отправки" tabIndex={0}>
      <table>
        <thead><tr><th scope="col">Адресат</th><th scope="col">Канал</th><th scope="col">Результат</th></tr></thead>
        <tbody>{recipients.map((recipient) => {
          const rowActions = actions.filter(isMailingRecipientAction).filter((action) =>
            action === "retry_recipient" ? recipient.status === "failed" : recipient.status === "unknown");
          return <tr key={recipient.id}>
            <td>{recipient.organization === recipient.address ? null : <strong>{recipient.organization}</strong>}
              {recipient.address}
            </td>
            <td>{channelName(recipient.route)}</td>
            <td><strong>{recipient.status === "sent" && recipient.route === "webmail"
              ? "Принято почтовым сервисом" : resultLabels[recipient.status]}</strong>
              {recipient.detail ? <small>{recipient.detail}</small> : null}
              {recipient.attempts ? <small>Попыток · {recipient.attempts}</small> : null}
              {rowActions.map((action) => <Button key={action} size="small" disabled={disabled}
                aria-label={`${recipientActionLabels[action]} · ${recipient.address}`}
                onClick={() => { setComment(""); setDecision({ recipient, action }); }}>
                {recipientActionLabels[action]}
              </Button>)}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {decision ? <div className="ai-referent-mailing-decision">
      <strong>{recipientActionLabels[decision.action]} · {decision.recipient.address}</strong>
      <label>{decision.action === "retry_recipient" ? "Основание для повторной отправки" : "Результат сверки с внешним журналом"}
        <Textarea value={comment} disabled={disabled} onChange={(_event, data) => setComment(data.value)} />
      </label>
      <Button disabled={disabled || comment.trim().length < 12} appearance="primary" onClick={() => {
        void onAction(decision.action, decision.recipient.id, comment).then((saved) => {
          if (saved) setDecision(undefined);
        });
      }}>Подтвердить</Button>
      <Button disabled={disabled} onClick={() => setDecision(undefined)}>Отмена</Button>
    </div> : null}
  </section>;
}
