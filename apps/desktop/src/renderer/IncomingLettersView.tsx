import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EdoIncomingDetail, EdoIncomingFilter, EdoIncomingLetter, EdoIncomingPage, WorkspacePerson,
} from "@yuksalish/contracts";
import {
  addEdoIncomingAssignment, completeEdoIncomingLetter, downloadEdoIncomingAttachment,
  loadEdoIncomingLetter, loadEdoIncomingLetters,
} from "./workspace-api";
import "./incoming-letters.css";

type StatusFilter = "all" | EdoIncomingFilter;

const statusNames: Record<Exclude<EdoIncomingLetter["status"], null>, string> = {
  1: "В работе",
  2: "Выполнено исполнителем",
  3: "Подтверждено",
};

function statusName(status: EdoIncomingLetter["status"]): string {
  return status === null ? "Не просмотрено" : statusNames[status] ?? "Статус не определён";
}

function dateLabel(raw: string | null): string {
  if (!raw) return "Не указан";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : raw;
}

function safeFileName(name: string): string {
  return [...name].map((character) =>
    character === "/" || character === "\\" || character.charCodeAt(0) < 32 ? "_" : character,
  ).join("").slice(0, 180) || "document";
}

export function IncomingLettersView({ token, people, currentUserId, canEdit }: {
  readonly token: string;
  readonly people: readonly WorkspacePerson[];
  readonly currentUserId: string;
  readonly canEdit: boolean;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [registry, setRegistry] = useState<EdoIncomingPage>();
  const [selectedId, setSelectedId] = useState<number>();
  const [detail, setDetail] = useState<EdoIncomingDetail>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [actionError, setActionError] = useState("");
  const [needsReconcile, setNeedsReconcile] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [result, setResult] = useState("");
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewName, setPreviewName] = useState("");
  const listSequence = useRef(0);
  const detailSequence = useRef(0);

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const letter = detail?.data;
  const assignedIds = useMemo(
    () => new Set(letter?.assignments.map((assignment) => assignment.employee_id) ?? []),
    [letter],
  );
  const candidates = people.filter((person) => person.status === "active" && !assignedIds.has(person.id));
  const canAct = Boolean(canEdit && letter && (letter.status === null || letter.status === 1)
    && assignedIds.has(currentUserId) && !busy && !needsReconcile);

  const refreshList = useCallback(async () => {
    const sequence = ++listSequence.current;
    setLoading(true);
    setError("");
    try {
      const next = await loadEdoIncomingLetters(token, {
        page, q: query, status: filter === "all" ? undefined : filter,
      });
      if (sequence === listSequence.current) setRegistry(next);
    } catch (reason) {
      if (sequence === listSequence.current) {
        setRegistry(undefined);
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить письма.");
      }
    } finally {
      if (sequence === listSequence.current) setLoading(false);
    }
  }, [token, page, query, filter]);

  const refreshDetail = useCallback(async (id: number) => {
    const sequence = ++detailSequence.current;
    setDetailLoading(true);
    setDetailError("");
    try {
      const next = await loadEdoIncomingLetter(token, id);
      if (sequence === detailSequence.current) {
        setDetail(next);
        setNeedsReconcile(false);
        setActionError("");
      }
    } catch (reason) {
      if (sequence === detailSequence.current) {
        setDetail(undefined);
        setDetailError(reason instanceof Error ? reason.message : "Не удалось открыть письмо.");
      }
    } finally {
      if (sequence === detailSequence.current) setDetailLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refreshList(), 0);
    return () => { window.clearTimeout(timer); listSequence.current += 1; };
  }, [refreshList]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedId !== undefined) void refreshDetail(selectedId);
    }, 0);
    return () => { window.clearTimeout(timer); detailSequence.current += 1; };
  }, [selectedId, refreshDetail]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const selectLetter = (id: number) => {
    if (selectedId !== id) {
      setSelectedId(id);
      setDetail(undefined);
      setDetailError("");
      setTargetId("");
      setResult("");
      setConfirmComplete(false);
      setPreviewUrl("");
      setPreviewName("");
      setNeedsReconcile(false);
      setActionError("");
    }
  };

  const applyAction = async (kind: "assign" | "complete") => {
    if (!letter || !canAct) return;
    setBusy(true);
    setActionError("");
    const key = crypto.randomUUID();
    try {
      const next = kind === "assign"
        ? await addEdoIncomingAssignment(token, letter.id, letter.version, targetId, key)
        : await completeEdoIncomingLetter(token, letter.id, letter.version, key,
          result.trim() ? result.trim() : undefined);
      setDetail(next);
      setTargetId("");
      setResult("");
      setConfirmComplete(false);
      void refreshList();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Действие не выполнено.");
      // A timeout or transport failure can hide a successful remote write.
      // Never issue another mutation until a fresh read reconciles its outcome.
      setNeedsReconcile(true);
    } finally {
      setBusy(false);
    }
  };

  const openAttachment = async (attachment: { readonly id: string; readonly name: string }, preview: boolean) => {
    if (!letter) return;
    setActionError("");
    try {
      const blob = await downloadEdoIncomingAttachment(token, letter.id, attachment.id);
      const pdf = attachment.name.toLowerCase().endsWith(".pdf");
      const url = URL.createObjectURL(preview && pdf
        ? new Blob([blob], { type: "application/pdf" }) : blob);
      if (preview && pdf) {
        setPreviewUrl(url);
        setPreviewName(attachment.name);
      } else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = safeFileName(attachment.name);
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Не удалось открыть документ.");
    }
  };

  const totalPages = registry ? Math.max(1, Math.ceil(registry.meta.total / registry.meta.limit)) : 1;
  const overdueOnPage = registry?.data.filter((item) => item.overdue === true).length ?? 0;

  return <section className="workspace-view edo-incoming" aria-label="Входящие письма">
    <header className="edo-incoming-header">
      <div><p className="edo-incoming-eyebrow">Документооборот · поручения</p><h1>Входящие письма</h1>
        <p>Письма, назначенные вам в документообороте. Выполнение передаётся обратно в ЭДО.</p></div>
      <button type="button" className="edo-incoming-secondary" onClick={() => {
        void refreshList(); if (selectedId !== undefined) void refreshDetail(selectedId);
      }} disabled={loading || detailLoading}>Обновить</button>
    </header>
    <div className="edo-incoming-summary" aria-live="polite">
      <span><strong>{registry?.meta.total ?? "—"}</strong> найдено писем</span>
      <span><strong>{registry?.deadline_timezone_verified ? overdueOnPage : "—"}</strong> просрочено на этой странице</span>
      {!registry?.deadline_timezone_verified ? <span className="edo-incoming-caution">Расчёт просрочки ожидает сверки часового пояса ЭДО</span> : null}
    </div>
    <div className="edo-incoming-controls">
      <label>Поиск по номеру или краткому описанию
        <input type="search" value={searchInput} maxLength={100} onChange={(event) => {
          setSearchInput(event.target.value); setPage(1);
        }} placeholder="Номер или слова из описания" />
      </label>
      <label>Состояние
        <select value={filter} onChange={(event) => { setFilter(event.target.value as StatusFilter); setPage(1); }}>
          <option value="all">Все состояния</option><option value="unread">Не просмотрено</option>
          <option value="in_progress">В работе</option><option value="completed">Выполнено</option>
          <option value="confirmed">Подтверждено</option>
        </select>
      </label>
    </div>
    <div className="edo-incoming-layout">
      <div className="edo-incoming-list" aria-label="Список входящих писем">
        {error ? <div role="alert" className="edo-incoming-error">{error}<button type="button" onClick={() => void refreshList()}>Повторить</button></div> : null}
        {loading ? <p role="status" className="edo-incoming-empty">Загружаем письма…</p> : null}
        {!loading && !error && registry?.data.length === 0 ? <p className="edo-incoming-empty">Письма по выбранным условиям не найдены.</p> : null}
        {!loading && !error && registry?.data.map((item) => <button type="button" key={item.id}
          className={`edo-incoming-row${selectedId === item.id ? " is-selected" : ""}`}
          aria-pressed={selectedId === item.id} onClick={() => selectLetter(item.id)}>
          <span className="edo-incoming-row-head"><strong>{item.in_num || `Письмо № ${item.id}`}</strong>
            <span className={`edo-incoming-status status-${item.status ?? "new"}`}>{statusName(item.status)}</span></span>
          <span className="edo-incoming-row-org">{item.organization || "Организация не указана"}</span>
          <span className="edo-incoming-row-desc">{item.description || "Краткое описание отсутствует"}</span>
          <span className="edo-incoming-row-foot">Зарегистрировано: {dateLabel(item.in_date)} · Срок: {dateLabel(item.deadline)}
            {item.overdue === true ? <em>Просрочено</em> : null}</span>
        </button>)}
        {registry && !loading && !error ? <nav className="edo-incoming-pages" aria-label="Страницы писем">
          <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Назад</button>
          <span>Страница {page} из {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Далее</button>
        </nav> : null}
      </div>
      <div className="edo-incoming-detail" aria-label="Карточка письма">
        {selectedId === undefined ? <div className="edo-incoming-empty">Выберите письмо, чтобы увидеть содержание и документы.</div> : null}
        {detailLoading ? <p role="status" className="edo-incoming-empty">Открываем письмо…</p> : null}
        {detailError ? <div role="alert" className="edo-incoming-error">{detailError}
          <button type="button" onClick={() => selectedId !== undefined && void refreshDetail(selectedId)}>Повторить</button></div> : null}
        {letter && !detailLoading ? <>
          <div className="edo-incoming-detail-title"><div><p className="edo-incoming-eyebrow">Входящий № {letter.in_num || letter.id}</p>
            <h2>{letter.organization || "Входящее письмо"}</h2></div>
            <span className={`edo-incoming-status status-${letter.status ?? "new"}`}>{statusName(letter.status)}</span></div>
          <dl className="edo-incoming-facts">
            <div><dt>Дата регистрации</dt><dd>{dateLabel(letter.in_date)}</dd></div>
            <div><dt>Исходящий №</dt><dd>{letter.out_num || "Не указан"}</dd></div>
            <div><dt>Регион</dt><dd>{letter.region || "Не указан"}</dd></div>
            <div><dt>Срок</dt><dd>{dateLabel(letter.deadline)}{letter.overdue ? <strong className="edo-incoming-late"> · Просрочено</strong> : null}</dd></div>
            {letter.deadline2 ? <div><dt>Дополнительный срок</dt><dd>{dateLabel(letter.deadline2)}</dd></div> : null}
            {letter.type ? <div><dt>Тип</dt><dd>{letter.type}</dd></div> : null}
          </dl>
          <div className="edo-incoming-section"><h3>Краткая информация</h3><p>{letter.description || "Описание отсутствует."}</p>
            <small>Полный текст хранится в оригинальном документе ниже.</small></div>
          {letter.comment ? <div className="edo-incoming-section"><h3>Примечание ЭДО</h3><p>{letter.comment}</p></div> : null}
          <div className="edo-incoming-section"><h3>Исполнители</h3>
            {letter.assignments.length ? <ol className="edo-incoming-people">{[...letter.assignments].sort((a, b) => a.queue - b.queue).map((assignment) =>
              <li key={assignment.user_id}>{assignment.employee_id
                ? peopleById.get(assignment.employee_id)?.name ?? "Сотрудник Workspace"
                : "Исполнитель ЭДО без привязки к Workspace"}</li>)}</ol>
              : <p>Исполнители не указаны.</p>}</div>
          <div className="edo-incoming-section"><h3>Оригинал и вложения</h3>
            {letter.attachments.length ? <ul className="edo-incoming-files">{letter.attachments.map((attachment) => <li key={attachment.id}>
              <span>{attachment.name}</span><div>
                {attachment.name.toLowerCase().endsWith(".pdf") ? <button type="button" onClick={() => void openAttachment(attachment, true)}>Просмотреть</button> : null}
                <button type="button" onClick={() => void openAttachment(attachment, false)}>Скачать</button>
              </div></li>)}</ul> : <p>Файлов пока нет.</p>}
            {previewUrl ? <div className="edo-incoming-preview"><div><strong>{previewName}</strong><button type="button" onClick={() => setPreviewUrl("")}>Закрыть просмотр</button></div>
              <iframe title={`Предпросмотр ${previewName}`} src={previewUrl} /></div> : null}</div>
          {letter.result !== null || letter.result_time ? <div className="edo-incoming-section"><h3>Результат выполнения</h3>
            <p>{letter.result || "Без текста результата"}</p><small>{letter.result_time ? `Отмечено: ${dateLabel(letter.result_time)}` : ""}</small></div> : null}
          {canEdit && (letter.status === null || letter.status === 1) ? <div className="edo-incoming-actions">
            <h3>Действия по письму</h3>
            {assignedIds.has(currentUserId) ? <>
              <label>Передать следующему исполнителю
                <select value={targetId} disabled={!canAct} onChange={(event) => setTargetId(event.target.value)}>
                  <option value="">Выберите сотрудника</option>
                  {candidates.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select></label>
              <button type="button" className="edo-incoming-secondary" disabled={!canAct || !targetId}
                onClick={() => void applyAction("assign")}>Добавить исполнителя</button>
              <div className="edo-incoming-complete"><label>Результат (необязательно, до 255 символов)
                <textarea value={result} maxLength={255} disabled={!canAct} onChange={(event) => setResult(event.target.value)}
                  placeholder="Кратко опишите выполненную работу" /></label>
                {!confirmComplete ? <button type="button" className="edo-incoming-primary" disabled={!canAct}
                  onClick={() => setConfirmComplete(true)}>Отметить выполненным</button>
                  : <div className="edo-incoming-confirm" role="group" aria-label="Подтверждение выполнения">
                    <p>Выполнение завершит всё письмо для всех исполнителей. Подтверждение руководителем остаётся отдельным этапом.</p>
                    <button type="button" className="edo-incoming-primary" disabled={!canAct}
                      onClick={() => void applyAction("complete")}>Подтвердить выполнение</button>
                    <button type="button" className="edo-incoming-secondary" onClick={() => setConfirmComplete(false)}>Отмена</button>
                  </div>}
              </div>
            </> : <p>Действия доступны только назначенному исполнителю.</p>}
          </div> : null}
          {actionError ? <div role="alert" className="edo-incoming-error">{actionError}
            {needsReconcile ? <button type="button" onClick={() => void refreshDetail(letter.id)}>Проверить состояние письма</button> : null}</div> : null}
        </> : null}
      </div>
    </div>
  </section>;
}
