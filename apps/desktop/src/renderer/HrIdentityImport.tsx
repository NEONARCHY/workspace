import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Field, Input, Spinner } from "@fluentui/react-components";
import { DocumentSearch20Regular, Dismiss20Regular } from "@fluentui/react-icons";
import type { HiringFields, IdentityRecognition } from "@yuksalish/contracts";
import { recognizeHiringIdentity } from "./workspace-api";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions } from "@fluentui/react-components";

type IdentityFields = Pick<HiringFields, "fullName" | "pinfl" | "passport">;
const fieldLabels: Record<keyof IdentityFields, string> = {
  fullName: "ФИО с ID-карты", pinfl: "JSHSHIR с ID-карты", passport: "Серия и номер ID-карты",
};
const keys = ["fullName", "pinfl", "passport"] as const;

export function mergeIdentityResults(results: readonly IdentityRecognition[]): IdentityRecognition {
  const values = (key: keyof IdentityFields) => [...new Set(results.map(item => item[key]).filter(value => value !== null))];
  const canonical = (value: string) => value.toUpperCase().replace(/[^\p{L} ]/gu, "");
  const named = results.filter(item => item.fullName);
  const longest = [...named].sort((a, b) => (b.fullName?.length ?? 0) - (a.fullName?.length ?? 0)
    || Number(b.nameComplete !== false) - Number(a.nameComplete !== false))[0];
  const compatible = longest && named.every(item => canonical(item.fullName!) === canonical(longest.fullName!)
    || (item.nameComplete === false && canonical(longest.fullName!).startsWith(canonical(item.fullName!) + " ")));
  const fullName = compatible ? longest.fullName : null;
  const conflicts = keys.filter(key => key === "fullName" ? named.length > 0 && !fullName : values(key).length > 1);
  const missing = keys.filter(key => key === "fullName" ? !fullName : values(key).length !== 1);
  const complete = compatible ? longest.nameComplete !== false : false;
  return {
    fullName,
    nameComplete: complete,
    pinfl: values("pinfl").length === 1 ? values("pinfl")[0]! : null,
    passport: values("passport").length === 1 ? values("passport")[0]! : null,
    warnings: [
      ...conflicts.map(key => `${fieldLabels[key]}: стороны карты дают разные значения — заполните вручную.`),
      ...missing.filter(key => !conflicts.includes(key)).map(key => `${fieldLabels[key]} не найдено. Добавьте нужную сторону карты или заполните вручную.`),
      ...(fullName && !complete ? ["Отчество и написание имени нужно сверить и дополнить по лицевой стороне карты."] : []),
    ],
  };
}

export function HrIdentityImport({ token, current, disabled, onApply }: {
  readonly token: string; readonly current: IdentityFields; readonly disabled: boolean;
  readonly onApply: (values: Partial<IdentityFields>) => void;
}) {
  const chooser = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const objectUrls = useRef(new Set<string>());
  const previewUrl = (file: File) => { const url = URL.createObjectURL(file); objectUrls.current.add(url); return url; };
  const releaseUrl = (url: string) => { URL.revokeObjectURL(url); objectUrls.current.delete(url); };
  const [files, setFiles] = useState<readonly File[]>([]);
  const [previews, setPreviews] = useState<readonly string[]>([]);
  const [rotations, setRotations] = useState<readonly number[]>([]);
  const [photoLabels, setPhotoLabels] = useState<readonly string[]>([]);
  const [uploadKind, setUploadKind] = useState<"auto" | "front" | "back" | "combined">("auto");
  const [expanded, setExpanded] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<IdentityRecognition>();
  const [values, setValues] = useState<IdentityFields>({ fullName: "", pinfl: "", passport: "" });
  const [chosen, setChosen] = useState<Record<keyof IdentityFields, boolean>>({ fullName: false, pinfl: false, passport: false });
  const [checked, setChecked] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { const urls = objectUrls.current; return () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }; }, []);
  const clear = () => { previews.forEach(releaseUrl); setFiles([]); setPreviews([]); setRotations([]); setPhotoLabels([]); setResult(undefined); setError(undefined); setChecked(false); setExpanded(undefined); };
  const choosePhoto = (kind: typeof uploadKind) => {
    setUploadKind(kind);
    if (chooser.current) { chooser.current.multiple = kind === "auto"; chooser.current.click(); }
  };
  const rotate = (index: number) => { setRotations(rotations.map((value, position) => position === index ? (value + 90) % 360 : value)); setResult(undefined); setChecked(false); };
  const analyse = async () => {
    if (!files.length || busy || disabled) return;
    setBusy(true); setError(undefined); setChecked(false);
    try {
      const results: IdentityRecognition[] = [];
      for (const [index, file] of files.entries()) results.push(await recognizeHiringIdentity(token, file, rotations[index] ?? 0));
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
      <p>Обе стороны в одном файле или два отдельных фото. JPEG/PNG до 5 МиБ каждое. Обработка локально, без внешнего ИИ.</p></div></div>
    <input hidden ref={chooser} disabled={disabled || busy} type="file" multiple accept="image/jpeg,image/png" aria-label="Фото ID-карты"
      onChange={event => {
        if (busy || disabled) return;
        const selected = Array.from(event.target.files ?? []); event.target.value = "";
        if (!selected.length) return;
        if (uploadKind !== "auto" && selected.length !== 1) { setError("Для этой кнопки выберите один файл. Две стороны отдельно можно добавить по очереди."); return; }
        if (selected.length > 2 || selected.some(file => file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(file.type))) {
          setError("Выберите одно или два фото JPEG/PNG, не больше 5 МиБ каждое"); return;
        }
        const label = uploadKind === "front" ? "Лицевая сторона" : uploadKind === "back" ? "Обратная сторона" : "Обе стороны одним файлом";
        if (uploadKind === "front" || uploadKind === "back") {
          const index = photoLabels.indexOf(label);
          if (index < 0 && files.length >= 2) { setError("Уберите ненужное фото перед добавлением стороны"); return; }
          if (index >= 0 && previews[index]) releaseUrl(previews[index]!);
          setFiles(index >= 0 ? files.map((file, i) => i === index ? selected[0]! : file) : [...files, selected[0]!]);
          setPreviews(index >= 0 ? previews.map((url, i) => i === index ? previewUrl(selected[0]!) : url) : [...previews, previewUrl(selected[0]!)]);
          setRotations(index >= 0 ? rotations.map((value, i) => i === index ? 0 : value) : [...rotations, 0]);
          setPhotoLabels(index >= 0 ? photoLabels : [...photoLabels, label]);
        } else {
          previews.forEach(releaseUrl);
          setFiles(selected); setPreviews(selected.map(previewUrl));
          setRotations(selected.map(() => 0));
          setPhotoLabels(selected.length === 1 ? ["Обе стороны одним файлом / одно фото"] : ["Фото 1", "Фото 2"]);
        }
        setResult(undefined); setChecked(false); setError(undefined);
      }} />
    <div className="hr-hiring-buttons"><Button disabled={disabled || busy} onClick={() => choosePhoto("auto")}>Добавить фото ID-карты</Button>
      <Button disabled={disabled || busy} onClick={() => choosePhoto("combined")}>Обе стороны одним файлом</Button>
      <Button disabled={disabled || busy} onClick={() => choosePhoto("front")}>Добавить лицевую сторону</Button>
      <Button disabled={disabled || busy} onClick={() => choosePhoto("back")}>Добавить обратную сторону</Button>
      {files.length ? <><Button appearance="primary" disabled={disabled || busy} onClick={() => void analyse()}>{result ? "Распознать повторно" : "Распознать данные"}</Button>
        <Button icon={<Dismiss20Regular />} disabled={busy || disabled} onClick={clear}>Убрать фото</Button></> : null}</div>
    {busy ? <div className="hr-identity-feedback" role="status"><Spinner label="Распознаём ID-карту локально…" /></div> : null}
    {error ? <p className="hr-identity-feedback hr-identity-error" role="alert">{error} Ручное заполнение остаётся доступным.</p> : null}
    {result ? <p className="hr-identity-feedback" role="status">{result.fullName || result.pinfl || result.passport
      ? "Распознавание завершено. Проверьте найденные значения ниже и выберите поля для заполнения."
      : "Не удалось прочитать данные на фото. Попробуйте более чёткий снимок или заполните поля вручную."}</p> : null}
    {files.length ? <div className="hr-identity-photos">{files.map((file, index) => <figure key={`${file.name}-${index}`}>
      <div className="hr-identity-photo-frame">{previews[index] ? <img style={{ transform: `rotate(${rotations[index] ?? 0}deg) scale(${(rotations[index] ?? 0) % 180 ? .65 : 1})` }} src={previews[index]} alt={`Фото ID-карты, сторона ${index + 1}`} /> : null}</div><figcaption>{photoLabels[index]}</figcaption>
      <div className="hr-identity-photo-actions"><Button disabled={busy || disabled} onClick={() => setExpanded(index)}>Увеличить фото {index + 1}</Button>
        <Button disabled={busy || disabled} onClick={() => rotate(index)}>Повернуть фото {index + 1}</Button>
        <Button disabled={busy || disabled} onClick={() => {
          if (previews[index]) releaseUrl(previews[index]!);
          setFiles(files.filter((_, i) => i !== index)); setPreviews(previews.filter((_, i) => i !== index));
          setPhotoLabels(photoLabels.filter((_, i) => i !== index)); setRotations(rotations.filter((_, i) => i !== index)); setResult(undefined); setChecked(false);
        }}>Убрать фото {index + 1}</Button></div></figure>)}</div> : null}
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
    <WorkspaceDialog open={expanded !== undefined} onOpenChange={(_, data) => { if (!data.open) setExpanded(undefined); }}>
      <DialogSurface className="hr-identity-expanded"><DialogBody><DialogTitle>Просмотр ID-карты</DialogTitle><DialogContent className="hr-identity-large-frame">
        {expanded !== undefined && previews[expanded] ? <img src={previews[expanded]} style={{ transform: `rotate(${rotations[expanded] ?? 0}deg) scale(${(rotations[expanded] ?? 0) % 180 ? .65 : 1})` }} alt="Увеличенное фото ID-карты" /> : null}
      </DialogContent><DialogActions><Button onClick={() => setExpanded(undefined)}>Закрыть просмотр</Button></DialogActions></DialogBody></DialogSurface>
    </WorkspaceDialog>
  </section>;
}
