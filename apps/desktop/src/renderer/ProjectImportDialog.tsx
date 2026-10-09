import { useCallback, useEffect, useState } from "react";
import { Button, DialogSurface, Input, Textarea } from "@fluentui/react-components";
import type {
  ProjectDocumentImport, ProjectImportContent, ProjectImportItem,
  ProjectImportPassport, ProjectImportSource, WorkspacePerson,
} from "@yuksalish/contracts";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceFileDropzone } from "./WorkspaceFileDropzone";
import { WorkspaceSelect } from "./WorkspaceSelect";
import {
  analyzeProjectImport, createProjectImport, downloadProjectImportDocument,
  loadProjectImport, loadProjectImports, publishProjectImport,
  reviewProjectImport, uploadProjectImportDocument,
} from "./workspace-api";
import "./project-import.css";

interface Props {
  readonly token: string;
  readonly currentUserId: string;
  readonly people: readonly WorkspacePerson[];
  readonly projectId?: string;
  readonly onClose: () => void;
  readonly onCreated: (projectId: string) => void;
}
const emptyItem: ProjectImportItem = {
  title: "", kind: "task", description: "", period: "", budget: "0",
  startsAt: null, dueAt: null, include: true, assigneeUserIds: [], sources: [],
};
function message(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось выполнить действие. Повторите.";
}
function currency(value: string): "UZS" | "USD" | "EUR" {
  return value === "USD" || value === "EUR" ? value : "UZS";
}
function localTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function instant(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function ProjectImportDialog({ token, currentUserId, people, projectId, onClose, onCreated }: Props) {
  const [registry, setRegistry] = useState<readonly ProjectDocumentImport[]>([]);
  const [draft, setDraft] = useState<ProjectDocumentImport>();
  const [content, setContent] = useState<ProjectImportContent>();
  const [files, setFiles] = useState<readonly File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [manager, setManager] = useState(currentUserId);
  const [responsibles, setResponsibles] = useState<readonly string[]>([]);
  const [access, setAccess] = useState<"open" | "closed">("closed");
  const [tab, setTab] = useState<"passport" | "plan" | "budget" | "issues">("passport");
  const archive = !!projectId || draft?.state === "published";
  const accept = useCallback((value: ProjectDocumentImport) => {
    setDraft(value); setContent(value.content); setDirty(false); setReviewed(false);
    setRegistry((current) => [value, ...current.filter((record) => record.id !== value.id)]);
    if (value.publication) {
      setManager(value.publication.managerUserId);
      setResponsibles(value.publication.responsibleUserIds);
      setAccess(value.publication.accessStatus);
    }
  }, []);
  const refreshRegistry = useCallback(async () => {
    try {
      const values = await loadProjectImports(token, projectId);
      setRegistry(values);
      if (projectId && values[0]) accept(values[0]);
    } catch (failure) { setError(message(failure)); }
  }, [token, projectId, accept]);
  useEffect(() => {
    let cancelled = false;
    void loadProjectImports(token, projectId).then((values) => {
      if (!cancelled) {
        setRegistry(values);
        if (projectId && values[0]) accept(values[0]);
      }
    }).catch((failure: unknown) => { if (!cancelled) setError(message(failure)); });
    return () => { cancelled = true; };
  }, [token, projectId, accept]);
  useEffect(() => {
    if (!draft || !["queued", "processing"].includes(draft.state)) return;
    let cancelled = false;
    let timer: number;
    const poll = () => {
      void loadProjectImport(token, draft.id).then((value) => {
        if (!cancelled) { accept(value); setError(""); }
      }).catch((failure: unknown) => {
        if (!cancelled) {
          setError(message(failure));
          timer = window.setTimeout(poll, 3000);
        }
      });
    };
    timer = window.setTimeout(poll, 3000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [token, draft, accept]);
  const edit = (next: ProjectImportContent) => {
    setContent(next); setDirty(true); setReviewed(false);
  };
  const passport = <K extends keyof ProjectImportPassport>(key: K, value: ProjectImportPassport[K]) => {
    if (content) edit({ ...content, project: { ...content.project, [key]: value } });
  };
  const item = (directionIndex: number, itemIndex: number, patch: Partial<ProjectImportItem>) => {
    if (content) edit({ ...content, directions: content.directions.map((direction, index) => index === directionIndex ?
      { ...direction, items: direction.items.map((value, childIndex) => childIndex === itemIndex ? { ...value, ...patch } : value) } : direction) });
  };
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await operation(); } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  };
  const uploadAndAnalyze = () => run(async () => {
    let current = draft ?? await createProjectImport(token);
    accept(current);
    // Persist each accepted file immediately. A retry deduplicates by SHA-256 on the server.
    for (const file of files) {
      current = await uploadProjectImportDocument(token, current, file);
      accept(current);
    }
    setFiles([]);
    accept(await analyzeProjectImport(token, current));
  });
  const reload = () => run(async () => {
    if (draft) accept(await loadProjectImport(token, draft.id));
    else await refreshRegistry();
  });
  const download = (documentId: string) => run(async () => {
    if (!draft) return;
    const document = draft.documents.find((value) => value.id === documentId);
    if (!document) return;
    const blob = await downloadProjectImportDocument(token, draft.id, documentId);
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url; anchor.download = document.name; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
  const sources = (values: readonly ProjectImportSource[]) => values.length ? <details className="project-import-sources">
    <summary>Источники · {values.length}</summary>
    {values.map((source, index) => <div key={index}><Button size="small" disabled={busy} onClick={() => void download(source.documentId)}>
      {draft?.documents.find((value) => value.id === source.documentId)?.name ?? "Документ"}</Button>
      <span>{source.locator}</span>{source.excerpt ? <p>{source.excerpt}</p> : null}</div>)}
  </details> : null;
  const ready = draft?.state === "ready" && content;
  const pending = draft?.state === "queued" || draft?.state === "processing";
  const close = () => {
    if (busy) return;
    if (dirty) { setError("Есть несохранённые правки. Сохраните проверку или отмените правки."); return; }
    onClose();
  };

  return <WorkspaceDialog open onOpenChange={(_, data) => { if (!data.open) close(); }}>
    <DialogSurface className="project-import-dialog" aria-labelledby="project-import-title">
      <header><div><span className="view-kicker">ШАБЛОН ПРОЕКТА · 1</span>
        <h2 id="project-import-title">{archive ? "Документы и утверждённый шаблон" : "Проект из документов с ИИ"}</h2>
        <p>Ручное создание остаётся доступным. До подтверждения проект не создаётся.</p></div>
        <Button disabled={busy} aria-label="Закрыть импорт" onClick={close}>Закрыть</Button></header>
      <div className="project-import-scroll" aria-busy={busy || pending}>
        {!projectId ? <label>Продолжить сохранённый импорт<WorkspaceSelect aria-label="Сохранённый импорт"
          disabled={busy || dirty} value={draft?.id ?? ""} onChange={(event) => {
            const value = registry.find((record) => record.id === event.target.value);
            setManager(currentUserId); setResponsibles([]); setAccess("closed");
            if (value) { accept(value); setFiles([]); setError(""); }
            else { setDraft(undefined); setContent(undefined); setFiles([]); setReviewed(false); }
          }}><option value="">Новый пакет документов</option>{registry.map((record) => <option key={record.id} value={record.id}>
            {record.content.project.title || record.documents[0]?.name || "Черновик"} · {record.state}
          </option>)}</WorkspaceSelect></label> : null}
        {projectId && !draft ? <p>У этого проекта нет архива ИИ-импорта. Ручные проекты сохранены без изменений.</p> : null}
        {!archive && (!draft || ["draft", "failed"].includes(draft.state)) ? <>
          <WorkspaceFileDropzone label="Документы проекта" hint="Концепция, план, бюджет. PDF, DOCX, XLSX, TXT · 25 файлов, 100 МиБ."
            actionLabel="Добавить документы" files={files} multiple accept=".pdf,.docx,.xlsx,.txt"
            disabled={busy} onFiles={(added) => {
              const size = [...files, ...added].reduce((total, file) => total + file.size, 0) +
                (draft?.documents.reduce((total, document) => total + document.size, 0) ?? 0);
              if (added.some((file) => !file.size || file.size > 25 * 1024 * 1024) ||
                size > 100 * 1024 * 1024 || files.length + added.length + (draft?.documents.length ?? 0) > 25) {
                setError("Лимит: 25 файлов, 25 МиБ на файл и 100 МиБ на пакет.");
              } else { setFiles((current) => [...current, ...added]); setError(""); }
            }} />
          {files.map((file, index) => <div className="project-import-file" key={index}><span>{file.name}</span>
            <Button size="small" disabled={busy} onClick={() => setFiles((current) => current.filter((_, candidate) => candidate !== index))}>Убрать</Button></div>)}
          <label className="project-import-check"><input type="checkbox" checked={consent} disabled={busy}
            onChange={(event) => setConsent(event.target.checked)} />Разрешаю передать эти документы настроенному сервису ИИ (Gemini) для анализа.</label>
          <Button appearance="primary" disabled={busy || !consent || (!files.length && !draft?.documents.length)}
            onClick={() => void uploadAndAnalyze()}>{draft?.state === "failed" ? "Повторить анализ" : "Разобрать документы"}</Button>
        </> : null}
        {draft?.documents.length ? <details open={!ready && !archive}><summary>Исходные документы · {draft.documents.length}</summary>
          {draft.documents.map((document) => <div className="project-import-file" key={document.id}><span>{document.name} · {Math.ceil(document.size / 1024)} КиБ</span>
            <Button size="small" disabled={busy} onClick={() => void download(document.id)}>Скачать</Button></div>)}</details> : null}
        {pending ? <p role="status">Документы {draft.state === "queued" ? "ожидают обработки" : "анализируются"}. Можно закрыть окно и вернуться к черновику позже.</p> : null}
        {draft?.state === "failed" ? <p role="alert">{draft.error}</p> : null}
        {(ready || archive) && content ? <>
          <nav className="project-import-tabs" aria-label="Части шаблона">{([
            ["passport", "Паспорт"], ["plan", "Направления и работы"], ["budget", "Бюджет"], ["issues", "Проверка"],
          ] as const).map(([key, label]) => <Button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</Button>)}</nav>
          <fieldset disabled={busy || archive}>
            <legend>{tab === "passport" ? "Паспорт проекта" : tab === "plan" ? "План проекта" : tab === "budget" ? "Плановый бюджет" : "Расхождения и решения"}</legend>
            {tab === "passport" ? <div className="project-import-grid">
              <label>Название<Input value={content.project.title} onChange={(_, data) => passport("title", data.value)} /></label>
              <label>Короткий код проекта<Input value={content.project.code} onChange={(_, data) => passport("code", data.value)} /></label>
              <label className="wide">Цель и описание<Textarea value={content.project.description} onChange={(_, data) => passport("description", data.value)} /></label>
              <label>Начало<Input type="date" value={content.project.startDate ?? ""} onChange={(_, data) => passport("startDate", data.value || null)} /></label>
              <label>Окончание<Input type="date" value={content.project.endDate ?? ""} onChange={(_, data) => passport("endDate", data.value || null)} /></label>
              <label>Подтверждённый общий бюджет<Input value={content.project.budget} onChange={(_, data) => passport("budget", data.value)} /></label>
              <label>Валюта<WorkspaceSelect value={content.project.currency} onChange={(event) => passport("currency", currency(event.target.value))}>
                <option>UZS</option><option>USD</option><option>EUR</option></WorkspaceSelect></label>
              <label>Донор<Input value={content.project.donor} onChange={(_, data) => passport("donor", data.value)} /></label>
              <label>Партнёры<Textarea value={content.project.partners} onChange={(_, data) => passport("partners", data.value)} /></label>
              <label>Область плана<WorkspaceSelect value={content.project.scope} onChange={(event) => passport("scope", event.target.value === "consortium" ? "consortium" : "yuksalish")}>
                <option value="yuksalish">Только Yuksalish</option><option value="consortium">Весь консорциум</option></WorkspaceSelect></label>
              <label>Менеджер<WorkspaceSelect value={manager} onChange={(event) => { setManager(event.target.value); setReviewed(false); }}>
                {people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</WorkspaceSelect></label>
              <label>Доступ<WorkspaceSelect value={access} onChange={(event) => { setAccess(event.target.value === "open" ? "open" : "closed"); setReviewed(false); }}>
                <option value="closed">Закрытый</option><option value="open">Открытый</option></WorkspaceSelect></label>
              <label>Другие ответственные<WorkspaceSelect multiple aria-label="Ответственные проекта" value={responsibles}
                onChange={(event) => { setResponsibles(event.currentTarget.selectedOptions.map((option) => option.value)); setReviewed(false); }}>
                {people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</WorkspaceSelect></label>
            </div> : null}
            {tab === "plan" ? <>{content.directions.map((direction, index) => <section className="project-import-block" key={index}>
              <label>Направление {index + 1}<Input value={direction.title} onChange={(_, data) => edit({ ...content,
                directions: content.directions.map((value, at) => at === index ? { ...value, title: data.value } : value) })} /></label>
              <label>Описание направления<Textarea value={direction.description} onChange={(_, data) => edit({ ...content,
                directions: content.directions.map((value, at) => at === index ? { ...value, description: data.value } : value) })} /></label>
              <div className="project-import-grid">{(["startDate", "endDate"] as const).map((key) => <label key={key}>{key === "startDate" ? "Начало направления" : "Окончание направления"}
                <Input type="date" value={direction[key] ?? ""} onChange={(_, data) => edit({ ...content, directions:
                  content.directions.map((value, at) => at === index ? { ...value, [key]: data.value || null } : value) })} /></label>)}</div>
              {direction.items.map((work, child) => <div className="project-import-work" key={child}>
                <label className="project-import-check"><input type="checkbox" checked={work.include} onChange={(event) => item(index, child, { include: event.target.checked })} />Создать эту работу</label>
                <div className="project-import-grid">
                  <label>Название работы<Input value={work.title} onChange={(_, data) => item(index, child, { title: data.value })} /></label>
                  <label>Тип<WorkspaceSelect value={work.kind} onChange={(event) => item(index, child, { kind: event.target.value === "event" ? "event" : "task" })}>
                    <option value="task">Задача</option><option value="event">Мероприятие</option></WorkspaceSelect></label>
                  <label className="wide">Описание и ожидаемый результат<Textarea value={work.description} onChange={(_, data) => item(index, child, { description: data.value })} /></label>
                  <label>Период из документа<Input value={work.period} onChange={(_, data) => item(index, child, { period: data.value })} /></label>
                  <label>Плановый бюджет работы<Input value={work.budget} onChange={(_, data) => item(index, child, { budget: data.value })} /></label>
                  <label>Валюта бюджета работы<WorkspaceSelect value={work.budgetCurrency ?? ""} onChange={(event) => item(index, child, { budgetCurrency: event.target.value ? currency(event.target.value) : null })}>
                    <option value="">Уточнить</option><option>UZS</option><option>USD</option><option>EUR</option></WorkspaceSelect></label>
                  <label>Точное начало<Input type="datetime-local" value={localTime(work.startsAt)} onChange={(_, data) => item(index, child, { startsAt: instant(data.value) })} /></label>
                  <label>Точное завершение<Input type="datetime-local" value={localTime(work.dueAt)} onChange={(_, data) => item(index, child, { dueAt: instant(data.value) })} /></label>
                  <label>Исполнители<WorkspaceSelect multiple aria-label={`Исполнители: ${work.title}`} value={work.assigneeUserIds}
                    onChange={(event) => item(index, child, { assigneeUserIds: event.currentTarget.selectedOptions.map((option) => option.value) })}>
                    {people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</WorkspaceSelect></label>
                </div>
                {work.kind === "event" && !work.startsAt && !work.dueAt ? <p>Создадим плановую работу без публикации в календарь. Точное время можно уточнить позже.</p> : null}
                {sources(work.sources)}
              </div>)}
              <Button onClick={() => edit({ ...content, directions: content.directions.map((value, at) => at === index ?
                { ...value, items: [...value.items, emptyItem] } : value) })}>Добавить работу</Button>
              <Button onClick={() => edit({ ...content, directions: content.directions.filter((_, at) => at !== index) })}>Убрать направление</Button>
            </section>)}
              <Button onClick={() => edit({ ...content, directions: [...content.directions, { title: "", description: "",
                startDate: null, endDate: null, sources: [], items: [] }] })}>Добавить направление</Button></> : null}
            {tab === "budget" ? <>
              <p>Строки сохраняются точно, без пересчёта валют и сложения альтернативных бюджетов. Общая сумма на вкладке «Паспорт» подтверждается отдельно. Списание средств здесь не выполняется.</p>
              {content.budgetLines.map((line, index) => <div className="project-import-block" key={index}>
                <label>Статья<Input value={line.title} onChange={(_, data) => edit({ ...content, budgetLines:
                  content.budgetLines.map((value, at) => at === index ? { ...value, title: data.value } : value) })} /></label>
                <div className="project-import-grid"><label>Точная сумма<Input value={line.amount} onChange={(_, data) => edit({ ...content,
                  budgetLines: content.budgetLines.map((value, at) => at === index ? { ...value, amount: data.value } : value) })} /></label>
                  <label>Валюта<WorkspaceSelect value={line.currency} onChange={(event) => edit({ ...content,
                    budgetLines: content.budgetLines.map((value, at) => at === index ? { ...value, currency: currency(event.target.value) } : value) })}>
                    <option>UZS</option><option>USD</option><option>EUR</option></WorkspaceSelect></label>
                  <label>Источник финансирования<WorkspaceSelect value={line.funding} onChange={(event) => edit({ ...content, budgetLines:
                    content.budgetLines.map((value, at) => at === index ? { ...value, funding: event.target.value === "donor" ?
                      "donor" : event.target.value === "own" ? "own" : "unspecified" } : value) })}>
                    <option value="donor">Донор</option><option value="own">Собственный вклад</option><option value="unspecified">Уточнить</option></WorkspaceSelect></label></div>
                <Button onClick={() => edit({ ...content, budgetLines: content.budgetLines.filter((_, at) => at !== index) })}>Убрать статью</Button>
              </div>)}
              <Button onClick={() => edit({ ...content, budgetLines: [...content.budgetLines,
                { title: "", amount: "0", currency: content.project.currency, funding: "unspecified", sources: [] }] })}>Добавить статью</Button>
            </> : null}
            {tab === "issues" ? <>
              <p>Укажите решение каждого расхождения: какие сведения используем и почему. Не подставляйте приблизительные суммы или даты.</p>
              {content.issues.map((issue, index) => <div className="project-import-block" key={index}>
                <p>{issue.message}</p><label>Решение<Textarea value={issue.resolution} onChange={(_, data) => edit({ ...content,
                  issues: content.issues.map((value, at) => at === index ? { ...value, resolution: data.value } : value) })} /></label>
              </div>)}
            </> : null}
          </fieldset>
          {/* Sources stay downloadable when the archived form itself is read-only. */}
          {tab === "passport" ? sources(content.project.sources) : null}
          {tab === "plan" ? content.directions.map((direction, index) => <div key={index}>{direction.sources.length ? <strong>{direction.title}</strong> : null}{sources(direction.sources)}{archive ? direction.items.map((work, child) => <div key={child}>{work.sources.length ? <strong>{work.title}</strong> : null}{sources(work.sources)}</div>) : null}</div>) : null}
          {tab === "budget" ? content.budgetLines.map((line, index) => <div key={index}>{line.sources.length ? <strong>{line.title}</strong> : null}{sources(line.sources)}</div>) : null}
          {tab === "issues" ? content.issues.map((issue, index) => <div key={index}>{issue.sources.length ? <strong>{issue.message}</strong> : null}{sources(issue.sources)}</div>) : null}
          {!archive ? <label className="project-import-check"><input type="checkbox" checked={reviewed} disabled={dirty || busy}
            onChange={(event) => setReviewed(event.target.checked)} />Проверил сохранённый паспорт, работы, бюджет и решения по исходным документам.</label> : null}
        </> : null}
      </div>
      <footer>{error ? <p role="alert">{error}</p> : null}
        {dirty && draft ? <Button disabled={busy} onClick={() => { accept(draft); setError(""); }}>Отменить правки</Button> : null}
        <Button disabled={busy || dirty} onClick={() => void reload()}>Повторить загрузку</Button>
        {ready ? <><Button disabled={busy || !dirty} onClick={() => void run(async () => {
          if (draft && content) accept(await reviewProjectImport(token, draft, content));
        })}>Сохранить проверку</Button>
          <Button appearance="primary" disabled={busy || dirty || !reviewed || content.issues.some((issue) => !issue.resolution.trim())}
            onClick={() => void run(async () => {
              if (!draft) return;
              const result = await publishProjectImport(token, draft.id, { expectedRevision: draft.revision,
                managerUserId: manager, responsibleUserIds: responsibles, accessStatus: access, reviewed: true });
              accept(result);
              if (result.projectId) onCreated(result.projectId);
            })}>Создать проект</Button></> : null}
        {draft?.state === "published" && draft.projectId ? <Button appearance="primary" onClick={() => onCreated(draft.projectId!)}>Открыть проект</Button> : null}
      </footer>
    </DialogSurface>
  </WorkspaceDialog>;
}
