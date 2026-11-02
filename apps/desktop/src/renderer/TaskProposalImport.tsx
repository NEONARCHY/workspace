import { useEffect, useRef, useState } from "react";
import type { TaskProposalImportContext, TaskProposalImportPreview, TaskProposalImportResult,
  TaskProposalImportWrite, WorkspacePerson, WorkspaceTask } from "@yuksalish/contracts";
import { Button, Checkbox, DialogSurface, Field, Spinner, Textarea } from "@fluentui/react-components";
import { ArrowUpload20Regular, DocumentTable20Regular } from "@fluentui/react-icons";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { Input } from "./WorkspaceInput";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";
import { PersonPicker } from "./PersonPicker";
import { ApiHttpError, loadTaskProposalImportContext, loadTaskProposalImportResult,
  previewTaskProposalImport, submitTaskProposalImport } from "./workspace-api";
import { importAssignee, importTitleKey, importRowProblems, importTaskPayload, isUnspecifiedName,
  matchingTaskTitles, newImportDraft, suggestImportPerson, type ProposalImportDraft } from "./task-proposal-import-review";
import "./task-proposal-import.css";

type Props = { readonly token: string; readonly people: readonly WorkspacePerson[];
  readonly tasks: readonly WorkspaceTask[]; readonly onSubmitted?: () => void;
  readonly initialAliases?: Readonly<Record<string, string>> };
const problem = (error: unknown) => error instanceof Error ? error.message : "Не удалось выполнить импорт";

export function TaskProposalImportLauncher(props: Props) {
  const [context, setContext] = useState<TaskProposalImportContext>();
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadTaskProposalImportContext(props.token).then(value => {
      if (alive) { setContext(value); setError(""); }
    }).catch(cause => { if (alive) setError(problem(cause)); });
    return () => { alive = false; };
  }, [props.token, retry]);
  return <>
    {error ? <WorkspaceNotice tone="error" actions={<Button onClick={() => setRetry(value => value + 1)}>Повторить</Button>}>{error}</WorkspaceNotice> : null}
    {context?.configurationError ? <WorkspaceNotice tone="warning">{context.configurationError}</WorkspaceNotice> : null}
    {context?.canImport ? <Button icon={<ArrowUpload20Regular />} onClick={() => setOpen(true)}>Импорт запросов</Button> : null}
    {open && context?.canImport ? <TaskProposalImportDialog {...props} context={context} onClose={() => setOpen(false)} /> : null}
  </>;
}

export function TaskProposalImportDialog({ token, people: directory, tasks, context, onClose, onSubmitted, initialAliases }: Props & {
  readonly context: TaskProposalImportContext; readonly onClose: () => void;
}) {
  const people = directory.filter(person => person.status === "active");
  const input = useRef<HTMLInputElement>(null);
  const requestId = useRef(crypto.randomUUID());
  const attempt = useRef<TaskProposalImportWrite | null>(null);
  const [preview, setPreview] = useState<TaskProposalImportPreview>();
  const [drafts, setDrafts] = useState<readonly ProposalImportDraft[]>([]);
  const [mapping, setMapping] = useState<Readonly<Record<string, string>>>({});
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [stage, setStage] = useState<"names" | "rows">("names");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TaskProposalImportResult>();
  const [, setClock] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setClock(value => value + 1), 30_000); return () => window.clearInterval(timer); }, []);
  const included = drafts.filter(row => row.included);
  const duplicateInFile = (row: ProposalImportDraft) => included.filter(other => importTitleKey(other.title) === importTitleKey(row.title)).length > 1;
  const problems = drafts.map(row => importRowProblems(row, mapping, people, tasks, duplicateInFile(row)));
  const incomplete = problems.filter(items => items.length > 0).length;
  const selected = drafts[selectedIndex];
  const hints = [...new Set(drafts.flatMap(row => [row.source.assigneeHint, ...row.source.coexecutorHints]))].filter(hint => !isUnspecifiedName(hint));
  const locked = busy || uncertain;
  const patch = (change: Partial<ProposalImportDraft>) => setDrafts(rows => rows.map((row, index) => index === selectedIndex ? { ...row, ...change } : row));
  const loadFile = async (file: File) => {
    setBusy(true); setError("");
    try {
      const next = await previewTaskProposalImport(token, file);
      const nextHints = [...new Set(next.rows.flatMap(row => [row.assigneeHint, ...row.coexecutorHints]))];
      setMapping(Object.fromEntries(nextHints.filter(hint => !isUnspecifiedName(hint)).map(hint => {
        const override = initialAliases?.[hint];
        return [hint, override && people.some(person => person.id === override) ? override : suggestImportPerson(hint, people)];
      })));
      requestId.current = crypto.randomUUID(); attempt.current = null;
      setPreview(next); setDrafts(next.rows.map(newImportDraft)); setSelectedIndex(0);
      setMappingConfirmed(false); setStage("names"); setResult(undefined);
    } catch (cause) { setError(problem(cause)); }
    finally { setBusy(false); }
  };
  const finish = (value: TaskProposalImportResult) => {
    setResult(value); setUncertain(false); setError(""); attempt.current = null; onSubmitted?.();
  };
  const submit = async () => {
    if (busy || !context.chairUserId || !preview) return;
    if (!uncertain && (!mappingConfirmed || incomplete || !included.length)) {
      setError("Проверьте имена и отмеченные строки перед отправкой"); return;
    }
    const payload = attempt.current ?? {
      requestId: requestId.current, authorUserId: context.chairUserId, sourceName: preview.sourceName,
      items: included.map(row => ({ sourceKey: row.source.sourceKey, task: importTaskPayload(row, mapping, preview.sourceName) })),
    };
    attempt.current = payload; setBusy(true); setError("");
    try { finish(await submitTaskProposalImport(token, payload)); }
    catch (cause) {
      setUncertain(true); setError(problem(cause));
      try { finish(await loadTaskProposalImportResult(token, payload.requestId)); }
      catch (readError) {
        if (readError instanceof ApiHttpError && readError.status === 404
          && cause instanceof ApiHttpError && cause.status >= 400 && cause.status < 500
          && ![408, 429].includes(cause.status)) {
          // Keep the same UUID: a concurrent old attempt can still finish after this read.
          setUncertain(false); attempt.current = null;
        }
      }
    } finally { setBusy(false); }
  };
  const close = () => {
    if (busy) return;
    if (uncertain && !window.confirm("Результат отправки не подтверждён. Закрыть и проверить заявки позже?")) return;
    if (!uncertain && preview && !result && !window.confirm("Закрыть проверку без отправки заявок?")) return;
    onClose();
  };
  const sourceDeadline = selected?.source.deadlineText;
  return <WorkspaceDialog open onOpenChange={(_, data) => { if (!data.open) close(); }}>
    <DialogSurface className="record-composer-dialog proposal-import-dialog" aria-label="Импорт запросов на постановку задач">
      <header className="proposal-import-header"><div><small>ЗАДАЧИ · СОГЛАСОВАНИЕ</small><h2>Импорт запросов</h2><p>Председатель: {context.chairName}. Задачи появятся только после его личного одобрения.</p></div>
        <Button disabled={busy} onClick={close}>Закрыть</Button></header>
      <div className="proposal-import-scroll">
        {error ? <WorkspaceNotice tone="error">{error}{uncertain ? " Результат не подтверждён; повтор использует тот же пакет." : ""}</WorkspaceNotice> : null}
        {result ? <section className="proposal-import-receipt" role="status"><DocumentTable20Regular /><h3>Пакет сохранён</h3>
          <p>{result.proposals.length} заявок · ожидают решения: {result.proposals.filter(row => row.status === "pending").length}</p>
          <p>{result.reused ? "Открыт уже сохранённый пакет. Повторные заявки не созданы." : "Исполнители получат задачи после одобрения председателем."}</p>
          <ol>{result.proposals.map(row => <li key={row.id}>{row.task.title}</li>)}</ol></section> : <>
          <div className="proposal-import-file"><DocumentTable20Regular /><div><strong>{preview?.sourceName ?? "Выберите список задач"}</strong>
            <p>XLSX до 5 МБ. Название, описание, срок, исполнитель, соисполнители и примечание.</p></div>
            <Button icon={<ArrowUpload20Regular />} disabled={locked} onClick={() => input.current?.click()}>{preview ? "Другой файл" : "Выбрать Excel"}</Button>
            <input ref={input} hidden type="file" accept=".xlsx" aria-label="Файл запросов Excel" onChange={event => {
              const file = event.target.files?.[0]; event.target.value = ""; if (file) void loadFile(file);
            }} /></div>
          {busy ? <Spinner size="small" label="Проверяем данные…" /> : null}
          {preview ? <>
            <div className="proposal-import-summary"><span>Строк: <strong>{drafts.length}</strong></span><span>Выбрано: <strong>{included.length}</strong></span><span>Нужно уточнить: <strong>{incomplete}</strong></span></div>
            <nav className="proposal-import-steps" aria-label="Шаги импорта"><Button disabled={locked} appearance={stage === "names" ? "primary" : "subtle"} onClick={() => setStage("names")}>1. Сопоставление имён</Button>
              <Button disabled={locked} appearance={stage === "rows" ? "primary" : "subtle"} onClick={() => setStage("rows")}>2. Проверка строк</Button></nav>
            <Button disabled={locked} onClick={() => setDrafts(rows => rows.map(row => row.included && row.source.deadlineText && !row.dueAt ? { ...row, deadlineAcknowledged: true } : row))}>Сроки из файла оставить в описаниях</Button>
            <p>Точные сроки председатель сможет указать при одобрении.</p>
            {stage === "names" ? <section className="proposal-import-names"><h3>Кто указан в файле</h3><p>Короткие имена — только подсказки. Проверьте каждого сотрудника; выбор применяется ко всем его упоминаниям.</p>
              {hints.map(hint => <div key={hint} className="proposal-import-name"><span>{hint}</span><PersonPicker token={token} label={`Сопоставить ${hint}`} people={people} value={mapping[hint] ?? ""} disabled={locked}
                onChange={id => { setMapping(current => ({ ...current, [hint]: id })); setMappingConfirmed(false); }} /></div>)}
              <Checkbox disabled={locked} label="Я проверил сопоставления сотрудников" checked={mappingConfirmed} onChange={(_, data) => setMappingConfirmed(data.checked === true)} />
              <Button disabled={locked} onClick={() => setStage("rows")}>Проверить строки</Button></section> : <div className="proposal-import-review">
              <aside className="proposal-import-list"><Checkbox label="Только строки с вопросами" checked={onlyProblems} onChange={(_, data) => setOnlyProblems(data.checked === true)} />
                {drafts.map((row, index) => onlyProblems && !problems[index]?.length ? null : <button type="button" key={row.source.sourceKey} disabled={locked} aria-pressed={index === selectedIndex} onClick={() => setSelectedIndex(index)}>
                  <span>{row.source.numberHint || index + 1}. {row.title || "Без названия"}</span><small>{!row.included ? "Исключена" : problems[index]?.length ? problems[index]?.join(" · ") : "Готова к отправке"}</small></button>)}</aside>
              {selected ? <section className="proposal-import-editor" aria-label={`Проверка строки ${selected.source.numberHint || selectedIndex + 1}`}>
                <div className="proposal-import-row-heading"><strong>{selected.source.sourceKey}</strong><Checkbox label="Включить в пакет" checked={selected.included} disabled={locked} onChange={(_, data) => patch({ included: data.checked === true })} /></div>
                {selected.source.warnings.map(warning => <WorkspaceNotice key={warning} tone="warning">{warning}</WorkspaceNotice>)}
                {problems[selectedIndex]?.length ? <WorkspaceNotice tone="warning">{problems[selectedIndex]?.join(". ")}</WorkspaceNotice> : null}
                <Field label="Название" required><Input aria-label="Название заявки" value={selected.title} disabled={locked} maxLength={240} onChange={(_, data) => patch({ title: data.value, duplicateAcknowledged: false })} /></Field>
                <Field label="Описание"><Textarea aria-label="Описание заявки" value={selected.description} disabled={locked} resize="vertical" rows={6} onChange={(_, data) => patch({ description: data.value })} /></Field>
                <Field label="Ответственный" required={!selected.assigneeDeferred} hint={`В файле: ${selected.source.assigneeHint || "не указан"}`}><PersonPicker token={token} people={people} label="Ответственный заявки" value={importAssignee(selected, mapping)} disabled={locked || selected.assigneeDeferred} onChange={id => patch({ assigneeOverride: id })} /></Field>
                <Checkbox disabled={locked} label="Ответственного назначит председатель при одобрении" checked={selected.assigneeDeferred} onChange={(_, data) => patch({ assigneeDeferred: data.checked === true })} />
                <div><strong>Соисполнители</strong><p>{selected.source.coexecutorHints.length ? selected.source.coexecutorHints.map(hint => `${hint}: ${people.find(person => person.id === mapping[hint])?.name ?? "не сопоставлен"}`).join("; ") : "В файле не указаны"}</p></div>
                <Field label="Срок" hint={sourceDeadline ? `В файле: ${sourceDeadline}. Время не придумываем.` : "Без срока, если в файле он не указан"}><WorkspaceDateTimePicker ariaLabel="Срок заявки" value={selected.dueAt} onChange={value => patch({ dueAt: value })} disabled={locked} /></Field>
                {sourceDeadline ? <Checkbox disabled={locked} label="Оставить без точного срока; сохранить исходный срок в описании" checked={selected.deadlineAcknowledged} onChange={(_, data) => patch({ deadlineAcknowledged: data.checked === true, dueAt: data.checked ? "" : selected.dueAt })} /> : null}
                {selected.source.note ? <div className="proposal-import-source-note"><strong>Примечание из файла</strong><p>{selected.source.note}</p></div> : null}
                {duplicateInFile(selected) || matchingTaskTitles(selected.title, tasks).length ? <><WorkspaceNotice tone="warning">Найдено совпадающее название в файле или доступных задачах. Проверьте, нужна ли отдельная заявка.</WorkspaceNotice>
                  <Checkbox disabled={locked} label="Совпадение проверено: это отдельная задача" checked={selected.duplicateAcknowledged} onChange={(_, data) => patch({ duplicateAcknowledged: data.checked === true })} /></> : null}
              </section> : null}
            </div>}
          </> : null}
        </>}
      </div>
      <footer className="proposal-import-footer"><span>{result ? "Заявки доступны в разделе постановки задач" : "Пока это проверка данных. Рабочие задачи не создаются."}</span>
        {result ? <Button appearance="primary" onClick={close}>Готово</Button> : <Button appearance="primary" disabled={busy || !preview || (!uncertain && (!mappingConfirmed || incomplete > 0 || !included.length))} onClick={() => { void submit(); }}>
          {uncertain ? "Повторить тот же пакет" : `Отправить председателю${included.length ? ` · ${included.length}` : ""}`}</Button>}</footer>
    </DialogSurface>
  </WorkspaceDialog>;
}
