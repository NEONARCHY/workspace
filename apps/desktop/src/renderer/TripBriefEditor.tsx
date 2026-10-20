import { useRef, useState } from "react";
import { Button, DialogBody, DialogSurface, DialogTitle, Textarea } from "@fluentui/react-components";
import type { TripRequest, TripRequestInput } from "@yuksalish/contracts";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { editedTripBriefError, tripBriefPreview } from "./trip-brief-generator";
import "./trip-brief-editor.css";

interface Props {
  readonly request: TripRequest;
  readonly onClose: () => void;
  readonly onSave: (request: TripRequest, payload: TripRequestInput) => Promise<TripRequest | undefined>;
  readonly onSaved: (request: TripRequest) => void;
}

export function TripBriefEditor({ request, onClose, onSave, onSaved }: Props) {
  const facts = { destination: request.destination, startDate: request.startDate,
    endDate: request.endDate, purpose: request.purpose, expenseSource: request.expenseSource ?? "" };
  const generated = tripBriefPreview(facts);
  const original = request.briefText?.trim() || generated;
  const [text, setText] = useState(original);
  const [fontSize, setFontSize] = useState(request.briefFontSize ?? 11);
  const [bold, setBold] = useState(request.briefFontWeight === "bold");
  const [compare, setCompare] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const changed = text !== original || fontSize !== (request.briefFontSize ?? 11)
    || bold !== (request.briefFontWeight === "bold");
  const validation = editedTripBriefError(text);
  const close = () => { if (savingRef.current) return; if (changed) setDiscard(true); else onClose(); };
  const save = async () => {
    if (savingRef.current || validation || !changed) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      const updated = await onSave(request, {
        purpose: request.purpose, destination: request.destination,
        startDate: request.startDate, endDate: request.endDate,
        employeeIds: request.employeeIds, expenseSource: request.expenseSource ?? "",
        briefFormat: "edited", briefText: text.trim(),
        briefFontSize: fontSize, briefFontWeight: bold ? "bold" : "regular",
      });
      if (!updated) { setError("Не удалось сохранить. Проверьте подключение и актуальные права на заявку."); return; }
      onSaved(updated);
    } catch { setError("Не удалось сохранить изменения. Текст остался в редакторе — попробуйте ещё раз."); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <WorkspaceDialog open onOpenChange={(_, data) => { if (!data.open) close(); }}>
    <DialogSurface className="trip-brief-editor-surface"><DialogBody>
      <header className="trip-brief-editor-header"><div><p className="trip-brief-editor-kicker">Черновик поездки · билдирги</p>
        <DialogTitle>Редактор билдирги</DialogTitle><p>Изменения попадут в PDF только после сохранения. Подписанный документ не редактируется.</p></div>
        <Button appearance="subtle" onClick={close} disabled={saving}>Закрыть</Button></header>
      <div className="trip-brief-editor-controls" role="group" aria-label="Оформление текста">
        <span>Шрифт документа: Source Serif 4</span>
        <label>Размер текста <select aria-label="Размер текста билдирги" value={fontSize} disabled={saving}
          onChange={event => setFontSize(Number(event.target.value))}>{[9, 10, 11, 12, 13, 14].map(value => <option key={value} value={value}>{value} пт</option>)}</select></label>
        <Button appearance={bold ? "primary" : "secondary"} aria-pressed={bold} disabled={saving}
          onClick={() => setBold(value => !value)}>Полужирный</Button>
        <Button appearance="subtle" disabled={saving || generated.startsWith("Заполните поля")}
          onClick={() => { setText(generated); setError(""); }}>Вернуть автотекст</Button>
      </div>
      <div className="trip-brief-editor-main">
        <section className="trip-brief-editor-input" aria-label="Редактирование текста"><h3>Текст документа</h3>
          <Textarea aria-label="Текст билдирги в редакторе" value={text} rows={15} resize="vertical" maxLength={6000}
            disabled={saving} onChange={(_, data) => { setText(data.value); setError(""); }} />
          <span className="trip-brief-editor-counter">{text.length} / 6000 знаков</span>
          {validation && <p className="trip-brief-editor-hint">{validation}</p>}</section>
        <section className="trip-brief-editor-preview" aria-label="Предварительный вид текста"><div className="trip-brief-editor-preview-heading"><h3>Как будет выглядеть текст</h3><span>Точный результат проверьте в PDF после сохранения</span></div>
          <article className="trip-brief-editor-paper" style={{ fontSize: `${fontSize}pt`, fontWeight: bold ? 700 : 400 }}>
            <div className="trip-brief-editor-paper-top">“Yuksalish” harakati raisiga</div><h4>BILDIRGI</h4>
            <div className="trip-brief-editor-paper-text">{text.trim() || "Текст появится здесь"}</div>
          </article></section>
      </div>
      <div className="trip-brief-editor-compare"><Button appearance="subtle" aria-expanded={compare} onClick={() => setCompare(value => !value)}>{compare ? "Скрыть сравнение" : "Сравнить с исходным текстом"}</Button>
        {compare && <div className="trip-brief-editor-compare-grid"><section><h4>До изменений</h4><p>{original}</p></section><section className={text === original ? "" : "is-changed"}><h4>Сейчас</h4><p>{text}</p></section></div>}</div>
      {error && <p className="trip-brief-editor-error" role="alert">{error}</p>}
      {discard && <div className="trip-brief-editor-discard" role="alert"><span>Несохранённые изменения будут потеряны.</span><Button onClick={() => setDiscard(false)}>Продолжить редактирование</Button><Button appearance="subtle" onClick={onClose}>Закрыть без сохранения</Button></div>}
      <footer className="trip-brief-editor-footer"><span>Сохранение пересоздаст черновой PDF. Шрифт адресата и фирменная шапка не меняются.</span>
        <div><Button appearance="secondary" onClick={close} disabled={saving}>Отмена</Button><Button appearance="primary" onClick={() => void save()} disabled={saving || !changed || Boolean(validation)}>{saving ? "Сохраняем…" : "Сохранить и проверить PDF"}</Button></div></footer>
    </DialogBody></DialogSurface>
  </WorkspaceDialog>;
}
