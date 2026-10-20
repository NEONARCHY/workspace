import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, DialogSurface } from "@fluentui/react-components";
import { Add20Regular, ArrowClockwise20Regular, Chat20Regular, Settings20Regular } from "@fluentui/react-icons";
import type {
  GrantAction, GrantDetail, GrantFields, GrantSettings, GrantStatus, GrantSummary,
  WorkspaceAttachment, WorkspaceDepartment, WorkspacePerson,
} from "@yuksalish/contracts";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";
import { ScopedPeopleCheckboxes } from "./ScopedPeopleCheckboxes";
import { TaskPersonAvatar } from "./TaskPersonAvatar";
import {
  actOnGrant, changeGrantReviewers, createGrant, editGrant, loadGrant, loadGrants, loadGrantSettings,
  saveGrantSettings, uploadWorkspaceAttachment,
} from "./workspace-api";
import "./grants.css";

interface Props {
  readonly token: string;
  readonly currentUser: Pick<WorkspacePerson, "id" | "role">;
  readonly people: readonly WorkspacePerson[];
  readonly departments: readonly WorkspaceDepartment[];
  readonly canCreate: boolean;
  readonly canAdmin: boolean;
  readonly focusId?: string;
  readonly onOpenChat?: (id: string) => void;
  readonly onPreviewAttachment: (attachment: WorkspaceAttachment) => void;
  readonly onDownloadAttachment: (attachment: WorkspaceAttachment) => Promise<void>;
}
export const grantStatusLabels: Readonly<Record<GrantStatus, string>> = {
  in_progress: "В работе", needs_revision: "На доработке", author_review: "Проверка постановщика",
  leader_review: "Проверка руководителя", chair_review: "Проверка председателя", completed: "Завершена",
};
const eventLabels: Readonly<Record<string, string>> = {
  created: "Заявка создана", edited: "Изменены данные заявки", submit: "Результат передан на проверку",
  approve: "Результат принят", return: "Возвращено на доработку", comment: "Комментарий",
  check: "Изменён чек-лист", file_uploaded: "Прикреплён файл",
  reviewers_changed: "Администратор изменил согласующих",
};
type Filter = "all" | "mine" | "working" | "review" | "revision" | "completed";
const filters: readonly [Filter, string][] = [
  ["all", "Все"], ["mine", "Мои"], ["working", "В работе"], ["review", "Ждут моего решения"],
  ["revision", "На доработке"], ["completed", "Завершены"],
];
const emptyFields: GrantFields = {
  title: "", description: "", assigneeId: "", coAssigneeIds: [], dueAt: "", checklist: [],
};
function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось выполнить действие. Попробуйте снова.";
}
function localDate(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function readableDate(value: string) {
  return new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export function GrantsView({ token, currentUser, people, departments, canCreate, canAdmin,
  focusId, onOpenChat, onPreviewAttachment, onDownloadAttachment }: Props) {
  const [grants, setGrants] = useState<readonly GrantSummary[]>([]);
  const [settings, setSettings] = useState<GrantSettings>();
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [loadError, setLoadError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [actionError, setActionError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<GrantDetail>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [editor, setEditor] = useState<{ id?: string; revision?: number; requestId: string }>();
  const [draft, setDraft] = useState<GrantFields>(emptyFields);
  const [checklistText, setChecklistText] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<GrantDetail>();
  const [settingsReason, setSettingsReason] = useState("");
  const [leaderId, setLeaderId] = useState("");
  const [chairId, setChairId] = useState("");
  const [result, setResult] = useState("");
  const [comment, setComment] = useState("");
  const [returning, setReturning] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [success, setSuccess] = useState("");
  const name = (id: string | null | undefined) => people.find((person) => person.id === id)?.name ?? "Сотрудник недоступен";
  const activePeople = people.filter((person) => (person.status ?? "active") === "active");
  const selectedRevision = grants.find((grant) => grant.id === selectedId)?.revision;

  const refresh = useCallback(async () => {
    try {
      const [rows, route] = await Promise.all([loadGrants(token), loadGrantSettings(token)]);
      setGrants(rows); setSettings(route); setLoadError("");
      setNow(Date.now());
    } catch (error) { setLoadError(errorText(error)); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => {
    const start = window.setTimeout(() => { void refresh(); }, 0);
    const interval = window.setInterval(() => {
      if (!document.hidden && !busyRef.current) void refresh();
    }, 30_000);
    const onFocus = () => { if (!busyRef.current) void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(start); window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [refresh]);
  useEffect(() => {
    if (!focusId) return;
    const timer = window.setTimeout(() => { setSelectedId(focusId); setDetail(undefined); }, 0);
    return () => window.clearTimeout(timer);
  }, [focusId]);
  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    void loadGrant(token, selectedId).then((loaded) => {
      if (live) { setDetail((current) => current?.id === loaded.id && current.revision > loaded.revision ? current : loaded); setDetailError(""); }
    }).catch((error: unknown) => { if (live) setDetailError(errorText(error)); });
    return () => { live = false; };
  }, [selectedId, token, selectedRevision]);

  const saveDetail = (saved: GrantDetail) => {
    setDetail(saved);
    setGrants((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
  };
  const run = async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setActionError(""); setSuccess("");
    try { await operation(); }
    catch (error) { setActionError(errorText(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const openDetail = (id: string) => {
    setDetail(undefined); setDetailError(""); setActionError(""); setSuccess("");
    setResult(""); setComment(""); setReturnReason(""); setReturning(false); setSelectedId(id);
  };
  const closeDetail = () => { if (!busyRef.current) { setSelectedId(undefined); setDetail(undefined); setActionError(""); } };
  const act = (action: Omit<GrantAction, "expectedRevision">) => void run(async () => {
    if (!detail) return;
    const saved = await actOnGrant(token, detail.id, { ...action, expectedRevision: detail.revision });
    saveDetail(saved);
    if (action.action === "submit") setResult("");
    if (action.action === "comment") setComment("");
    if (action.action === "return") { setReturning(false); setReturnReason(""); }
    setSuccess("Изменения сохранены");
  });
  const openEditor = (grant?: GrantDetail) => {
    setDraft(grant ? { title: grant.title, description: grant.description, assigneeId: grant.assigneeId,
      coAssigneeIds: grant.coAssigneeIds, dueAt: localDate(grant.dueAt), checklist: grant.checklist.map((item) => item.title) } : emptyFields);
    setChecklistText(grant?.checklist.map((item) => item.title).join("\n") ?? "");
    setActionError("");
    setEditor({ id: grant?.id, revision: grant?.revision, requestId: crypto.randomUUID() });
  };
  const submitEditor = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!editor) return;
      const fields = { ...draft, title: draft.title.trim(), dueAt: new Date(draft.dueAt).toISOString(),
        checklist: checklistText.split("\n").map((item) => item.trim()).filter(Boolean) };
      const saved = editor.id
        ? await editGrant(token, editor.id, fields, editor.revision ?? 0)
        : await createGrant(token, fields, editor.requestId);
      saveDetail(saved); setEditor(undefined); setSelectedId(saved.id); setSuccess("Заявка сохранена");
    });
  };
  const visible = grants.filter((row) => {
    const fits = filter === "all" || (filter === "mine" && [row.authorUserId, row.assigneeId, ...row.coAssigneeIds].includes(currentUser.id))
      || (filter === "working" && row.status === "in_progress")
      || (filter === "review" && row.allowedActions.includes("approve"))
      || (filter === "revision" && row.status === "needs_revision")
      || (filter === "completed" && row.status === "completed");
    return fits && `${row.title} ${row.description} ${name(row.assigneeId)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  });
  const can = (action: string) => detail?.allowedActions.includes(action) === true;
  const routeReady = Boolean(settings?.leaderUserId && settings.chairUserId);

  return <section className="workspace-view grants-view" aria-label="Гранты">
    <WorkspaceSectionHeader motif="tasks">
      <div><p className="eyebrow">Подготовка · Проверка · Утверждение</p><h1>Гранты</h1>
        <p>Заявки, результаты и согласование до председателя.</p></div>
      <div className="grants-actions">
        <Button icon={<ArrowClockwise20Regular />} onClick={() => void refresh()} disabled={busy}>Обновить</Button>
        {canAdmin && <Button icon={<Settings20Regular />} onClick={() => {
          setSettingsTarget(undefined); setSettingsReason("");
          setLeaderId(settings?.leaderUserId ?? ""); setChairId(settings?.chairUserId ?? ""); setActionError(""); setSettingsOpen(true);
        }} disabled={!settings || busy}>Маршрут согласования</Button>}
        {canCreate && <Button appearance="primary" icon={<Add20Regular />} onClick={() => openEditor()} disabled={!routeReady || busy}>Новая заявка</Button>}
      </div>
    </WorkspaceSectionHeader>
    {loadError && <WorkspaceNotice tone="error" role="alert" actions={<Button onClick={() => void refresh()}>Повторить</Button>}>{loadError}</WorkspaceNotice>}
    {!loading && settings && !routeReady && <WorkspaceNotice tone="warning">Администратору нужно назначить руководителя и председателя в маршруте согласования.</WorkspaceNotice>}
    <div className="grants-toolbar"><div className="grants-filters" role="group" aria-label="Фильтр грантов">
      {filters.map(([key, label]) => <Button key={key} aria-pressed={filter === key} appearance={filter === key ? "primary" : "subtle"} onClick={() => setFilter(key)}>{label}</Button>)}
    </div><label className="grants-search"><span>Поиск заявок</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название или сотрудник" /></label></div>
    {loading ? <p role="status">Загружаем заявки…</p> : <div className="grants-records">
      {visible.length === 0 ? <p className="grants-empty">{grants.length ? "По этим условиям заявок нет." : "Заявок на гранты пока нет."}</p> :
        <table><caption className="sr-only">Заявки на гранты</caption><thead><tr><th>Заявка и этап</th><th>Постановщик</th><th>Ответственный</th><th>Срок</th></tr></thead>
          <tbody>{visible.map((row) => <tr key={row.id}><td><button className="grants-title-button" onClick={() => openDetail(row.id)}>{row.title}</button>
            <span className="grants-status" data-status={row.status}>{grantStatusLabels[row.status]}</span></td>
          <td>{name(row.authorUserId)}</td><td><span className="grants-person"><TaskPersonAvatar person={people.find((person) => person.id === row.assigneeId)} token={token} size={32} /><span>{name(row.assigneeId)}
            {row.coAssigneeIds.length > 0 && <small>Соисполнителей: {row.coAssigneeIds.length}</small>}</span></span></td>
          <td><time dateTime={row.dueAt}>{readableDate(row.dueAt)}</time>
            {row.status !== "completed" && new Date(row.dueAt).getTime() < now && <small className="grants-overdue">Срок истёк</small>}</td></tr>)}</tbody></table>}
    </div>}

    <WorkspaceDialog open={Boolean(selectedId) && !editor && !settingsOpen} onOpenChange={(_, data) => { if (!data.open) closeDetail(); }}>
      <DialogSurface className="grants-dialog" aria-labelledby="grant-detail-title">
        <header className="grants-dialog-header"><div><p className="eyebrow">Заявка на грант</p><h2 id="grant-detail-title">{detail?.title ?? "Загружаем заявку…"}</h2></div><Button onClick={closeDetail} disabled={busy}>Закрыть</Button></header>
        <div className="grants-dialog-body">
          {detailError && <WorkspaceNotice tone="error" role="alert" actions={<Button onClick={() => void run(async () => { saveDetail(await loadGrant(token, selectedId ?? "")); setDetailError(""); })}>Повторить</Button>}>{detailError}</WorkspaceNotice>}
          {detail && <>
            <div className="grants-detail-command"><span className="grants-status" data-status={detail.status}>{grantStatusLabels[detail.status]}</span>
              {canAdmin && detail.status !== "completed" && <Button disabled={busy} onClick={() => {
                setSettingsTarget(detail); setSettingsReason(""); setLeaderId(detail.leaderUserId);
                setChairId(detail.chairUserId); setActionError(""); setSettingsOpen(true);
              }}>Изменить согласующих</Button>}
              {can("edit") && <Button onClick={() => openEditor(detail)} disabled={busy}>Редактировать заявку</Button>}
              {onOpenChat && <Button icon={<Chat20Regular />} onClick={() => onOpenChat(detail.chatId)} disabled={busy}>Чат заявки</Button>}
              <Button disabled={busy} onClick={() => void run(async () => { saveDetail(await loadGrant(token, detail.id)); setDetailError(""); })}>Обновить карточку</Button></div>
            <ol className="grants-route" aria-label="Маршрут согласования">
              {([ ["in_progress", "Подготовка", detail.assigneeId], ["author_review", "Постановщик", detail.authorUserId],
                ["leader_review", "Руководитель", detail.leaderUserId], ["chair_review", "Председатель", detail.chairUserId] ] as const).map(([stage, title, actor]) =>
                <li key={stage} aria-current={detail.status === stage || (stage === "in_progress" && detail.status === "needs_revision") ? "step" : undefined}>
                  <strong>{title}</strong><span>{name(actor)}</span></li>)}
            </ol>
            <dl className="grants-metadata"><div><dt>Срок</dt><dd>{readableDate(detail.dueAt)}</dd></div>
              <div><dt>Соисполнители</dt><dd>{detail.coAssigneeIds.map(name).join(", ") || "Не назначены"}</dd></div></dl>
            {detail.description && <section><h3>Описание и ожидаемый результат</h3><p className="grants-preserve">{detail.description}</p></section>}
            <section><h3>Чек-лист · {detail.checklist.filter((item) => item.completed).length}/{detail.checklist.length}</h3>
              {detail.checklist.length ? <div className="grants-checklist">{detail.checklist.map((item) => <label key={item.id}>
                <input type="checkbox" checked={item.completed} disabled={busy || !can("check")} onChange={(event) => act({ action: "check", itemId: item.id, completed: event.target.checked })} />
                <span>{item.title}{item.completedByUserId && <small>{name(item.completedByUserId)}{item.completedAt ? ` · ${readableDate(item.completedAt)}` : ""}</small>}</span></label>)}</div> : <p>Пункты не добавлены.</p>}
            </section>
            <section><h3>Результат</h3><p className="grants-preserve">{detail.resultText || "Результат ещё не передан на проверку."}</p>
              {can("submit") && <div className="grants-result"><label><span>Результат работы для постановщика</span><textarea rows={5} maxLength={12000} value={result} onChange={(event) => setResult(event.target.value)} placeholder="Что подготовлено, какие материалы приложены" /></label>
                <Button appearance="primary" disabled={busy || !result.trim() || detail.checklist.some((item) => !item.completed)} onClick={() => act({ action: "submit", text: result })}>Отправить на проверку</Button>
                {detail.checklist.some((item) => !item.completed) && <small>Перед отправкой выполните все пункты чек-листа.</small>}</div>}
            </section>
            <section><h3>Файлы заявки</h3><ul className="grants-files">{detail.attachments.map((file) => <li key={file.id}>
              <Button appearance="subtle" onClick={() => onPreviewAttachment(file)}>{file.fileName}</Button>
              <Button onClick={() => void run(() => onDownloadAttachment(file))} disabled={busy}>Скачать</Button></li>)}</ul>
              {!detail.attachments.length && <p>Файлы не прикреплены.</p>}
              {can("upload") && <label className="grants-upload"><span>Прикрепить файл · до 25 МБ</span><input type="file" disabled={busy} onChange={(event) => {
                const file = event.target.files?.[0]; event.target.value = "";
                if (file) void run(async () => { await uploadWorkspaceAttachment(token, "grant", detail.id, file); saveDetail(await loadGrant(token, detail.id)); });
              }} /></label>}
            </section>
            <section><h3>Комментарии и история</h3>
              {can("comment") && <div className="grants-comment"><label><span>Комментарий</span><textarea rows={3} maxLength={12000} value={comment} onChange={(event) => setComment(event.target.value)} /></label>
                <Button disabled={busy || !comment.trim()} onClick={() => act({ action: "comment", text: comment })}>Добавить комментарий</Button></div>}
              <ol className="grants-history">{[...detail.events].reverse().map((event) => <li key={event.id}><strong>{eventLabels[event.action] ?? event.action}</strong>
                <small>{name(event.actorUserId)} · {readableDate(event.createdAt)}</small>
                {event.fromStatus !== event.toStatus && <span>{grantStatusLabels[event.fromStatus]} → {grantStatusLabels[event.toStatus]}</span>}
                {event.text && <p className="grants-preserve">{event.text}</p>}</li>)}</ol>
            </section>
          </>}
        </div>
        <footer className="grants-dialog-footer">
          {actionError && <WorkspaceNotice tone="error" role="alert">{actionError}</WorkspaceNotice>}
          {success && <p role="status">{success}</p>}
          {can("approve") && <div className="grants-review-actions"><p>Решение принимается по показанному результату и приложенным материалам.</p>
            <Button appearance="primary" disabled={busy} onClick={() => act({ action: "approve" })}>{detail?.status === "chair_review" ? "Принять и завершить" : detail?.status === "author_review" ? "Принять и передать руководителю" : "Принять и передать председателю"}</Button>
            <Button disabled={busy} onClick={() => setReturning(!returning)}>Вернуть на доработку</Button>
            {returning && <div className="grants-return"><label><span>Что нужно доработать *</span><textarea rows={3} maxLength={12000} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} /></label>
              <Button disabled={busy || !returnReason.trim()} onClick={() => act({ action: "return", text: returnReason })}>Отправить на доработку</Button></div>}
          </div>}
        </footer>
      </DialogSurface>
    </WorkspaceDialog>

    <WorkspaceDialog open={Boolean(editor)} onOpenChange={(_, data) => { if (!data.open && !busyRef.current) setEditor(undefined); }}>
      <DialogSurface className="grants-dialog grants-editor" aria-labelledby="grant-editor-title">
        <form onSubmit={submitEditor}>
          <header className="grants-dialog-header"><h2 id="grant-editor-title">{editor?.id ? "Редактирование заявки" : "Новая заявка на грант"}</h2></header>
          <div className="grants-dialog-body grants-form">
            <label><span>Название гранта *</span><input required minLength={3} maxLength={240} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
            <label><span>Описание и ожидаемый результат</span><textarea rows={5} maxLength={12000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            <div className="grants-form-columns"><label><span>Ответственный *</span><select required value={draft.assigneeId} onChange={(event) => setDraft({ ...draft, assigneeId: event.target.value, coAssigneeIds: draft.coAssigneeIds.filter((id) => id !== event.target.value) })}>
              <option value="">Выберите сотрудника</option>{activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
              <label><span>Срок *</span><input type="datetime-local" required value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label></div>
            <ScopedPeopleCheckboxes label="Соисполнители" people={activePeople.filter((person) => person.id !== draft.assigneeId)} departments={departments}
              selectedIds={draft.coAssigneeIds} onChange={(coAssigneeIds) => setDraft({ ...draft, coAssigneeIds })} disabled={busy} />
            <label><span>Чек-лист · каждый пункт с новой строки</span><textarea rows={5} value={checklistText} onChange={(event) => setChecklistText(event.target.value)} /></label>
            <p>Постановщик: {name(currentUser.id)}. После его проверки: {name(settings?.leaderUserId)} → {name(settings?.chairUserId)}.</p>
          </div><footer className="grants-dialog-footer">{actionError && <WorkspaceNotice tone="error" role="alert">{actionError}</WorkspaceNotice>}
            <div className="grants-actions"><Button type="button" disabled={busy} onClick={() => setEditor(undefined)}>Отмена</Button><Button type="submit" appearance="primary" disabled={busy || draft.title.trim().length < 3}>{busy ? "Сохраняем…" : "Сохранить заявку"}</Button></div></footer>
        </form>
      </DialogSurface>
    </WorkspaceDialog>

    <WorkspaceDialog open={settingsOpen} onOpenChange={(_, data) => { if (!data.open && !busyRef.current) setSettingsOpen(false); }}>
      <DialogSurface className="grants-dialog grants-settings" aria-labelledby="grant-settings-title"><form onSubmit={(event) => {
        event.preventDefault(); void run(async () => {
          if (settingsTarget) {
            saveDetail(await changeGrantReviewers(token, settingsTarget.id, leaderId, chairId, settingsReason, settingsTarget.revision));
          } else {
            setSettings(await saveGrantSettings(token, leaderId, chairId, settings?.revision ?? 0));
          }
          setSettingsOpen(false);
        });
      }}><header className="grants-dialog-header"><h2 id="grant-settings-title">Маршрут согласования грантов</h2></header>
        <div className="grants-dialog-body grants-form"><p>{settingsTarget ? "Изменение сохранится в истории этой заявки. Если результат уже проверяется, маршрут начнётся заново с постановщика." : "Изменения применяются к новым заявкам. В отправленных сохраняются назначенные согласующие и история."}</p>
          <label><span>Руководитель *</span><select required value={leaderId} onChange={(event) => setLeaderId(event.target.value)}><option value="">Выберите сотрудника</option>{activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label><span>Председатель *</span><select required value={chairId} onChange={(event) => setChairId(event.target.value)}><option value="">Выберите сотрудника</option>{activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          {settingsTarget && <label><span>Причина изменения *</span><textarea required minLength={3} maxLength={2000} value={settingsReason} onChange={(event) => setSettingsReason(event.target.value)} /></label>}
        </div><footer className="grants-dialog-footer">{actionError && <WorkspaceNotice tone="error" role="alert">{actionError}</WorkspaceNotice>}
          <div className="grants-actions"><Button type="button" disabled={busy} onClick={() => setSettingsOpen(false)}>Отмена</Button><Button type="submit" appearance="primary" disabled={busy || !leaderId || !chairId || leaderId === chairId || (Boolean(settingsTarget) && settingsReason.trim().length < 3)}>Сохранить маршрут</Button></div>
        </footer></form></DialogSurface>
    </WorkspaceDialog>
  </section>;
}
