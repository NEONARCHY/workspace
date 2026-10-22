import type { DossierFields } from "@yuksalish/contracts";
import { Button, Field, Textarea } from "@fluentui/react-components";
import { Input } from "./WorkspaceInput";

export function DossierTemplateFields({ fields, canEdit, onChange }: {
  readonly fields: DossierFields;
  readonly canEdit: boolean;
  readonly onChange: (patch: Partial<DossierFields>) => void;
}) {
  return <>
    <section className="dossier-section"><h3>Сведения по образцу Word</h3>
      <p>Необязательные поля. Оставьте пустыми сведения, которые не хотите указывать. Пустое поле в Word обозначается «—», а не «нет».</p>
      <div className="dossier-grid">
        <Field label="Дата назначения на текущую должность"><Input type="date" value={fields.appointmentDate ?? ""} onChange={(_, data) => onChange({ appointmentDate: data.value || null })} /></Field>
        <Field label="Уровень образования"><Input maxLength={200} value={fields.educationLevel} onChange={(_, data) => onChange({ educationLevel: data.value })} /></Field>
        <Field label="Национальность (необязательно)"><Input maxLength={200} value={fields.nationality} onChange={(_, data) => onChange({ nationality: data.value })} /></Field>
        <Field label="Партийность (необязательно)"><Input maxLength={300} value={fields.partyMembership} onChange={(_, data) => onChange({ partyMembership: data.value })} /></Field>
        <Field label="Учёное звание"><Input maxLength={300} value={fields.academicTitle} onChange={(_, data) => onChange({ academicTitle: data.value })} /></Field>
        <Field label="Воинское или специальное звание"><Input maxLength={300} value={fields.militaryRank} onChange={(_, data) => onChange({ militaryRank: data.value })} /></Field>
      </div>
      <Field label="Членство в выборных органах"><Textarea resize="vertical" maxLength={2000} value={fields.electedMembership} onChange={(_, data) => onChange({ electedMembership: data.value })} /></Field>
    </section>
    <section className="dossier-section"><h3>Близкие родственники</h3>
      <p>Эти сведения входят только в полную объективку и её Word-файл. В фотокарточках они не отображаются. Не добавляйте сведения без необходимого основания.</p>
      {fields.relatives.map((row, index) => {
        const patch = (value: Partial<typeof row>) => onChange({ relatives: fields.relatives.map((item, i) => i === index ? { ...item, ...value } : item) });
        return <div className="dossier-entry" key={index}><h4>Родственник {index + 1}</h4><div className="dossier-grid">
          <Field label="Степень родства"><Input required maxLength={100} value={row.relationship} onChange={(_, data) => patch({ relationship: data.value })} /></Field>
          <Field label="ФИО родственника"><Input required maxLength={300} value={row.fullName} onChange={(_, data) => patch({ fullName: data.value })} /></Field>
          <Field label="Год рождения родственника"><Input type="number" min={1900} max={new Date().getFullYear()} value={row.birthYear?.toString() ?? ""} onChange={(_, data) => patch({ birthYear: data.value ? Number(data.value) : null })} /></Field>
          <Field label="Место рождения родственника"><Input maxLength={300} value={row.birthPlace} onChange={(_, data) => patch({ birthPlace: data.value })} /></Field>
          <Field label="Место работы и должность родственника"><Textarea resize="vertical" maxLength={600} value={row.workplacePosition} onChange={(_, data) => patch({ workplacePosition: data.value })} /></Field>
          <Field label="Место проживания родственника"><Textarea resize="vertical" maxLength={600} value={row.address} onChange={(_, data) => patch({ address: data.value })} /></Field>
        </div>{canEdit ? <Button type="button" appearance="subtle" onClick={() => onChange({ relatives: fields.relatives.filter((_, i) => i !== index) })}>Удалить родственника {index + 1}</Button> : null}</div>;
      })}
      {!fields.relatives.length ? <p>Родственники не указаны.</p> : null}
      {canEdit ? <Button type="button" disabled={fields.relatives.length >= 40} onClick={() => onChange({ relatives: [...fields.relatives, { relationship: "", fullName: "", birthYear: null, birthPlace: "", workplacePosition: "", address: "" }] })}>Добавить родственника</Button> : null}
    </section>
  </>;
}
