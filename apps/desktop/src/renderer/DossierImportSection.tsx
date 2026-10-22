import { useEffect, useRef, useState } from "react";
import type { DossierFields, DossierImportPreview } from "@yuksalish/contracts";
import { Button, Checkbox, Field, Textarea } from "@fluentui/react-components";
import { DocumentArrowUp24Regular, ShieldCheckmark16Regular } from "@fluentui/react-icons";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { WorkspaceFileDropzone } from "./WorkspaceFileDropzone";
import { previewDossierImport } from "./workspace-api";

export const dossierFieldLabels: Record<keyof DossierFields, string> = {
  birthDate: "Дата рождения", birthPlace: "Место рождения", appointmentDate: "Дата назначения",
  nationality: "Национальность", partyMembership: "Партийность", educationLevel: "Уровень образования",
  education: "Образование", employment: "Трудовая деятельность", languages: "Языки",
  academicDegree: "Учёная степень", academicTitle: "Учёное звание", militaryRank: "Воинское звание",
  electedMembership: "Выборные органы", awards: "Награды", relatives: "Близкие родственники",
  additionalInfo: "Дополнительные сведения",
};

function importedText(fields: DossierFields, key: keyof DossierFields): string {
  if (key === "education") return fields.education.map((row) => [row.startYear, row.graduationYear, row.institution, row.specialty, row.qualification].filter(Boolean).join(" · ")).join("\n");
  if (key === "employment") return fields.employment.map((row) => [row.period || [row.startDate, row.endDate].filter(Boolean).join(" — "), row.organization, row.position].filter(Boolean).join(" · ")).join("\n");
  if (key === "relatives") return fields.relatives.map((row) => [row.relationship, row.fullName, row.birthYear, row.birthPlace, row.workplacePosition, row.address].filter(Boolean).join(" · ")).join("\n\n");
  const value = fields[key];
  return typeof value === "string" ? value : "—";
}

export function DossierImportSection({ token, userId, fullName, disabled, onApply }: {
  readonly token: string; readonly userId: string; readonly fullName: string;
  readonly disabled: boolean; readonly onApply: (fields: Partial<DossierFields>) => void;
}) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const focusPicker = () => pickerRef.current?.querySelector("input")?.focus();
  const [preview, setPreview] = useState<DossierImportPreview>();
  const [selected, setSelected] = useState<readonly (keyof DossierFields)[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [fileName, setFileName] = useState("");
  const [applied, setApplied] = useState(false);
  const active = useRef(true);
  const reading = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const read = async (file: File) => {
    if (reading.current || disabled) return;
    reading.current = true; setLoading(true); setPreview(undefined); setError(undefined);
    setConfirmed(false); setApplied(false); setFileName(file.name);
    try {
      const result = await previewDossierImport(token, userId, file);
      if (active.current) { setPreview(result); setSelected(result.detectedFields); }
    } catch (value) { if (active.current) setError(value instanceof Error ? value.message : "Файл не распознан. Повторите выбор."); }
    finally { reading.current = false; if (active.current) setLoading(false); }
  };
  const apply = () => {
    if (!preview || !confirmed || !selected.length || disabled) return;
    const patch: Partial<DossierFields> = {};
    for (const key of selected) Object.assign(patch, { [key]: preview.fields[key] });
    onApply(patch); setPreview(undefined); setApplied(true); focusPicker();
  };
  return <section className="dossier-section dossier-import" aria-label="Импорт объективки из Word">
    <div className="dossier-import-heading"><div><h3>Импорт из Word</h3><p>Заполните объективку из готового документа</p></div><span className="dossier-import-format">DOCX · до 5 МБ</span></div>
    <div className="dossier-file-picker" ref={pickerRef}>
      <WorkspaceFileDropzone
        label={fileName || "Перетащите объективку сюда"}
        hint={loading ? "Распознаём сведения из документа…" : fileName ? "Можно выбрать другой документ. Поля переносятся только после вашей проверки." : "Или выберите файл по согласованному образцу. Сначала покажем распознанные поля."}
        actionLabel={loading ? "Проверяем…" : fileName ? "Выбрать другой" : "Выбрать Word"}
        ariaLabel="Выбрать объективку Word"
        icon={<DocumentArrowUp24Regular aria-hidden="true" />}
        accept=".docx"
        disabled={disabled || loading}
        onFiles={(files) => { if (files[0]) void read(files[0]); }}
      />
    </div>
    <p className="dossier-import-privacy"><ShieldCheckmark16Regular aria-hidden="true" /><span>Обработка на вашем сервере, без внешних AI-сервисов. Старый DOC сначала сохраните как DOCX.</span></p>
    {loading ? <p role="status">Распознаём поля: {fileName}… Анкета ещё не изменяется.</p> : null}
    {error ? <WorkspaceNotice tone="error" role="alert">{error} Выберите файл ещё раз для повтора. Ввод в анкете сохранён.</WorkspaceNotice> : null}
    {applied ? <WorkspaceNotice tone="success" role="status">Выбранные поля перенесены в форму. Проверьте их и нажмите «Сохранить объективку» или «Сохранить черновик».</WorkspaceNotice> : null}
    {preview ? <div className="dossier-import-preview">
      <h4>Предварительный результат · {fileName}</h4>
      <p><strong>Кому заполняем:</strong> {fullName}</p>
      <p><strong>ФИО в документе:</strong> {preview.sourceFullName || "Не определено — проверьте исходный Word"}</p>
      <p><strong>Должность в документе:</strong> {preview.sourceJobTitle || "Не определена"}</p>
      <ul>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      <p>Выберите разделы для переноса. Выбранный раздел полностью заменит соответствующий раздел в форме, включая все строки образования, работы или родственников. Остальные поля и несохранённый ввод останутся без изменений.</p>
      {preview.detectedFields.map((key) => <div className="dossier-import-field" key={key}>
        <Checkbox disabled={disabled} label={`Перенести: ${dossierFieldLabels[key]}`} checked={selected.includes(key)} onChange={(_, data) => setSelected((current) => data.checked ? [...current, key] : current.filter((item) => item !== key))} />
        <pre>{importedText(preview.fields, key)}</pre>
      </div>)}
      {preview.unrecognizedText ? <Field label="Не перенесено автоматически — проверьте и при необходимости скопируйте вручную"><Textarea readOnly resize="vertical" rows={5} value={preview.unrecognizedText} /></Field> : null}
      <Checkbox disabled={disabled} checked={confirmed} label={`Я проверил документ: сведения относятся к сотруднику ${fullName}`} onChange={(_, data) => setConfirmed(Boolean(data.checked))} />
      <div className="dossier-import-actions"><Button appearance="primary" disabled={disabled || !confirmed || !selected.length} onClick={apply}>Перенести выбранные поля в форму</Button><Button disabled={disabled} onClick={() => { setPreview(undefined); focusPicker(); }}>Отменить импорт</Button></div>
    </div> : null}
  </section>;
}
