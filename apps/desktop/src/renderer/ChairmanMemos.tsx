import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Button, DialogSurface, Field, Select, Spinner, Textarea, useRestoreFocusTarget } from "@fluentui/react-components";
import { DocumentText24Regular, Dismiss20Regular, Add20Regular, ArrowDownload20Regular } from "@fluentui/react-icons";
import type { ChairmanMemo, ChairmanMemoContext, ChairmanMemoRegistry, ChairmanMemoStatus, MemoDocumentScript } from "@yuksalish/contracts";
import { Input } from "./WorkspaceInput";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { CompanyLogo } from "./CompanyLogo";
import {
  attachChairmanMemoOrder, downloadChairmanMemoOrder, actOnChairmanMemo, createChairmanMemo, downloadChairmanMemoPdf, loadChairmanMemo,
  loadChairmanMemoContext, loadChairmanMemos, saveChairmanMemo,
} from "./workspace-api";
import "./chairman-memos.css";

const PdfViewer = lazy(() => import("./FileViewer").then(module => ({ default: module.ExternalFileViewer })));
const labels: Readonly<Record<ChairmanMemoStatus, string>> = {
  hr_pending: "У кадровика · подготовка приказа", accountant_pending: "У главного бухгалтера", completed: "Выполнено",
  draft: "Черновик", pending: "На согласовании", approved: "Одобрено председателем", needs_revision: "На доработке",
};
const message = (error: unknown) => error instanceof Error ? error.message : "Не удалось загрузить билдирги";
const date = (value: string) => new Date(value).toLocaleDateString("ru-RU", { timeZone: "Asia/Tashkent" });

export function ChairmanMemoLauncher({ token, userId, onOpen, compact = false }: {
  readonly token: string; readonly userId: string; readonly onOpen: () => void; readonly compact?: boolean;
}) {
  const [state, setState] = useState<{ readonly identity: string; readonly data: ChairmanMemoContext }>();
  const [failedIdentity, setFailedIdentity] = useState<string>();
  const identity = JSON.stringify([token, userId]);
  const focus = useRestoreFocusTarget();
  useEffect(() => {
    const controller = new AbortController();
    const load = () => { void loadChairmanMemoContext(token, controller.signal).then(data => {
      if (!controller.signal.aborted) { setState({ identity, data }); setFailedIdentity(undefined); }
    }).catch(() => { if (!controller.signal.aborted) setFailedIdentity(identity); }); };
    load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
    window.addEventListener("focus", load);
    window.addEventListener("chairman-memos-changed", load);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", load); window.removeEventListener("chairman-memos-changed", load); };
  }, [identity, token]);
  const data = state?.identity === identity ? state.data : undefined;
  const failed = failedIdentity === identity;
  if (!data?.enabled) return null;
  return <button {...focus} type="button" className={compact ? "memo-home-launch" : "team-dash-metric tone-brand"}
    aria-haspopup="dialog" onClick={onOpen}>
    <span className="team-dash-metric-icon" aria-hidden="true"><DocumentText24Regular /></span>
    <span className="team-dash-metric-copy"><span>{data.canReview ? "Билдирги на согласование" : "Билдирги председателю"}</span>
      <small>{failed ? "Не удалось обновить · открыть и повторить" : data.configurationError ? "Проверьте настройку адресата" : data.canReview ? "документы на вашем этапе обработки" : "написать обращение · посмотреть решение"}</small></span>
    <strong>{failed ? "—" : data.canReview ? data.pendingCount : "+"}</strong>
  </button>;
}

export function ChairmanMemosDialog({ token, userId, initialId, onClose }: {
  readonly token: string; readonly userId: string; readonly initialId?: string; readonly onClose: () => void;
}) {
  const [context, setContext] = useState<ChairmanMemoContext>();
  const [registry, setRegistry] = useState<ChairmanMemoRegistry>();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ChairmanMemo>();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<"memo" | "order">();
  const [script, setScript] = useState<MemoDocumentScript>("cyrillic");
  const [orderFile, setOrderFile] = useState<File>();
  const requestId = useRef(crypto.randomUUID());
  const alive = useRef(true);
  const dirty = (creating && Boolean(title || body)) || Boolean(selected?.canEdit && (title !== selected.title || body !== selected.body || script !== (selected.documentScript ?? (/[а-яёўқғҳ]/i.test(selected.body) ? "cyrillic" : "latin"))));
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const [nextContext, nextRegistry] = await Promise.all([
      loadChairmanMemoContext(token, signal), loadChairmanMemos(token, offset, signal),
    ]);
    if (!signal?.aborted && alive.current) { setContext(nextContext); setRegistry(nextRegistry); }
  }, [token, offset]);
  const choose = useCallback((memo: ChairmanMemo) => {
    setScript(memo.documentScript ?? (/[а-яёўқғҳ]/i.test(memo.body) ? "cyrillic" : "latin")); setOrderFile(undefined);
    setSelected(memo); setCreating(false); setTitle(memo.title); setBody(memo.body); setComment(""); setError("");
  }, []);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void refresh(controller.signal).then(async () => {
      if (initialId) {
        const memo = await loadChairmanMemo(token, initialId, controller.signal);
        if (!controller.signal.aborted) choose(memo);
      }
    }).catch(problem => { if (!controller.signal.aborted) setError(message(problem)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { alive.current = false; controller.abort(); };
  }, [token, userId, refresh, initialId, choose]);
  const mayLeave = () => !dirty || window.confirm("Продолжить без сохранения текста билдирги?");
  const close = () => { if (!busy && mayLeave()) onClose(); };
  const open = async (id: string) => {
    if (busy || !mayLeave()) return;
    setBusy(true); setError("");
    try { const memo = await loadChairmanMemo(token, id); if (alive.current) choose(memo); }
    catch (problem) { if (alive.current) setError(message(problem)); }
    finally { if (alive.current) setBusy(false); }
  };
  const mutate = async (operation: () => Promise<ChairmanMemo>) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const memo = await operation();
      if (!alive.current) return;
      choose(memo);
      window.dispatchEvent(new Event("chairman-memos-changed"));
      // Saving already succeeded; a list refresh failure must not invite another mutation.
      try { await refresh(); } catch { setError("Билдирги сохранена. Список временно не обновился; обновите его вручную."); }
    } catch (problem) { if (alive.current) setError(message(problem)); }
    finally { if (alive.current) setBusy(false); }
  };
  const persist = () => void mutate(() => selected
    ? saveChairmanMemo(token, selected, { title, body, documentScript: script })
    : createChairmanMemo(token, { title, body, documentScript: script }, requestId.current));
  const download = async (order = false) => {
    if (!selected) return;
    const blob = await (order ? downloadChairmanMemoOrder(token, selected.id) : downloadChairmanMemoPdf(token, selected.id));
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = order ? selected.orderFileName ?? `order-${selected.id}.pdf` : `bildirgi-${selected.id}.pdf`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const form = creating || selected;
  const editing = creating || selected?.canEdit;
  const paper = editing ? context?.documentLabels?.[script] : selected?.documentLabels;
  const stage = selected?.status === "hr_pending" ? 1 : selected?.status === "accountant_pending" ? 2 : selected?.status === "completed" ? 3 : 0;
  return <>
    <WorkspaceDialog open={!preview} onOpenChange={(_, data) => { if (!data.open) close(); }}>
      <DialogSurface className="memo-dialog" aria-labelledby="memo-dialog-title">
        <header className="memo-dialog-header"><div><span className="memo-eyebrow">Обращения председателю</span><h2 id="memo-dialog-title">Билдирги</h2></div>
          <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть билдирги" onClick={close} disabled={busy} /></header>
        {error ? <WorkspaceNotice tone="error" role="alert">{error}</WorkspaceNotice> : null}
        {loading ? <div className="memo-loading" role="status"><Spinner label="Загружаем билдирги…" /></div> : <div className="memo-workspace">
          <aside className="memo-list" aria-label="Ваши билдирги">
            <div className="memo-list-tools">
              {context?.canCreate ? <Button appearance="primary" icon={<Add20Regular />} disabled={busy || Boolean(context.configurationError)} onClick={() => {
                if (!mayLeave()) return;
                setSelected(undefined); setCreating(true); setScript("cyrillic"); setOrderFile(undefined); setTitle(""); setBody(""); setComment(""); setError(""); requestId.current = crypto.randomUUID();
              }}>Написать билдирги</Button> : null}
              <Button disabled={busy} onClick={() => { setError(""); void refresh().catch(problem => setError(message(problem))); }}>Обновить список</Button>
            </div>
            {context?.configurationError ? <WorkspaceNotice tone="error">{context.configurationError}</WorkspaceNotice> : null}
            {registry?.items.map(item => <button key={item.id} type="button" className="memo-list-item" aria-current={selected?.id === item.id ? "true" : undefined}
              disabled={busy} onClick={() => { void open(item.id); }}>
              <span className="memo-status" data-status={item.status}>{labels[item.status]}</span><strong>{item.title}</strong>
              <span>{item.requesterName}</span><small>{date(item.createdAt)}</small>
            </button>)}
            {registry?.items.length === 0 ? <p className="memo-empty">Здесь появятся ваши обращения и решения по ним.</p> : null}
            {registry && registry.total > 50 ? <nav className="memo-pagination" aria-label="Страницы билдирги">
              <Button disabled={busy || offset === 0} onClick={() => { if (mayLeave()) { setLoading(true); setOffset(value => Math.max(0, value - 50)); setCreating(false); setSelected(undefined); } }}>Назад</Button>
              <span>{offset + 1}–{Math.min(offset + 50, registry.total)} из {registry.total}</span>
              <Button disabled={busy || offset + 50 >= registry.total} onClick={() => { if (mayLeave()) { setLoading(true); setOffset(value => value + 50); setCreating(false); setSelected(undefined); } }}>Далее</Button>
            </nav> : null}
          </aside>
          <section className="memo-editor" aria-label="Содержание билдирги">
            {!form ? <div className="memo-welcome"><DocumentText24Regular /><h3>{context?.canReview ? "Билдирги на вашем решении" : "Обращение на фирменном бланке"}</h3><p>{context?.canReview ? "Выберите обращение, ознакомьтесь с текстом и PDF, затем примите решение." : "Напишите текст полностью. Адресат, шапка и заявитель заполнятся автоматически."}</p></div> : <>
              <div className="memo-editor-toolbar"><span className="memo-status" data-status={selected?.status ?? "draft"}>{labels[selected?.status ?? "draft"]}</span>
                {selected ? <Button disabled={busy} onClick={() => { void open(selected.id); }}>Обновить карточку</Button> : null}
                {selected?.hasPdf ? <><Button disabled={busy || dirty} onClick={() => setPreview("memo")}>Посмотреть PDF</Button>
                  <Button icon={<ArrowDownload20Regular />} disabled={busy || dirty} onClick={() => { void download().catch(problem => setError(message(problem))); }}>Скачать PDF</Button></> : null}
              </div>
              <Field label="Тема обращения" required><Input value={title} maxLength={160} disabled={!editing || busy} onChange={(_, data) => setTitle(data.value)} /></Field>
              <Field label="Алфавит документа" hint={editing ? "Текст, шапка и заявитель приводятся к выбранному алфавиту при сохранении. Проверьте ФИО перед отправкой." : selected && !selected.documentScript ? "Ранее сохранённый PDF не изменялся. Новый формат применяется при сохранении черновика." : undefined}>
                <Select aria-label="Алфавит документа" value={selected && !editing && !selected.documentScript ? "legacy" : script} disabled={!editing || busy} onChange={(_, data) => { if (data.value === "latin" || data.value === "cyrillic") setScript(data.value); }}>
                  {selected && !editing && !selected.documentScript ? <option value="legacy">Сохранённый макет · без изменений</option> : null}
                  <option value="cyrillic">Ўзбекча · кириллица</option><option value="latin">O‘zbekcha · латиница</option>
                </Select>
              </Field>
              {selected && !["draft", "needs_revision"].includes(selected.status) ? <ol className="memo-route" aria-label="Маршрут билдирги">
                {["Председатель", "Кадровик · приказ", "Главный бухгалтер", "Выполнено"].map((name, index) => <li key={name} aria-current={stage === index ? "step" : undefined} data-done={index < stage}>{name}</li>)}
              </ol> : null}
              {selected && (selected.hrName || selected.canAttachOrder || selected.orderFileName) ? <section className="memo-order" aria-label="Приказ и исполнение">
                <h3>Приказ и исполнение</h3>
                <p>Кадровик: {selected.hrName ?? "не назначен"} · Главный бухгалтер: {selected.accountantName ?? "не назначен"}</p>
                {selected.canAttachOrder ? <>
                  <Field label="Приказ в PDF" hint="До 10 МБ. Передача бухгалтеру доступна после загрузки приказа.">
                    <input aria-label="Выбрать приказ в PDF" type="file" accept=".pdf,application/pdf" disabled={busy} onChange={event => setOrderFile(event.currentTarget.files?.[0])} />
                  </Field>
                  {orderFile ? <div><span>{orderFile.name}</span> <Button disabled={busy} onClick={() => { void mutate(() => attachChairmanMemoOrder(token, selected, orderFile)); }}>Загрузить приказ</Button></div> : null}
                </> : null}
                {selected.orderFileName ? <div className="memo-editor-toolbar"><strong>{selected.orderFileName}</strong><Button disabled={busy} onClick={() => setPreview("order")}>Посмотреть приказ</Button><Button disabled={busy} onClick={() => { void download(true).catch(problem => setError(message(problem))); }}>Скачать приказ</Button></div> : null}
                {selected.completedAt ? <p>Выполнено главным бухгалтером {date(selected.completedAt)}</p> : null}
              </section> : null}
              <div className="memo-paper">
                <div className="memo-paper-brand"><span>HARAKAT</span><CompanyLogo tone="color" /><span>MOVEMENT</span></div>
                <div className="memo-recipient">{paper?.recipient_label ?? "“Yuksalish” harakati raisi"}<br /><strong>{paper?.recipient ?? selected?.chairName ?? context?.chairName}</strong></div>
                <h3>{paper?.heading ?? "BILDIRGI"}</h3>
                {editing ? <Field label="Текст билдирги" required hint={`${body.length.toLocaleString("ru-RU")} / 20 000 знаков`}>
                  <Textarea className="memo-body-input" value={body} resize="vertical" rows={13} maxLength={20000} disabled={busy} onChange={(_, data) => setBody(data.value)} placeholder="Напишите полный текст обращения…" />
                </Field> : <div className="memo-body">{body.split(/\r?\n/).map((paragraph, index) => <p key={index}>{paragraph || "\u00a0"}</p>)}</div>}
                <footer className="memo-applicant"><span>{paper?.job_title ?? selected?.requesterTitle ?? context?.requesterTitle}</span><strong>{paper?.requester ?? selected?.requesterName ?? context?.requesterName}</strong></footer>
              </div>
              {selected?.decisionComment ? <WorkspaceNotice tone="info"><strong>Комментарий председателя</strong><p className="memo-body">{selected.decisionComment}</p></WorkspaceNotice> : null}
              {selected?.decidedAt ? <p className="memo-decision-date">Решение принято {date(selected.decidedAt)}</p> : null}
          {selected?.canDecide ? <Field label="Комментарий к решению" hint="При возврате на доработку укажите, что исправить."><Textarea value={comment} maxLength={2000} disabled={busy} onChange={(_, data) => setComment(data.value)} /></Field> : null}
            </>}
          </section>
        </div>}
        <footer className="memo-dialog-footer"><span role="status">{busy ? "Сохраняем…" : dirty ? "Есть несохранённый текст" : selected?.status === "approved" ? "Одобренный документ сохранён" : ""}</span><div>
          {editing ? <Button appearance="secondary" disabled={busy || !title.trim() || !body.trim() || (!creating && !dirty)} onClick={persist}>{creating ? "Сохранить черновик" : "Сохранить изменения"}</Button> : null}
          {selected?.canSubmit ? <Button appearance="primary" disabled={busy || dirty} onClick={() => { void mutate(() => actOnChairmanMemo(token, selected, "submit")); }}>Отправить председателю</Button> : null}
          {selected?.canWithdraw ? <Button disabled={busy} onClick={() => { void mutate(() => actOnChairmanMemo(token, selected, "withdraw")); }}>Отозвать для правки</Button> : null}
              {selected?.canStartProcessing ? <Button appearance="primary" disabled={busy} onClick={() => { void mutate(() => actOnChairmanMemo(token, selected, "start-processing")); }}>Продолжить оформление у кадровика</Button> : null}
          {selected?.canAttachOrder ? <Button appearance="primary" disabled={busy || !selected.orderFileName || Boolean(orderFile)} onClick={() => { void mutate(() => actOnChairmanMemo(token, selected, "hr-complete")); }}>Утвердить и передать бухгалтеру</Button> : null}
          {selected?.canComplete ? <Button appearance="primary" disabled={busy} onClick={() => { void mutate(() => actOnChairmanMemo(token, selected, "complete")); }}>Выполнено</Button> : null}
          {selected?.canDecide ? <><Button disabled={busy || !comment.trim()} onClick={() => { void mutate(() => actOnChairmanMemo(token, selected, "return", comment)); }}>Вернуть на доработку</Button>
            <Button appearance="primary" disabled={busy} onClick={() => { void mutate(() => actOnChairmanMemo(token, selected, "approve", comment)); }}>Одобрить билдирги</Button></> : null}
          <Button onClick={close} disabled={busy}>Закрыть</Button>
        </div></footer>
      </DialogSurface>
    </WorkspaceDialog>
    {preview && selected ? <Suspense fallback={<Spinner label="Открываем PDF…" />}><PdfViewer
      attachment={{ id: selected.id, fileName: preview === "order" ? selected.orderFileName ?? "order.pdf" : `bildirgi-${selected.id}.pdf`, contentType: "application/pdf", byteSize: preview === "order" ? selected.orderByteSize ?? 0 : selected.pdfByteSize }}
      onClose={() => setPreview(undefined)} onLoad={(_, signal) => preview === "order" ? downloadChairmanMemoOrder(token, selected.id, signal) : downloadChairmanMemoPdf(token, selected.id, signal)}
      onLoadOffice={() => Promise.reject(new Error("Документ уже в PDF"))} onDownload={() => download(preview === "order")}
    /></Suspense> : null}
  </>;
}
