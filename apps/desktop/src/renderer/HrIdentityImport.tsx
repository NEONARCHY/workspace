import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Field, Input, Spinner } from "@fluentui/react-components";
import { DocumentSearch20Regular, Dismiss20Regular } from "@fluentui/react-icons";
import type { HiringFields, IdentityRecognition } from "@yuksalish/contracts";
import { recognizeHiringIdentity } from "./workspace-api";

type IdentityFields = Pick<HiringFields, "fullName" | "pinfl" | "passport">;
const fieldLabels: Record<keyof IdentityFields, string> = {
  fullName: "ФИО с ID-карты", pinfl: "JSHSHIR с ID-карты", passport: "Серия и номер ID-карты",
};
const keys = ["fullName", "pinfl", "passport"] as const;

export function mergeIdentityResults(results: readonly IdentityRecognition[]): IdentityRecognition {
  const values = (key: keyof IdentityFields) => [...new Set(results.map(item => item[key]).filter(value => value !== null))];
  const conflicts = keys.filter(key => values(key).length > 1);
  return {
    fullName: values("fullName").length === 1 ? values("fullName")[0]! : null,
    pinfl: values("pinfl").length === 1 ? values("pinfl")[0]! : null,
    passport: values("passport").length === 1 ? values("passport")[0]! : null,
    warnings: [...new Set(results.flatMap(item => item.warnings)),
      ...conflicts.map(key => `${fieldLabels[key]}: стороны карты дают разные значения — заполните вручную.`)],
  };
}

export function HrIdentityImport({ token, current, disabled, onApply }: {
  readonly token: string; readonly current: IdentityFields; readonly disabled: boolean;
  readonly onApply: (values: Partial<IdentityFields>) => void;
}) {
  const chooser = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const [files, setFiles] = useState<readonly File[]>([]);
  const [previews, setPreviews] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<IdentityRecognition>();
  const [values, setValues] = useState<IdentityFields>({ fullName: "", pinfl: "", passport: "" });
  const [chosen, setChosen] = useState<Record<keyof IdentityFields, boolean>>({ fullName: false, pinfl: false, passport: false });
  const [checked, setChecked] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => () => previews.forEach(url => URL.revokeObjectURL(url)), [previews]);
  const clear = () => { setFiles([]); setPreviews([]); setResult(undefined); setError(undefined); setChecked(false); };
  const analyse = async () => {
    if (!files.length || busy || disabled) return;
    setBusy(true); setError(undefined); setChecked(false);
    try {
      const results: IdentityRecognition[] = [];
      for (const file of files) results.push(await recognizeHiringIdentity(token, file));
      if (!active.current) return;
      const merged = mergeIdentityResults(results);
      setResult(merged);
      setValues({ fullName: merged.fullName ?? "", pinfl: merged.pinfl ?? "", passport: merged.passport ?? "" });
      setChosen({ fullName: false, pinfl: false, passport: false });
    } catch (value) {
      if (active.current) setError(value instanceof Error ? value.message : "Не удалось распознать ID-карту");
    } finally { if (active.current) setBusy(false); }
  };
  const selectedKeys = keys.filter(key => chosen[key]);
  const valid = selectedKeys.length > 0 && selectedKeys.every(key => values[key].trim())
    && (!chosen.pinfl || /^\d{14}$/.test(values.pinfl));
  return <section className="hr-identity" aria-label="Заполнение по ID-карте">
    <div className="hr-identity-heading"><DocumentSearch20Regular aria-hidden="true" /><div><h4>Заполнить по ID-карте</h4>
      <p>Фото лицевой и обратной стороны · JPEG/PNG до 5 МиБ каждое. Обработка только на сервере Workspace, без внешнего ИИ.</p></div></div>
    <input hidden ref={chooser} type="file" multiple accept="image/jpeg,image/png" aria-label="Фото ID-карты"
      onChange={event => {
        const selected = Array.from(event.target.files ?? []); event.target.value = "";
        if (!selected.length) return;
        if (selected.length > 2 || selected.some(file => file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(file.type))) {
          setError("Выберите одно или два фото JPEG/PNG, не больше 5 МиБ каждое"); return;
        }
        setFiles(selected); setPreviews(selected.map(file => URL.createObjectURL(file)));
        setResult(undefined); setChecked(false); setError(undefined);
      }} />
    <div className="hr-hiring-buttons"><Button disabled={disabled || busy} onClick={() => chooser.current?.click()}>Добавить фото ID-карты</Button>
      {files.length ? <><Button appearance="primary" disabled={disabled || busy} onClick={() => void analyse()}>{result ? "Распознать повторно" : "Распознать данные"}</Button>
        <Button icon={<Dismiss20Regular />} disabled={busy || disabled} onClick={clear}>Убрать фото</Button></> : null}</div>
    {files.length ? <div className="hr-identity-photos">{files.map((file, index) => <figure key={`${file.name}-${index}`}>
      {previews[index] ? <img src={previews[index]} alt={`Фото ID-карты, сторона ${index + 1}`} /> : null}<figcaption>Сторона {index + 1}</figcaption></figure>)}</div> : null}
    {busy ? <Spinner label="Распознаём ID-карту локально…" /> : null}
    {error ? <p role="alert">{error} Ручное заполнение остаётся доступным.</p> : null}
    {result ? <div className="hr-identity-review"><h4>Проверьте по оригиналу карты</h4>
      {result.warnings.length ? <ul>{result.warnings.map(message => <li key={message}>{message}</li>)}</ul> : null}
      {keys.map(key => <div className="hr-identity-field" key={key}>
        <Checkbox disabled={disabled || busy} checked={chosen[key]} label={current[key] ? `Заменить заполненное поле: ${fieldLabels[key]}` : `Применить: ${fieldLabels[key]}`}
          onChange={(_, data) => { setChosen({ ...chosen, [key]: data.checked === true }); setChecked(false); }} />
        <Field label={fieldLabels[key]}><Input disabled={disabled || busy} value={values[key]} maxLength={key === "pinfl" ? 14 : 100}
          onChange={(_, data) => { setValues({ ...values, [key]: data.value }); setChecked(false); }} /></Field>
        {current[key] ? <small>Сейчас: {current[key]}</small> : null}
      </div>)}
      <Checkbox disabled={disabled || busy} checked={checked} label="Данные проверены по оригиналу ID-карты"
        onChange={(_, data) => setChecked(data.checked === true)} />
      <Button appearance="primary" disabled={disabled || busy || !checked || !valid} onClick={() => {
        const applied: Partial<IdentityFields> = {
          ...(chosen.fullName ? { fullName: values.fullName.trim() } : {}),
          ...(chosen.pinfl ? { pinfl: values.pinfl.trim() } : {}),
          ...(chosen.passport ? { passport: values.passport.trim() } : {}),
        };
        onApply(applied); clear();
      }}>Применить выбранные поля</Button>
    </div> : null}
    <small>Фото временное: не сохраняется в кадровом пакете. Распознавание не проверяет подлинность документа.</small>
  </section>;
}
