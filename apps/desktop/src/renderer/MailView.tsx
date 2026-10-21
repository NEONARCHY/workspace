import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Checkbox, DialogSurface, Spinner } from "@fluentui/react-components";
import type { MailConnect, MailConnection, MailDraft, MailDraftSummary, MailFields, MailMessage,
  MailMessageSummary, MailPage, MailThread, TaskProjectOption, WorkspaceDepartment, WorkspacePerson, WorkspaceTask } from "@yuksalish/contracts";
import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { TaskComposer } from "./TaskComposer";
import { MailComposer, mailStateLabels, type MailEditorSeed } from "./MailComposer";
import { MailAttachmentViewer, loadMailFileBlob, mailFilePreviewable, saveMailBlob, type MailFileSource } from "./mail-preview";
import { validatedGoogleMailLink } from "../shared/google-mail-link";
import { workspacePlatform } from "./platform-adapter";
import { cancelMailConnect, connectMail, createTaskFromMail, disconnectMail, loadMailConnectStatus,
  loadMailConnection, loadMailDraft, loadMailDrafts, loadMailMessages, loadMailThread, loadTaskProjectOptions } from "./workspace-api";
import "./mail.css";

interface Props {
  readonly token: string; readonly currentUserId: string; readonly people: readonly WorkspacePerson[];
  readonly departments: readonly WorkspaceDepartment[]; readonly tasks: readonly WorkspaceTask[];
  readonly canCreate: boolean; readonly canEdit: boolean; readonly canCreateTask: boolean;
  readonly canUseSigned: boolean; readonly onTaskCreated: (task: WorkspaceTask) => void;
}
const folders = { inbox: "Входящие", sent: "Отправленные Gmail", starred: "Избранное", all: "Вся почта", drafts: "Черновики Workspace", outbox: "Очередь и квитанции" } as const;
type Folder = keyof typeof folders;
interface TaskSelection { readonly source: MailMessage; readonly operationId: string; readonly files: readonly string[]; readonly includeBody: boolean; }
const emptyFields: MailFields = { to: [], cc: [], bcc: [], subject: "", body: "" };
function errorText(value: unknown) { return value instanceof Error ? value.message : "Действие не выполнено"; }
function date(value: string) { return new Date(value).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" }); }
function replyAddress(value: string): string[] {
  const address = value.match(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}/)?.[0];
  return address ? [address] : [];
}

export function MailView({ token, currentUserId, people, departments, tasks, canCreate, canEdit, canCreateTask, canUseSigned, onTaskCreated }: Props) {
  const [account, setAccount] = useState<MailConnection>(); const [connecting, setConnecting] = useState<MailConnect>();
  const [folder, setFolder] = useState<Folder>("inbox"); const [query, setQuery] = useState(""); const [search, setSearch] = useState("");
  const [pageTokens, setPageTokens] = useState<readonly string[]>([""]); const pageToken = pageTokens.at(-1) ?? "";
  const [page, setPage] = useState<MailPage>(); const [drafts, setDrafts] = useState<readonly MailDraftSummary[]>([]);
  const [selected, setSelected] = useState<MailMessageSummary>(); const [thread, setThread] = useState<MailThread>();
  const [editor, setEditor] = useState<MailEditorSeed>(); const [previewFile, setPreviewFile] = useState<MailFileSource>();
  const [error, setError] = useState(""); const [threadError, setThreadError] = useState(""); const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [disconnecting, setDisconnecting] = useState(false); const requestSequence = useRef(0);
  const [taskSelection, setTaskSelection] = useState<TaskSelection>(); const [taskStage, setTaskStage] = useState<"select" | "compose">("select");
  const [projects, setProjects] = useState<readonly TaskProjectOption[]>([]); const [projectsError, setProjectsError] = useState(""); const [projectsLoading, setProjectsLoading] = useState(false);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const localFolder = folder === "drafts" || folder === "outbox";
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (busyRef.current) return undefined;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try { return await action(); } catch (failure) { setError(errorText(failure)); return undefined; }
    finally { busyRef.current = false; setBusy(false); }
  }
  const refreshConnection = useCallback(async () => {
    try { setAccount(await loadMailConnection(token)); setError(""); }
    catch (failure) { setError(errorText(failure)); }
  }, [token]);
  const refresh = useCallback(async () => {
    if (!account?.accountId) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      if (localFolder) {
        const loaded = await loadMailDrafts(token);
        if (sequence === requestSequence.current) { setDrafts(loaded); setError(""); }
      } else {
        const loaded = await loadMailMessages(token, folder, search, pageToken);
        if (sequence === requestSequence.current) { setPage(loaded); setError(""); }
      }
    } catch (failure) { if (sequence === requestSequence.current) setError(errorText(failure)); }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [account?.accountId, folder, localFolder, search, pageToken, token]);
  useEffect(() => {
    const start = window.setTimeout(() => { void refreshConnection(); }, 0);
    return () => window.clearTimeout(start);
  }, [refreshConnection]);
  useEffect(() => {
    const start = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { if (!document.hidden && !busyRef.current && !editor) void refresh(); }, 30_000);
    const focus = () => { if (!busyRef.current && !editor) { void refreshConnection(); void refresh(); } };
    window.addEventListener("focus", focus);
    return () => { window.clearTimeout(start); window.clearInterval(timer); window.removeEventListener("focus", focus); requestSequence.current += 1; };
  }, [refresh, refreshConnection, editor]);
  useEffect(() => {
    if (!connecting) return;
    let live = true;
    const timer = window.setInterval(() => { void loadMailConnectStatus(token, connecting.requestId).then(async status => {
      if (!live) return;
      if (status.status === "connected") { setConnecting(undefined); setNotice("Gmail подключён к вашему аккаунту Workspace"); await refreshConnection(); }
      if (status.status === "failed" || status.status === "expired") { setConnecting(undefined); setError("Подключение отменено или истекло. Начните подключение заново."); }
    }).catch(failure => { if (live) setError(errorText(failure)); }); }, 2500);
    return () => { live = false; window.clearInterval(timer); };
  }, [connecting, token, refreshConnection]);
  useEffect(() => {
    if (!selected || localFolder) return;
    let live = true; const controller = new AbortController();
    void loadMailThread(token, selected.threadId, controller.signal).then(value => { if (live) { setThread(value); setThreadError(""); } })
      .catch(failure => { if (live) setThreadError(errorText(failure)); });
    return () => { live = false; controller.abort(); };
  }, [selected, localFolder, token]);
  const acceptDraft = useCallback((draft: MailDraft) => setDrafts(current => [draft, ...current.filter(item => item.id !== draft.id)]), []);
  const openEditor = (fields: MailFields = emptyFields, source?: MailMessage, replyMessageId?: string) => setEditor({ id: crypto.randomUUID(), fields, source, replyMessageId });
  const openReply = (message: MailMessage, forward: boolean) => openEditor({
    ...emptyFields, to: forward ? [] : replyAddress(message.replyTo || message.sender),
    subject: forward ? `Fwd: ${message.subject}` : /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`,
    body: `\n\n--- ${forward ? "Пересылаемое письмо" : "Исходное письмо"} ---\nОт: ${message.sender}\nДата: ${date(message.receivedAt)}\nТема: ${message.subject}\n\n${message.body}`.slice(0,100000),
  }, message, forward ? undefined : message.id);
  const selectFolder = (next: Folder) => { setFolder(next); setPageTokens([""]); setPage(undefined); setSelected(undefined); setThread(undefined); setThreadError(""); };
  const loadProjects = useCallback(async () => {
    setProjectsLoading(true); setProjectsError("");
    try { setProjects(await loadTaskProjectOptions(token)); } catch (failure) { setProjectsError(errorText(failure)); }
    finally { setProjectsLoading(false); }
  }, [token]);
  const localDrafts = drafts.filter(item => folder === "drafts" ? ["draft", "failed"].includes(item.status) : item.status !== "draft")
    .filter(item => !search || `${item.subject} ${item.to.join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  const taskDescription = taskSelection ? `Письмо: ${taskSelection.source.subject}\nОт: ${taskSelection.source.sender}\nДата: ${date(taskSelection.source.receivedAt)}${taskSelection.includeBody ? `\n\n${taskSelection.source.body}` : ""}`.slice(0,19000) : "";
  return <section className="workspace-view mail-view" aria-label="Почта">
    <WorkspaceSectionHeader motif="messages"><div className="mail-header-copy"><p className="eyebrow">Gmail · личный ящик</p><h1>Почта</h1><p>{account?.email ?? "Подключите свой Gmail к рабочему пространству"}</p></div>
      <div className="mail-header-actions"><Button disabled={busy || loading} onClick={() => { void refreshConnection(); void refresh(); }}>Обновить</Button>
        {account?.accountId && canCreate && canEdit && <Button appearance="primary" disabled={busy} onClick={() => openEditor()}>Написать письмо</Button>}
        {canEdit && <Button disabled={busy || !account?.configured} onClick={() => void run(async () => setConnecting(await connectMail(token)))}>{account?.accountId ? "Переподключить Gmail" : "Подключить Gmail"}</Button>}
        {account?.accountId && canEdit && <Button disabled={busy} onClick={() => setDisconnecting(true)}>Отключить</Button>}</div>
    </WorkspaceSectionHeader>
    {error && <WorkspaceNotice tone="error" role="alert" actions={<Button onClick={() => { void refreshConnection(); void refresh(); }}>Повторить загрузку</Button>}>{error}</WorkspaceNotice>}
    {notice && <WorkspaceNotice tone="success" role="status">{notice}</WorkspaceNotice>}
    {!account && !error && <div role="status"><Spinner size="small" /> Проверяем подключение почты…</div>}
    {account && !account.configured && <WorkspaceNotice tone="warning">Почта ещё не настроена на сервере. Нужны Google OAuth, HTTPS-адрес подключения и отдельный ключ шифрования. Пароль Gmail вводить в Workspace не нужно.</WorkspaceNotice>}
    {connecting && <div className="mail-connect-card"><h2>Разрешите доступ на странице Google</h2><p>Подключается только выбранный вами ящик. Ссылка действует 10 минут. После разрешения вернитесь сюда.</p>
      <Button appearance="primary" disabled={busy} onClick={() => void run(async () => {
        const url = validatedGoogleMailLink(connecting.authorizationUrl, import.meta.env.DEV);
        if (!url) throw new Error("Сервер вернул недопустимый адрес авторизации Google");
        if (workspacePlatform.kind === "electron") {
          if (!await workspacePlatform.openMailAuthorization?.(url)) throw new Error("Откройте подключение из активного окна обновлённого приложения");
        } else window.open(url, "_blank", "noopener,noreferrer");
      })}>Продолжить в Google</Button>
      <Button disabled={busy} onClick={() => void run(async () => { await cancelMailConnect(token, connecting.requestId); setConnecting(undefined); })}>Отменить подключение</Button></div>}
    {account?.configured && !account.accountId && !connecting && <div className="mail-empty"><h2>Ваша почта — только для вас</h2><p>После подключения здесь появятся письма и переписка. Другие сотрудники и администраторы приложения не получат доступ к ящику.</p></div>}
    {account?.accountId && <>
      {!account.sendingEnabled && <WorkspaceNotice tone="warning">Отправка Gmail отключена на сервере. Можно читать почту и сохранять черновики.</WorkspaceNotice>}
      <div className="mail-workspace" data-detail={Boolean(selected)}>
        <nav className="mail-folders" aria-label="Папки почты">{Object.entries(folders).map(([key,label]) => <Button key={key} aria-pressed={folder === key} appearance={folder === key ? "primary" : "subtle"} onClick={() => selectFolder(key as Folder)}>{label}</Button>)}<p className="mail-muted">Чтение не меняет отметку «непрочитано» в Gmail. Внешние изображения и скрипты не загружаются.</p></nav>
        <section className="mail-list" aria-label={folders[folder]} aria-busy={loading}>
          <form className="mail-search" onSubmit={event => { event.preventDefault(); setSearch(query); setPageTokens([""]); }}><label><span>Поиск писем</span><input value={query} maxLength={300} onChange={event => setQuery(event.target.value)} placeholder="Тема, отправитель, текст" /></label><Button type="submit" disabled={loading}>Найти</Button></form>
          <div className="mail-list-scroll">
            {loading && !page && !localFolder && <p role="status">Загружаем письма…</p>}
            {localFolder ? localDrafts.map(draft => <button className="mail-row" key={draft.id} onClick={() => void run(async () => {
              const full = await loadMailDraft(token, draft.id); setEditor({ id: full.id, draft: full, fields: full });
            })}><strong>{draft.subject || "Без темы"}</strong><span>{draft.to.join(", ") || "Получатель не выбран"}</span><small>{mailStateLabels[draft.status]} · {date(draft.updatedAt)}</small></button>)
              : page?.messages.map(message => <button className="mail-row" key={message.id} aria-pressed={selected?.id === message.id} onClick={event => {
                selectedButton.current = event.currentTarget; setThread(undefined); setThreadError(""); setSelected(message);
              }}><span className="mail-sender">{message.sender}{message.unread && <small>Непрочитано</small>}</span><strong>{message.subject || "Без темы"}</strong><span>{message.snippet}</span><small>{date(message.receivedAt)}</small></button>)}
            {!loading && ((localFolder && !localDrafts.length) || (!localFolder && page && !page.messages.length)) && <p className="mail-empty">Писем в этом списке нет.</p>}
          </div>
          {!localFolder && <footer className="mail-pagination"><Button disabled={pageTokens.length === 1 || loading} onClick={() => { setPageTokens(current => current.slice(0,-1)); setPage(undefined); }}>Предыдущие</Button><span>Страница {pageTokens.length}</span><Button disabled={!page?.nextPageToken || loading} onClick={() => { if (page?.nextPageToken) setPageTokens(current => [...current, page.nextPageToken!]); setPage(undefined); }}>Следующие</Button></footer>}
          {localFolder && <p className="mail-muted">Показаны последние 100 записей Workspace. Это не папка черновиков Gmail.</p>}
        </section>
        <section className="mail-reader" aria-label="Переписка">
          {selected && <header className="mail-reader-header"><Button onClick={() => { setSelected(undefined); setThread(undefined); window.requestAnimationFrame(() => selectedButton.current?.focus()); }}>К списку писем</Button><h2>{selected.subject || "Без темы"}</h2></header>}
          {!selected && <div className="mail-empty"><h2>Выберите письмо</h2><p>Откройте переписку, ответьте или создайте задачу из нужного сообщения.</p></div>}
          {selected && !thread && !threadError && <p role="status">Открываем переписку…</p>}
          {threadError && <WorkspaceNotice tone="error" role="alert" actions={<Button onClick={() => setSelected(current => current ? { ...current } : undefined)}>Повторить</Button>}>{threadError}</WorkspaceNotice>}
          {selected && thread?.truncated && <WorkspaceNotice tone="warning">Показаны последние 30 сообщений этой переписки.</WorkspaceNotice>}
          {selected && thread?.messages.map(message => <article className="mail-message" key={message.id}><header><strong>{message.sender}</strong><time dateTime={message.receivedAt}>{date(message.receivedAt)}</time><small>Кому: {message.recipients}</small></header>
            <p className="mail-preserve">{message.body || "Текст письма отсутствует. Проверьте вложения."}</p>
            {message.attachments.length > 0 && <ul className="mail-file-list">{message.attachments.map(file => {
              const source: MailFileSource = { ...file, byteSize: file.sizeBytes, messageId: message.id };
              return <li key={file.id}><span>{file.fileName}</span>{mailFilePreviewable(file) && <Button onClick={() => setPreviewFile(source)}>Посмотреть</Button>}<Button disabled={busy} onClick={() => void run(async () => saveMailBlob(await loadMailFileBlob(token, source), source.fileName))}>Скачать</Button></li>;
            })}</ul>}
            <footer>{canCreate && canEdit && <><Button onClick={() => openReply(message, false)}>Ответить</Button><Button onClick={() => openReply(message, true)}>Переслать</Button></>}
              {canCreateTask && <Button onClick={() => { setTaskSelection({ source: message, operationId: crypto.randomUUID(), files: [], includeBody: true }); setTaskStage("select"); }}>Создать задачу</Button>}</footer>
          </article>)}
        </section>
      </div>
    </>}
    {editor && account?.email && <MailComposer key={editor.id} token={token} email={account.email} seed={editor} canEdit={canCreate && canEdit} sendingEnabled={account.sendingEnabled} canUseSigned={canUseSigned} onSaved={acceptDraft} onClose={() => setEditor(undefined)} />}
    {previewFile && <MailAttachmentViewer token={token} file={previewFile} onClose={() => setPreviewFile(undefined)} />}
    <ConfirmActionDialog open={disconnecting} title="Отключить Gmail?" confirmLabel="Отключить Gmail" busyLabel="Отключаем…" busy={busy}
      message="Ключи доступа, черновики и файлы личной почты будут удалены из Workspace. Оригиналы в Gmail и уже переданные в задачи копии сохранятся. Это не отзывает отправленные письма."
      onCancel={() => { if (!busyRef.current) setDisconnecting(false); }} onConfirm={() => run(async () => {
        const result = await disconnectMail(token); requestSequence.current += 1; setAccount(current => current ? { ...current, accountId: null, email: null } : current);
        setPage(undefined); setThread(undefined); setSelected(undefined); setDrafts([]); setEditor(undefined); setConnecting(undefined); setTaskSelection(undefined); setPreviewFile(undefined); setDisconnecting(false);
        setNotice(result.googleRevoked ? "Gmail отключён. Оригиналы писем не изменены." : "Gmail отключён в Workspace. Google недоступен: дополнительно отзовите доступ в настройках своего Google-аккаунта.");
      })} />
    <WorkspaceDialog open={Boolean(taskSelection) && taskStage === "select"} onOpenChange={(_,data) => { if (!data.open) setTaskSelection(undefined); }}>
      <DialogSurface className="mail-composer" aria-labelledby="mail-task-selection-title"><header className="mail-composer-header"><h2 id="mail-task-selection-title">Что передать в задачу</h2></header><div className="mail-composer-body">
        <p>Исполнители увидят только описание задачи и выбранные файлы. Доступ к вашему Gmail им не предоставляется. В следующем окне текст можно изменить.</p>
        {taskSelection && <><strong>{taskSelection.source.subject}</strong><Checkbox label="Включить текст выбранного письма" checked={taskSelection.includeBody} onChange={(_,data) => setTaskSelection({ ...taskSelection, includeBody: Boolean(data.checked) })} />
          {taskSelection.source.body.length > 18500 && <p>Письмо длинное: в редактор попадёт начало текста. Проверьте и сократите его до нужного содержания.</p>}
          <div className="mail-task-snapshot mail-preserve">{taskDescription}</div><h3>Вложения для исполнителей</h3>
          {taskSelection.source.attachments.map(file => <Checkbox key={file.id} label={file.fileName} checked={taskSelection.files.includes(file.id)} onChange={(_,data) => setTaskSelection({ ...taskSelection, files: data.checked ? [...taskSelection.files, file.id] : taskSelection.files.filter(id => id !== file.id) })} />)}</>}
      </div><footer className="mail-composer-footer"><Button onClick={() => setTaskSelection(undefined)}>Отмена</Button><Button appearance="primary" onClick={() => { setTaskStage("compose"); void loadProjects(); }}>Перейти к созданию задачи</Button></footer></DialogSurface>
    </WorkspaceDialog>
    {taskSelection && taskStage === "compose" && <TaskComposer open people={people} departments={departments} tasks={tasks} token={token} currentUserId={currentUserId}
      projectOptions={projects} projectsLoading={projectsLoading} projectsError={projectsError} onRetryProjects={() => void loadProjects()}
      initialTitle={taskSelection.source.subject.slice(0,240)} initialDescription={taskDescription} sourceLabel="Из письма Gmail · только выбранные сведения"
      onClose={() => { setTaskStage("select"); }} onSubmit={async task => {
        const created = await createTaskFromMail(token, { operationId: taskSelection.operationId, messageId: taskSelection.source.id, attachmentIds: taskSelection.files, task });
        setTaskSelection(undefined); onTaskCreated(created); return created;
      }} />}
  </section>;
}
