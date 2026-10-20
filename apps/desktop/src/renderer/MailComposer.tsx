import { useCallback, useEffect, useRef, useState } from "react";
import { Button, DialogSurface } from "@fluentui/react-components";
import type { MailDraft, MailFields, MailMessage, MailSignedFile } from "@yuksalish/contracts";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { MailAttachmentViewer, loadMailFileBlob, mailFilePreviewable, saveMailBlob, type MailFileSource } from "./mail-preview";
import { attachMailProviderFile, attachMailSignedFile, loadMailDraft, loadMailSignedFiles, reconcileMailDraft,
  removeMailFile, saveMailDraft, sendMailDraft, uploadMailFile } from "./workspace-api";

export interface MailEditorSeed {
  readonly id: string; readonly draft?: MailDraft; readonly fields: MailFields; readonly source?: MailMessage;
  readonly replyMessageId?: string;
}
interface Props {
  readonly token: string; readonly email: string; readonly seed: MailEditorSeed; readonly canEdit: boolean;
  readonly sendingEnabled: boolean; readonly canUseSigned: boolean; readonly onClose: () => void;
  readonly onSaved: (draft: MailDraft) => void;
}
export const mailStateLabels = { draft: "Черновик", queued: "В очереди отправки", sending: "Отправляем через Gmail",
  sent: "Gmail принял письмо к отправке", unknown: "Результат отправки неизвестен", failed: "Отправка не выполнена" } as const;
function editorFields(value: MailFields) {
  return { to: value.to.join(", "), cc: value.cc.join(", "), bcc: value.bcc.join(", "), subject: value.subject, body: value.body };
}
function addresses(value: string) { return value.split(/[,;\s]+/).map(item => item.trim()).filter(Boolean); }
function message(error: unknown) { return error instanceof Error ? error.message : "Действие не выполнено"; }

export function MailComposer({ token, email, seed, canEdit, sendingEnabled, canUseSigned, onClose, onSaved }: Props) {
  const [saved, setSaved] = useState(seed.draft);
  const [fields, setFields] = useState(() => editorFields(seed.fields));
  const [mode, setMode] = useState<"edit" | "preview" | "close" | "reload">("edit");
  const [copies, setCopies] = useState(Boolean(seed.fields.cc.length || seed.fields.bcc.length));
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const operationId = useRef(crypto.randomUUID());
  const [signed, setSigned] = useState<readonly MailSignedFile[]>(); const [signedId, setSignedId] = useState("");
  const [copied, setCopied] = useState<readonly string[]>([]);
  const [previewFile, setPreviewFile] = useState<MailFileSource>();
  const surfaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Switching editor/preview replaces the focused footer button. Keep focus
    // inside the same Fluent surface so Escape and keyboard navigation still work.
    surfaceRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [mode]);
  const value: MailFields = { to: addresses(fields.to), cc: addresses(fields.cc), bcc: addresses(fields.bcc), subject: fields.subject, body: fields.body };
  const baseline = saved ?? seed.fields;
  const dirty = JSON.stringify(value) !== JSON.stringify({ to: baseline.to, cc: baseline.cc, bcc: baseline.bcc, subject: baseline.subject, body: baseline.body });
  const editable = canEdit && (!saved || ["draft", "failed"].includes(saved.status));
  const accept = useCallback((result: MailDraft) => { setSaved(result); onSaved(result); }, [onSaved]);
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (busyRef.current) return undefined;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try { return await action(); } catch (failure) { setError(message(failure)); return undefined; }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function save(): Promise<MailDraft | undefined> {
    if (saved && saved.status === "draft" && !dirty) return saved;
    return run(async () => {
      const result = await saveMailDraft(token, { ...value, requestId: seed.id, expectedRevision: saved?.revision ?? 0,
        replyMessageId: saved?.replyMessageId ?? seed.replyMessageId ?? null });
      accept(result); setFields(editorFields(result)); operationId.current = crypto.randomUUID();
      setNotice("Черновик сохранён в Workspace. Письмо не отправлено."); return result;
    });
  }
  const requestClose = () => { if (!busyRef.current) { if (editable && dirty) setMode("close"); else onClose(); } };
  useEffect(() => {
    if (!saved || !["queued", "sending"].includes(saved.status)) return;
    let live = true;
    const timer = window.setInterval(() => {
      if (!document.hidden && !busyRef.current) void loadMailDraft(token, seed.id).then(result => {
        if (live) accept(result);
      }).catch(failure => { if (live) setError(message(failure)); });
    }, 3000);
    return () => { live = false; window.clearInterval(timer); };
  }, [saved, token, seed.id, accept]);
  const fileRows = saved?.attachments ?? [];
  return <>
    <WorkspaceDialog open onOpenChange={(_, data) => { if (!data.open) requestClose(); }}>
      <DialogSurface ref={surfaceRef} className="mail-composer" aria-labelledby="mail-composer-title" aria-busy={busy}>
        <header className="mail-composer-header"><div><p className="eyebrow">Личная почта · {email}</p>
          <h2 id="mail-composer-title">{mode === "preview" ? "Проверка перед отправкой" : mode === "close" ? "Закрыть без сохранения?" : mode === "reload" ? "Загрузить сохранённую версию?" : saved && !editable ? mailStateLabels[saved.status] : "Письмо"}</h2></div>
          <Button disabled={busy} onClick={requestClose}>Закрыть редактор</Button></header>
        <div className="mail-composer-body">
          {error && <WorkspaceNotice tone="error" role="alert">{error}</WorkspaceNotice>}
          {notice && <p role="status">{notice}</p>}
          {saved?.error && <WorkspaceNotice tone={saved.status === "unknown" ? "warning" : "error"}>{saved.error}</WorkspaceNotice>}
          {mode === "close" || mode === "reload" ? <p>Несохранённые изменения в этом окне будут потеряны. Сохранённый черновик останется в Workspace.</p>
            : mode === "preview" && saved ? <article className="mail-preview-paper" aria-label="Предпросмотр исходящего письма">
              <dl><dt>От кого</dt><dd>{email}</dd><dt>Кому</dt><dd>{saved.to.join(", ")}</dd>
                {saved.cc.length > 0 && <><dt>Копия</dt><dd>{saved.cc.join(", ")}</dd></>}
                {saved.bcc.length > 0 && <><dt>Скрытая копия</dt><dd>{saved.bcc.join(", ")}</dd></>}
                <dt>Тема</dt><dd>{saved.subject || "Без темы"}</dd></dl><p className="mail-preserve">{saved.body}</p>
              <h3>Вложения · {fileRows.length}</h3><ul>{fileRows.map(file => <li key={file.id}>{file.fileName}{file.signedLetterId ? " · Подписанный PDF" : ""}</li>)}</ul>
              <p className="mail-muted">Версия {saved.revision}. Подтвердите адресатов и документы. Принятие Gmail не является подтверждением доставки или прочтения.</p>
            </article> : <>
              <div className="mail-fields">
                <label><span>Кому *</span><input value={fields.to} maxLength={8000} disabled={!editable || busy} placeholder="name@gmail.com, colleague@example.com" onChange={event => setFields({ ...fields, to: event.target.value })} /></label>
                <Button appearance="subtle" aria-expanded={copies} onClick={() => setCopies(!copies)}>Копия и скрытая копия</Button>
                {copies && <div className="mail-copy-fields"><label><span>Копия</span><input value={fields.cc} maxLength={8000} disabled={!editable || busy} onChange={event => setFields({ ...fields, cc: event.target.value })} /></label>
                  <label><span>Скрытая копия</span><input value={fields.bcc} maxLength={8000} disabled={!editable || busy} onChange={event => setFields({ ...fields, bcc: event.target.value })} /></label></div>}
                <label><span>Тема *</span><input value={fields.subject} maxLength={500} disabled={!editable || busy} onChange={event => setFields({ ...fields, subject: event.target.value })} /></label>
                <label><span>Текст письма</span><textarea rows={10} value={fields.body} maxLength={100000} disabled={!editable || busy} onChange={event => setFields({ ...fields, body: event.target.value })} /></label>
              </div>
              <section className="mail-compose-files"><h3>Вложения · {fileRows.length}</h3>
                <p className="mail-muted">До 20 файлов общим размером до 18 МБ. Для добавления файлов сначала сохраните черновик.</p>
                <ul>{fileRows.map(file => <li key={file.id}><span>{file.fileName}{file.signedLetterId && <small>Подписанный PDF · защищённая копия</small>}</span>
                  {mailFilePreviewable(file) && <Button disabled={busy} onClick={() => setPreviewFile({ ...file, byteSize: file.sizeBytes })}>Посмотреть</Button>}
                  <Button disabled={busy} onClick={() => void run(async () => saveMailBlob(await loadMailFileBlob(token, { ...file, byteSize: file.sizeBytes }), file.fileName))}>Скачать</Button>
                  {editable && saved && <Button disabled={busy} onClick={() => void run(async () => accept(await removeMailFile(token, saved.id, file.id, saved.revision)))}>Убрать</Button>}</li>)}</ul>
                {editable && <label className="mail-upload"><span>Прикрепить файл</span><input aria-label="Прикрепить файл к письму" type="file" disabled={!saved || busy || dirty} onChange={event => {
                  const file = event.target.files?.[0]; event.target.value = "";
                  if (file && saved) void run(async () => accept(await uploadMailFile(token, saved.id, file, saved.revision)));
                }} /></label>}
                {editable && saved && canUseSigned && <div className="mail-signed-picker">
                  <Button disabled={busy || dirty} onClick={() => void run(async () => setSigned(await loadMailSignedFiles(token)))}>Подписанные PDF из «На подпись»</Button>
                  {signed && <><label><span>Готовый подписанный PDF</span><select aria-label="Готовый подписанный PDF" value={signedId} onChange={event => setSignedId(event.target.value)}><option value="">Выберите документ</option>{signed.map(file => <option key={file.id} value={file.id}>{file.title} · {file.fileName}</option>)}</select></label>
                    {!signed.length && <p>Ваших готовых подписанных PDF пока нет.</p>}
                    <Button disabled={!signedId || busy || dirty} onClick={() => void run(async () => accept(await attachMailSignedFile(token, saved.id, signedId, saved.revision)))}>Добавить подписанный PDF</Button></>}
                </div>}
                {editable && seed.source && seed.source.attachments.length > 0 && <div><h4>Выбрать вложения исходного письма</h4>{seed.source.attachments.map(file => <Button key={file.id} disabled={!saved || dirty || busy || copied.includes(file.id)} onClick={() => {
                  if (saved && seed.source) void run(async () => { accept(await attachMailProviderFile(token, saved.id, seed.source!.id, file.id, saved.revision)); setCopied(current => [...current, file.id]); });
                }}>{copied.includes(file.id) ? "Добавлено: " : "Добавить: "}{file.fileName}</Button>)}</div>}
              </section>
            </>}
        </div>
        <footer className="mail-composer-footer">
          {mode === "close" ? <><Button disabled={busy} onClick={() => setMode("edit")}>Продолжить редактирование</Button><Button disabled={busy} onClick={onClose}>Закрыть без сохранения</Button></>
            : mode === "reload" ? <><Button disabled={busy} onClick={() => setMode("edit")}>Оставить мой текст</Button><Button disabled={busy} onClick={() => void run(async () => {
              const result = await loadMailDraft(token, seed.id); accept(result); setFields(editorFields(result)); setMode("edit");
            })}>Загрузить сохранённую версию</Button></>
            : mode === "preview" && saved ? <><Button disabled={busy} onClick={() => setMode("edit")}>Вернуться к письму</Button>
              <Button appearance="primary" disabled={busy || !sendingEnabled} onClick={() => void run(async () => {
                const result = await sendMailDraft(token, saved.id, saved.revision, operationId.current); accept(result); setMode("edit");
              })}>{busy ? "Подтверждаем…" : "Подтвердить отправку через Gmail"}</Button></>
            : <>
              {editable && <><Button disabled={busy} onClick={() => void save()}>Сохранить черновик</Button>
                <Button appearance="primary" disabled={busy || !sendingEnabled || !fields.to.trim() || !fields.subject.trim()} onClick={() => { void save().then(result => { if (result) setMode("preview"); }); }}>Предпросмотр и отправка</Button></>}
              {saved?.status === "unknown" && <Button disabled={busy} onClick={() => void run(async () => accept(await reconcileMailDraft(token, saved.id)))}>Проверить папку «Отправленные»</Button>}
              {saved && <Button disabled={busy} onClick={() => setMode("reload")}>Перечитать сохранённую версию</Button>}
              {!sendingEnabled && editable && <p>Отправка отключена на сервере. Доступно сохранение черновиков.</p>}
            </>}
        </footer>
      </DialogSurface>
    </WorkspaceDialog>
    {previewFile && <MailAttachmentViewer token={token} file={previewFile} onClose={() => setPreviewFile(undefined)} />}
  </>;
}
