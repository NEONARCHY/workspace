import { useEffect, useId, useRef, useState } from "react";
import type { DossierDetail, DossierFields, DossierHistory, WorkspacePerson } from "@yuksalish/contracts";
import { Badge, Button, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Textarea } from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import { Input } from "./WorkspaceInput";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { TaskPersonAvatar } from "./TaskPersonAvatar";
import { downloadDossierPdf, downloadDossierWord, loadDossier, loadDossierHistory, saveDossier } from "./workspace-api";
import { referentDownloadName, saveReferentBlob } from "./AIReferentFiles";
import { DossierTemplateFields } from "./DossierTemplateFields";
import { DossierImportSection } from "./DossierImportSection";
import "./dossiers.css";

const fieldLabels: Record<string, string> = { birthDate: "Дата рождения", birthPlace: "Место рождения", education: "Образование", employment: "Трудовая деятельность", languages: "Языки", academicDegree: "Учёная степень", awards: "Награды", additionalInfo: "Дополнительные сведения", status: "Состояние анкеты", appointmentDate: "Дата назначения", nationality: "Национальность", partyMembership: "Партийность", educationLevel: "Уровень образования", academicTitle: "Учёное звание", militaryRank: "Воинское звание", electedMembership: "Выборные органы", relatives: "Близкие родственники" };
const message = (error: unknown) => error instanceof Error ? error.message : "Не удалось загрузить объективку";

export function DossierDialog({ token, userId, people, onClose, onSaved }: {
  readonly token: string; readonly userId: string; readonly people: readonly WorkspacePerson[];
  readonly onClose: () => void; readonly onSaved?: () => void;
}) {
  const prefix = useId();
  const [record, setRecord] = useState<DossierDetail>();
  const [fields, setFields] = useState<DossierFields>();
  const [history, setHistory] = useState<readonly DossierHistory[]>([]);
  const [error, setError] = useState<string>();
  const [historyError, setHistoryError] = useState(false);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [retry, setRetry] = useState(0);
  const saving = useRef(false);
  const downloadingRef = useRef(false);
  useEffect(() => {
    let active = true;
    loadDossier(token, userId).then((value) => {
      if (active) { setRecord(value); setFields(value.fields); setError(undefined); setDirty(false); }
    }).catch((value: unknown) => { if (active) setError(message(value)); });
    loadDossierHistory(token, userId).then((value) => { if (active) { setHistory(value); setHistoryError(false); } })
      .catch(() => { if (active) setHistoryError(true); });
    return () => { active = false; };
  }, [token, userId, retry]);
  const close = () => { if (saving.current || downloadingRef.current) return; if (dirty) setDiscard(true); else onClose(); };
  const change = (value: Partial<DossierFields>) => {
    setFields((current) => current ? { ...current, ...value } : current);
    setDirty(true); setSuccess(false);
  };
  const save = async (status: "draft" | "saved") => {
    if (!record || !fields || saving.current || downloadingRef.current) return;
    if (fields.education.some((row) => !row.institution.trim()) || fields.employment.some((row) => (!row.organization.trim() && !row.position.trim()) || (!row.startDate && !row.period?.trim()))) {
      setError("Заполните название учебного заведения, а для работы — организацию или должность и начало либо период из Word. Пустую строку можно удалить."); return;
    }
    if (fields.relatives.some((row) => !row.relationship.trim() || !row.fullName.trim())) {
      setError("Для добавленного родственника укажите степень родства и ФИО либо удалите пустую строку."); return;
    }
    saving.current = true; setBusy(true); setError(undefined); setSuccess(false);
    try {
      const updated = await saveDossier(token, userId, { revision: record.revision, status, fields });
      setRecord(updated); setFields(updated.fields); setDirty(false); setSuccess(true); onSaved?.();
      loadDossierHistory(token, userId).then((value) => { setHistory(value); setHistoryError(false); }).catch(() => setHistoryError(true));
    } catch (value) { setError(message(value)); }
    finally { saving.current = false; setBusy(false); }
  };
  const download = async (format: "word" | "pdf") => {
    if (!record || dirty || saving.current || downloadingRef.current) return;
    downloadingRef.current = true; setDownloading(true); setError(undefined);
    try {
      const blob = await (format === "pdf" ? downloadDossierPdf : downloadDossierWord)(token, userId, record.revision);
      saveReferentBlob(blob, referentDownloadName(`Объективка ${record.fullName}`, format === "pdf" ? "pdf" : "docx"));
    } catch (value) { setError(message(value)); }
    finally { downloadingRef.current = false; setDownloading(false); }
  };
  return <WorkspaceDialog open onOpenChange={(_, data) => { if (!data.open) close(); }}>
    <DialogSurface className="dossier-dialog" aria-label="Объективка сотрудника"><DialogBody>
      <DialogTitle action={<Button appearance="subtle" icon={<Dismiss24Regular />} aria-label="Закрыть объективку" disabled={busy || downloading} onClick={close} />}>Объективка</DialogTitle>
      <DialogContent>
        {!record && !error ? <p role="status">Загружаем личную анкету…</p> : null}
        {record && fields ? <>
          <header className="dossier-identity"><TaskPersonAvatar person={people.find((p) => p.id === userId)} fallbackName={record.fullName} token={token} size={48} /><div className="dossier-identity-copy"><h2>{record.fullName}</h2><p>{record.jobTitle ?? "Должность не указана"}</p><small>ФИО, должность и фотография берутся из профиля. Кадровое назначение здесь не меняется.</small></div><Badge appearance="tint">{record.status === "saved" ? "Сохранена" : record.status === "draft" ? "Черновик" : "Не заполнена"}</Badge></header>
          <p className="dossier-privacy">Личная анкета · {record.permissions.canEdit ? "Можно редактировать" : "Только просмотр"}. Сохранение не означает проверку кадровиком.</p>
          {record.permissions.canEdit ? <DossierImportSection token={token} userId={userId} fullName={record.fullName} disabled={busy || downloading} onApply={change} /> : null}
          <form id={`${prefix}-form`} onSubmit={(event) => { event.preventDefault(); void save("saved"); }}>
            <fieldset disabled={busy || downloading || !record.permissions.canEdit} className="dossier-form">
              <section className="dossier-section"><h3>Личные сведения</h3><div className="dossier-grid">
                <Field label="Дата рождения"><Input type="date" value={fields.birthDate ?? ""} onChange={(_, data) => change({ birthDate: data.value || null })} /></Field>
                <Field label="Место рождения"><Input maxLength={300} value={fields.birthPlace} onChange={(_, data) => change({ birthPlace: data.value })} /></Field>
              </div></section>
              <section className="dossier-section"><h3>Образование</h3>
                {fields.education.map((row, index) => <div className="dossier-entry" key={index}><h4>Образование {index + 1}</h4><div className="dossier-grid">
                  <Field label="Учебное заведение"><Input required maxLength={300} value={row.institution} onChange={(_, data) => change({ education: fields.education.map((item, i) => i === index ? { ...item, institution: data.value } : item) })} /></Field>
                  <Field label="Год начала обучения"><Input type="number" min={1900} max={2100} value={row.startYear?.toString() ?? ""} onChange={(_, data) => change({ education: fields.education.map((item, i) => i === index ? { ...item, startYear: data.value ? Number(data.value) : null } : item) })} /></Field>
                  <Field label="Год окончания"><Input type="number" min={1900} max={2100} value={row.graduationYear?.toString() ?? ""} onChange={(_, data) => change({ education: fields.education.map((item, i) => i === index ? { ...item, graduationYear: data.value ? Number(data.value) : null } : item) })} /></Field>
                  <Field label="Специальность"><Input maxLength={300} value={row.specialty} onChange={(_, data) => change({ education: fields.education.map((item, i) => i === index ? { ...item, specialty: data.value } : item) })} /></Field>
                  <Field label="Квалификация"><Input maxLength={200} value={row.qualification} onChange={(_, data) => change({ education: fields.education.map((item, i) => i === index ? { ...item, qualification: data.value } : item) })} /></Field>
                </div><Button type="button" appearance="subtle" onClick={() => change({ education: fields.education.filter((_, i) => i !== index) })}>Удалить образование {index + 1}</Button></div>)}
                {!fields.education.length ? <p>Учебные заведения пока не добавлены.</p> : null}
                {record.permissions.canEdit ? <Button type="button" disabled={fields.education.length >= 20} onClick={() => change({ education: [...fields.education, { institution: "", startYear: null, graduationYear: null, specialty: "", qualification: "" }] })}>Добавить образование</Button> : null}
              </section>
              <section className="dossier-section"><h3>Квалификация и награды</h3><div className="dossier-grid">
                <Field label="Владение языками"><Input maxLength={1000} value={fields.languages} onChange={(_, data) => change({ languages: data.value })} /></Field>
                <Field label="Учёная степень"><Input maxLength={300} value={fields.academicDegree} onChange={(_, data) => change({ academicDegree: data.value })} /></Field>
              </div><Field label="Награды"><Textarea resize="vertical" maxLength={3000} value={fields.awards} onChange={(_, data) => change({ awards: data.value })} /></Field></section>
              <section className="dossier-section"><h3>Трудовая деятельность</h3>
                {fields.employment.map((row, index) => <div className="dossier-entry" key={index}><h4>Место работы {index + 1}</h4><div className="dossier-grid">
                  <Field label="Начало работы"><Input type="date" value={row.startDate ?? ""} onChange={(_, data) => change({ employment: fields.employment.map((item, i) => i === index ? { ...item, startDate: data.value || null } : item) })} /></Field>
                  <Field label="Окончание работы (пусто — по настоящее время)"><Input type="date" value={row.endDate ?? ""} onChange={(_, data) => change({ employment: fields.employment.map((item, i) => i === index ? { ...item, endDate: data.value || null } : item) })} /></Field>
                  <Field label="Организация"><Input maxLength={300} value={row.organization} onChange={(_, data) => change({ employment: fields.employment.map((item, i) => i === index ? { ...item, organization: data.value } : item) })} /></Field>
                  <Field label="Должность в этот период"><Textarea resize="vertical" maxLength={1000} value={row.position} onChange={(_, data) => change({ employment: fields.employment.map((item, i) => i === index ? { ...item, position: data.value } : item) })} /></Field>
                  <Field label="Период как в Word (если заполнен — используется вместо дат)"><Input maxLength={100} value={row.period ?? ""} onChange={(_, data) => change({ employment: fields.employment.map((item, i) => i === index ? { ...item, period: data.value } : item) })} /></Field>
                </div><Button type="button" appearance="subtle" onClick={() => change({ employment: fields.employment.filter((_, i) => i !== index) })}>Удалить место работы {index + 1}</Button></div>)}
                {!fields.employment.length ? <p>Периоды работы пока не добавлены.</p> : null}
                {record.permissions.canEdit ? <Button type="button" disabled={fields.employment.length >= 50} onClick={() => change({ employment: [...fields.employment, { startDate: null, endDate: null, period: "", organization: "", position: "" }] })}>Добавить место работы</Button> : null}
              </section>
              <DossierTemplateFields fields={fields} canEdit={record.permissions.canEdit} onChange={change} />
              <section className="dossier-section"><h3>Дополнительные сведения</h3><Field label="Дополнительная информация"><Textarea resize="vertical" maxLength={6000} value={fields.additionalInfo} onChange={(_, data) => change({ additionalInfo: data.value })} /></Field></section>
            </fieldset>
          </form>
          <details className="dossier-section"><summary>История изменений · {history.length}</summary>
            {historyError ? <WorkspaceNotice tone="warning">Не удалось загрузить историю. Закройте и откройте анкету для повтора.</WorkspaceNotice> : history.length ? <ol className="dossier-history">{history.map((entry) => <li key={entry.revision}><strong>Версия {entry.revision} · {entry.actorName}</strong><span>{new Date(entry.createdAt).toLocaleString("ru-RU")}</span><small>{entry.changedFields.map((name) => fieldLabels[name] ?? name).join(", ")}</small></li>)}</ol> : <p>Сохранённых изменений пока нет.</p>}
          </details>
          <p className="dossier-next-stage">Word и PDF формируются из одного макета: основная справка с фото и таблица родственников на отдельной странице. Скачивается сохранённая версия. {dirty ? "Сначала сохраните изменения." : !record.revision ? "Сначала сохраните анкету или черновик." : "При большом объёме данных документ продолжится на следующих страницах."}</p>
        </> : null}
      </DialogContent>
      <div className="dossier-feedback">
        {downloading ? <p role="status">Готовим файл для скачивания…</p> : null}
        {error ? <WorkspaceNotice tone="error" role="alert" actions={!record ? <Button onClick={() => { setError(undefined); setRetry((value) => value + 1); }}>Повторить</Button> : undefined}>{error}</WorkspaceNotice> : null}
        {success ? <WorkspaceNotice tone="success" role="status">Объективка сохранена. Версия {record?.revision}.</WorkspaceNotice> : null}
        {discard ? <WorkspaceNotice tone="warning" role="alert" actions={<><Button onClick={onClose}>Закрыть без сохранения</Button><Button onClick={() => setDiscard(false)}>Продолжить редактирование</Button></>}>Есть несохранённые изменения.</WorkspaceNotice> : null}
      </div>
      <DialogActions><Button disabled={busy || downloading} onClick={close}>Закрыть</Button>{record ? <><Button disabled={busy || downloading || dirty || !record.revision} onClick={() => void download("word")}>Скачать Word</Button><Button disabled={busy || downloading || dirty || !record.revision} onClick={() => void download("pdf")}>Скачать PDF</Button></> : null}{record?.permissions.canEdit ? <><Button disabled={busy || downloading || !dirty} onClick={() => void save("draft")}>Сохранить черновик</Button><Button appearance="primary" type="submit" form={`${prefix}-form`} disabled={busy || downloading || (!dirty && record.status === "saved")}>{busy ? "Сохраняем…" : "Сохранить объективку"}</Button></> : null}</DialogActions>
    </DialogBody></DialogSurface>
  </WorkspaceDialog>;
}
