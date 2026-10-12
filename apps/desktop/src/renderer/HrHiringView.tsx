import { useCallback, useEffect, useRef, useState } from "react";
import type { HiringActionName, HiringDetail, HiringDocumentKind, HiringFields, HiringRegistry, HiringSignatureBox } from "@yuksalish/contracts";
import { Button, Checkbox, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Select, Spinner, Textarea } from "@fluentui/react-components";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { LocalFileViewer } from "./FileViewer";
import { ApiHttpError, actHiringCase, downloadHiringDocument, loadHiringCase, loadHiringRegistry, saveHiringCase, saveHiringSignature, uploadHiringDocument } from "./workspace-api";
import "./hr-hiring.css";

const labels: Record<HiringDetail["status"], string> = { draft: "Черновик", pending: "На согласовании", returned: "Вернули на доработку", awaiting_employee: "Ожидает подписи сотрудника", completed: "Завершено" };
const defaultBox: HiringSignatureBox = { page: 1, x: .58, y: .78, width: .3, height: .1 };
const blank = (): HiringFields => {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return { fullName: "", jobTitle: "", department: "", startDate: date, documentDate: date, contractNumber: "", orderNumber: "",
    workType: "primary", term: "indefinite", endDate: null, fixedTermReason: "", probationMonths: 0, probationEligible: false,
    workRegime: "Иш вақтининг нормал давомийлиги", daysPerWeek: 5, hoursPerWeek: 40, annualLeave: 21, additionalLeave: 0,
    salaryTerms: "Штат жадвалига мувофиқ", allowances: "", passport: "", pinfl: "", address: "", phone: "", additionalTerms: "" };
};
const required: readonly (keyof HiringFields)[] = ["fullName", "jobTitle", "department", "contractNumber", "orderNumber", "startDate", "documentDate", "salaryTerms", "passport", "pinfl", "address", "phone"];
type TextKey = { [K in keyof HiringFields]: HiringFields[K] extends string ? K : never }[keyof HiringFields];
type NumberKey = "probationMonths" | "daysPerWeek" | "hoursPerWeek" | "annualLeave" | "additionalLeave";

export function HrHiringView({ token }: { readonly token: string }) {
  const [registry, setRegistry] = useState<HiringRegistry>();
  const [selected, setSelected] = useState<HiringDetail>();
  const [draftId, setDraftId] = useState<string>();
  const [fields, setFields] = useState<HiringFields>(blank);
  const [box, setBox] = useState<HiringSignatureBox>(defaultBox);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [preview, setPreview] = useState<File>();
  const [decision, setDecision] = useState<HiringActionName>();
  const [comment, setComment] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const applicationInput = useRef<HTMLInputElement>(null);
  const scanInput = useRef<HTMLInputElement>(null);
  const signatureInput = useRef<HTMLInputElement>(null);
  const [pendingAction, setPendingAction] = useState<{ action: HiringActionName; id: string; revision: number; requestId: string; comment: string }>();
  const errorMessage = (value: unknown) => value instanceof Error ? value.message : "Не удалось выполнить действие";
  const refresh = useCallback(async () => setRegistry(await loadHiringRegistry(token, offset)), [token, offset]);
  useEffect(() => { let active = true; void loadHiringRegistry(token, offset).then((value) => { if (active) setRegistry(value); })
    .catch((value: unknown) => { if (active) setError(errorMessage(value)); }); return () => { active = false; }; }, [token, offset]);
  const noOfficePreview = useCallback(async () => { throw new Error("Кадровые документы открываются в PDF"); }, []);
  const accept = (value: HiringDetail) => { setSelected(value); setDraftId(value.id); setFields(value.fields); setBox(value.applicationBox); setDirty(false); };
  const run = async (operation: () => Promise<void>) => { if (busy) return; setBusy(true); setError(undefined);
    try { await operation(); } catch (value) { setError(errorMessage(value)); } finally { setBusy(false); } };
  const selectCase = (id: string) => { if (dirty || pendingAction) { setError("Сначала сохраните изменения или завершите повтор неизвестного действия."); return; }
    void run(async () => accept(await loadHiringCase(token, id))); };
  const start = () => { if (dirty || pendingAction) { setError("Сначала сохраните текущий черновик."); return; }
    setSelected(undefined); setDraftId(crypto.randomUUID()); setFields(blank()); setBox(defaultBox); setDirty(true); setError(undefined); };
  const editable = Boolean(draftId && (!selected || selected.canEdit));
  const valid = required.every((key) => String(fields[key]).trim()) && /^\d{14}$/.test(fields.pinfl)
    && (!fields.probationMonths || fields.probationEligible)
    && (fields.term !== "fixed" || Boolean(fields.endDate && fields.fixedTermReason.trim()));
  const save = () => { if (!draftId) return; void run(async () => { accept(await saveHiringCase(token, draftId, selected?.revision ?? 0, fields, box)); await refresh(); }); };
  const upload = (kind: "application" | "employee-scan", file: File) => { if (!selected) return;
    void run(async () => { accept(await uploadHiringDocument(token, selected.id, selected.revision, kind, file)); await refresh(); }); };
  const openDocument = (kind: HiringDocumentKind, title: string, download = false) => { if (!selected) return;
    void run(async () => { const blob = await downloadHiringDocument(token, selected.id, kind);
      if (download) { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${kind}.${kind === "packet" ? "zip" : "pdf"}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      else setPreview(new File([blob], `${title}.pdf`, { type: "application/pdf" })); }); };
  const confirmDecision = () => { if (!selected || !decision) return;
    const action = pendingAction ?? { action: decision, id: selected.id, revision: selected.revision, requestId: crypto.randomUUID(), comment };
    setPendingAction(action);
    void run(async () => { try {
      const result = await actHiringCase(token, action.id, action.revision, action.action, action.requestId, action.comment);
      setPendingAction(undefined); accept(result); setDecision(undefined); setComment(""); setReviewConfirmed(false); await refresh();
    } catch (value) {
      if (value instanceof ApiHttpError && value.status >= 400 && value.status < 500 && value.status !== 408) setPendingAction(undefined);
      throw value;
    } }); };
  const text = (key: TextKey, label: string, type = "text") => <Field label={label} required={required.includes(key)}>
    <Input type={type === "date" ? "date" : "text"} value={fields[key]} disabled={!editable || busy}
      autoComplete="off" onChange={(_, data) => { setFields({ ...fields, [key]: data.value }); setDirty(true); }} /></Field>;
  const number = (key: NumberKey, label: string, min: number, max: number) => <Field label={label}>
    <Input type="number" min={min} max={max} value={String(fields[key])} disabled={!editable || busy}
      onChange={(_, data) => { setFields({ ...fields, [key]: Number(data.value) }); setDirty(true); }} /></Field>;

  return <section className="hr-hiring" aria-label="Приём на работу">
    <div className="hr-hiring-toolbar"><div><h2>Приём на работу</h2><p>Договор, приказ и ариза в одном пакете. Сотрудник подписывает договор после распечатки.</p></div>
      <div><Button disabled={busy} onClick={() => void run(refresh)}>Обновить</Button>{registry?.canCreate ? <Button appearance="primary" disabled={busy} onClick={start}>Новый приём</Button> : null}</div></div>
    {error ? <div role="alert" className="hr-alert hr-error">{error}</div> : null}
    {!registry && !error ? <Spinner label="Загружаем оформления…" /> : null}
    {registry ? <><div className="hr-hiring-signature"><span>Руководитель: {registry.signerName}. {registry.signatureReady ? "Личная подпись настроена." : "Личная подпись ещё не настроена."}</span>
      {registry.canConfigureSignature ? <><input type="file" ref={signatureInput} hidden accept="image/png" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = "";
        if (file) void run(async () => { await saveHiringSignature(token, file); await refresh(); }); }} /><Button disabled={busy} onClick={() => signatureInput.current?.click()}>Настроить мою подпись</Button></> : null}</div>
      <div className="hr-hiring-layout"><aside aria-label="Оформления сотрудников">
        {registry.items.map((item) => <button type="button" disabled={busy} key={item.id} className={selected?.id === item.id ? "selected" : ""}
          aria-pressed={selected?.id === item.id} onClick={() => selectCase(item.id)}><strong>{item.fullName}</strong><span>{item.jobTitle}</span><small>{labels[item.status]} · версия {item.revision}</small></button>)}
        {!registry.items.length ? <p>Оформлений пока нет.</p> : null}
        <div className="hr-hiring-pagination"><Button disabled={busy || offset === 0} onClick={() => { if (!dirty) setOffset(Math.max(0, offset - 50)); }}>Назад</Button>
          <span>{registry.total} всего</span><Button disabled={busy || offset + 50 >= registry.total || dirty} onClick={() => setOffset(offset + 50)}>Далее</Button></div>
      </aside><div className="hr-hiring-detail">
        {!draftId ? <p>Выберите оформление или начните новый приём.</p> : <>
          <h3>{selected ? `${selected.fullName} · ${labels[selected.status]}` : "Новый сотрудник"}</h3>
          {selected?.returnComment ? <p className="hr-alert">Причина возврата: {selected.returnComment}</p> : null}
          <fieldset disabled={!editable || busy}><legend>Данные сотрудника</legend><div className="hr-hiring-grid">
            {text("fullName", "Фамилия, имя и отчество")}{text("passport", "Паспорт / ID-карта")}{text("pinfl", "JSHSHIR — 14 цифр")}{text("phone", "Телефон")}{text("address", "Адрес проживания")}
          </div></fieldset>
          <fieldset disabled={!editable || busy}><legend>Должность и договор</legend><div className="hr-hiring-grid">
            {text("department", "Подразделение")}{text("jobTitle", "Должность")}{text("contractNumber", "Номер договора")}{text("orderNumber", "Номер приказа")}
            {text("documentDate", "Дата документов", "date")}{text("startDate", "Дата начала работы", "date")}
            <Field label="Вид работы"><Select value={fields.workType} onChange={(_, data) => { setFields({ ...fields, workType: data.value === "secondary" ? "secondary" : "primary" }); setDirty(true); }}><option value="primary">Основная работа</option><option value="secondary">Совместительство</option></Select></Field>
            <Field label="Срок договора"><Select value={fields.term} onChange={(_, data) => { setFields({ ...fields, term: data.value === "fixed" ? "fixed" : "indefinite", endDate: null, fixedTermReason: "" }); setDirty(true); }}><option value="indefinite">Бессрочный</option><option value="fixed">Срочный</option></Select></Field>
            {fields.term === "fixed" ? <><Field label="Дата окончания" required><Input type="date" value={fields.endDate ?? ""} onChange={(_, data) => { setFields({ ...fields, endDate: data.value || null }); setDirty(true); }} /></Field>{text("fixedTermReason", "Основание срочного договора")}</> : null}
          </div></fieldset>
          <fieldset disabled={!editable || busy}><legend>Условия работы</legend><div className="hr-hiring-grid">
            {number("probationMonths", "Испытательный срок, месяцев (0 — без испытания)", 0, 6)}{text("workRegime", "Режим рабочего времени")}
            {number("daysPerWeek", "Дней в неделю", 1, 6)}{number("hoursPerWeek", "Часов в неделю", 1, 40)}{number("annualLeave", "Основной отпуск, календарных дней", 21, 90)}{number("additionalLeave", "Дополнительный отпуск, дней", 0, 90)}
            {text("salaryTerms", "Зарплата / основание по штатному расписанию")}{text("allowances", "Доплаты и компенсации")}
          </div>{fields.probationMonths > 0 ? <Checkbox checked={fields.probationEligible} label="Я проверил(а) допустимость испытательного срока для этого сотрудника" onChange={(_, data) => { setFields({ ...fields, probationEligible: data.checked === true }); setDirty(true); }} /> : null}
            <Field label="Дополнительные условия"><Textarea value={fields.additionalTerms} onChange={(_, data) => { setFields({ ...fields, additionalTerms: data.value }); setDirty(true); }} /></Field></fieldset>
          {editable ? <Button appearance="primary" disabled={busy || !valid || !dirty} onClick={save}>Сохранить черновик</Button> : null}
          {editable && dirty ? <Button disabled={busy} onClick={() => setDiscardOpen(true)}>Отменить изменения</Button> : null}
          {selected && !dirty ? <Button disabled={busy || Boolean(pendingAction)} onClick={() => selectCase(selected.id)}>Обновить карточку</Button> : null}
          {selected ? <><fieldset><legend>Документы и подпись на аризе</legend><p>PDF, JPEG или PNG до 10 МиБ. Для фотографий проверьте ориентацию и положение подписи. Оригинал сохраняется отдельно.</p>
            <input ref={applicationInput} hidden type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) upload("application", file); }} />
            <div className="hr-hiring-buttons">{selected.canEdit ? <Button disabled={busy || dirty} onClick={() => applicationInput.current?.click()}>{selected.hasApplication ? "Заменить аризу" : "Загрузить аризу"}</Button> : null}
              <Button disabled={busy || dirty} onClick={() => openDocument("contract", "Трудовой договор")}>Договор PDF</Button><Button disabled={busy || dirty} onClick={() => openDocument("order", "Приказ о приёме")}>Приказ PDF</Button>
              {selected.hasApplication ? <Button disabled={busy || dirty} onClick={() => openDocument("application", "Ариза")}>Ариза PDF</Button> : null}</div>
            {selected.hasApplication ? <><p>Положение подписи измеряется от верхнего левого угла страницы.</p><div className="hr-hiring-grid">
              {([ ["page", "Страница"], ["x", "Слева, доля страницы"], ["y", "Сверху, доля страницы"], ["width", "Ширина, доля страницы"], ["height", "Высота, доля страницы"] ] as const).map(([key, label]) => <Field label={label} key={key}><Input type="number" step={key === "page" ? 1 : .01} value={String(box[key])} disabled={!editable || busy}
                onChange={(_, data) => { setBox({ ...box, [key]: Number(data.value) }); setDirty(true); }} /></Field>)}
            </div><Button disabled={busy || dirty} onClick={() => openDocument("application-placement", "Проверка места подписи — рамка")}>Проверить место подписи</Button></> : null}
          </fieldset><div className="hr-hiring-footer">
            {selected.canEdit ? <Button appearance="primary" disabled={busy || dirty || !selected.hasApplication} onClick={() => { setDecision("submit"); setComment(""); }}>Отправить руководителю</Button> : null}
            {selected.canSign ? <><Button appearance="primary" disabled={busy || !registry.signatureReady} onClick={() => setDecision("approve")}>Подписать пакет</Button><Button disabled={busy} onClick={() => setDecision("return")}>Вернуть кадровику</Button></> : null}
            {["awaiting_employee", "completed"].includes(selected.status) ? <Button disabled={busy} onClick={() => openDocument("packet", "Подписанный пакет", true)}>Скачать пакет ZIP</Button> : null}
            {selected.status === "awaiting_employee" && registry.canCreate ? <><input ref={scanInput} type="file" hidden accept="application/pdf,image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) upload("employee-scan", file); }} /><Button disabled={busy} onClick={() => scanInput.current?.click()}>Загрузить подписанный сотрудником договор</Button>
              <Button disabled={busy || !selected.hasEmployeeScan} onClick={() => setDecision("complete")}>Завершить оформление</Button></> : null}
            {selected.hasEmployeeScan ? <Button disabled={busy} onClick={() => openDocument("employee-scan", "Договор с подписью сотрудника")}>Скан договора</Button> : null}
          </div>{busy ? <Spinner label="Подготавливаем документы…" /> : null}</> : null}
        </>}
      </div></div></> : null}
    {preview ? <LocalFileViewer file={preview} onClose={() => setPreview(undefined)} onLoadOffice={noOfficePreview} /> : null}
    <WorkspaceDialog open={discardOpen} onOpenChange={(_, data) => setDiscardOpen(data.open)}><DialogSurface><DialogBody><DialogTitle>Сбросить несохранённые изменения?</DialogTitle><DialogContent>Сохранённые документы останутся. Несохранённый ввод будет сброшен.</DialogContent><DialogActions><Button onClick={() => setDiscardOpen(false)}>Продолжить заполнение</Button><Button onClick={() => { if (selected) accept(selected); else { setDraftId(undefined); setFields(blank()); setBox(defaultBox); setDirty(false); } setDiscardOpen(false); }}>Сбросить изменения</Button></DialogActions></DialogBody></DialogSurface></WorkspaceDialog>
    <WorkspaceDialog open={Boolean(decision)} onOpenChange={(_, data) => { if (!data.open && !pendingAction && !busy) setDecision(undefined); }}><DialogSurface><DialogBody><DialogTitle>{decision === "approve" ? "Подписать весь пакет?" : decision === "return" ? "Вернуть кадровику" : decision === "submit" ? "Отправить на согласование?" : "Завершить оформление?"}</DialogTitle><DialogContent>
      <p>{decision === "approve" ? "Подтвердите, что проверили договор, приказ, аризу и место подписи. Будет применено изображение вашей подписи, не ЭЦП." : decision === "submit" ? "Данные и документы будут зафиксированы до решения руководителя." : decision === "complete" ? "Подтвердите наличие бумажной подписи сотрудника на загруженном скане." : "Укажите, что кадровику нужно исправить."}</p>
      {decision === "approve" ? <Checkbox checked={reviewConfirmed} disabled={busy || Boolean(pendingAction)} label="Я ознакомился с полным пакетом и подтверждаю применение моей подписи" onChange={(_, data) => setReviewConfirmed(data.checked === true)} /> : null}
      {decision === "return" ? <Field label="Причина возврата" required><Textarea disabled={busy || Boolean(pendingAction)} value={comment} onChange={(_, data) => setComment(data.value)} /></Field> : null}
      {pendingAction && error ? <p role="alert">{error} Повтор использует тот же ключ и не подписывает документы дважды.</p> : null}
    </DialogContent><DialogActions><Button disabled={busy || Boolean(pendingAction)} onClick={() => { setDecision(undefined); setReviewConfirmed(false); }}>Отмена</Button><Button appearance="primary" disabled={busy || (decision === "return" && !comment.trim()) || (decision === "approve" && !reviewConfirmed)} onClick={confirmDecision}>{pendingAction ? "Повторить безопасно" : "Подтвердить"}</Button></DialogActions></DialogBody></DialogSurface></WorkspaceDialog>
  </section>;
}
