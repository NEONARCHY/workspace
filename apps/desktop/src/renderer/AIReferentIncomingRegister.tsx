import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AIReferentIncomingLetter,
  AIReferentIncomingRegistry,
} from "@yuksalish/contracts";
import { Button, Spinner } from "@fluentui/react-components";
import {
  ArrowClockwise20Regular,
  ArrowDownload20Regular,
  Attach20Regular,
  MailInbox20Regular,
  Warning20Regular,
} from "@fluentui/react-icons";

import {
  downloadAIReferentJournal,
  loadAIReferentIncomingRegistry,
} from "./workspace-api";
import { AIReferentFiles } from "./AIReferentFiles";
import { AIReferentGooeySearch } from "./AIReferentGooeySearch";

interface AIReferentIncomingRegisterProps {
  readonly token: string;
}

type IncomingFilter = "all" | "registered" | "attention" | "attachments";

const attentionStatuses = new Set(["failed", "completed_with_errors", "needs_review"]);

function statusLabel(letter: AIReferentIncomingLetter): string {
  const labels: Readonly<Record<string, string>> = {
    platform_submitted: "Зарегистрировано",
    submitted: "Зарегистрировано",
    completed: "Завершено",
    dry_run_completed: "Обработано без платформы",
    needs_review: "Нужна проверка",
    duplicate: "Дубликат",
    failed: "Ошибка",
    completed_with_errors: "Есть ошибки",
  };
  return labels[letter.status] ?? letter.status;
}

function dateTime(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isAttention(letter: AIReferentIncomingLetter): boolean {
  return attentionStatuses.has(letter.status) || Boolean(letter.errorMessage);
}

export function AIReferentIncomingRegister({ token }: AIReferentIncomingRegisterProps) {
  const [registry, setRegistry] = useState<AIReferentIncomingRegistry>();
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<IncomingFilter>("all");
  const [page, setPage] = useState(0);
  const requestSequence = useRef(0);
  const selectFilter = (next: IncomingFilter) => { setPage(0); setFilter(next); };

  const refresh = useCallback(async (search = "", quiet = false) => {
    const sequence = ++requestSequence.current;
    if (!quiet) { setLoading(true); setError(""); }
    try {
      const next = await loadAIReferentIncomingRegistry(token, { query: search, category: filter, offset: page * 100 });
      if (sequence === requestSequence.current) setRegistry(next);
    } catch (reason) {
      if (sequence === requestSequence.current) setError(reason instanceof Error ? reason.message : "Не удалось загрузить входящие письма.");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [token, filter, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(query); }, 250);
    const poll = window.setInterval(() => { void refresh(query, true); }, 15000);
    return () => { window.clearTimeout(timer); window.clearInterval(poll); requestSequence.current += 1; };
  }, [query, refresh]);

  const letters = registry?.letters ?? [];

  const downloadJournal = async () => {
    if (!registry?.journal.available || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const blob = await downloadAIReferentJournal(token);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = registry.journal.fileName ?? "register.xlsx";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось скачать Excel-журнал.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="ai-incoming-register ai-referent-page">
      <section className="ai-referent-summary" aria-label="Сводка входящих писем">
        <button type="button" className="primary" aria-pressed={filter === "registered"} onClick={() => selectFilter("registered")}>
          <span>Зарегистрировано</span><strong>{registry?.registeredCount ?? 0}</strong>
          <small>Письма, внесённые роботом в платформу</small>
        </button>
        <button type="button" aria-pressed={filter === "all"} onClick={() => selectFilter("all")}>
          <strong>{registry?.totalCount ?? 0}</strong><span>всего входящих</span>
        </button>
        <button type="button" aria-pressed={filter === "attention"} onClick={() => selectFilter("attention")}>
          <strong>{registry?.attentionCount ?? 0}</strong><span>требуют внимания</span>
        </button>
        <button type="button" aria-pressed={filter === "attachments"} onClick={() => selectFilter("attachments")}>
          <strong>{registry?.withAttachmentsCount ?? 0}</strong><span>с вложениями</span>
        </button>
      </section>

      <div className="ai-referent-toolbar ai-incoming-toolbar">
        <AIReferentGooeySearch
          ariaLabel="Поиск входящих писем"
          placeholder="Номер, организация, тема или ответственный"
          value={query}
          onValueChange={(value) => { setPage(0); setQuery(value); }}
        />
        <div className="ai-referent-toolbar-actions">
          <Button
            appearance="secondary"
            icon={<ArrowDownload20Regular />}
            disabled={!registry?.journal.available || downloading}
            onClick={() => void downloadJournal()}
          >
            {downloading ? "Скачиваем…" : "Excel-журнал"}
          </Button>
          <Button
            appearance="subtle"
            icon={<ArrowClockwise20Regular />}
            disabled={loading}
            onClick={() => void refresh(query)}
          >
            Обновить
          </Button>
        </div>
      </div>

      <div className="ai-incoming-sync-line" aria-live="polite">
        <span className={registry?.lastSyncAt ? "online" : "offline"} aria-hidden="true" />
        {registry?.lastSyncAt
          ? `Последняя синхронизация: ${dateTime(registry.lastSyncAt)}`
          : "Робот ещё не синхронизировался с Workspace"}
        {registry?.journal.updatedAt ? ` · Excel: ${dateTime(registry.journal.updatedAt)}` : ""}
      </div>

      {error ? <p className="ai-referent-feedback" role="alert">{error}</p> : null}
      {loading ? <div className="ai-referent-loading"><Spinner label="Загружаем входящие письма" /></div> : null}
      {!loading && !error && letters.length === 0 ? (
        <div className="ai-referent-empty">
          <MailInbox20Regular />
          <h2>{query || filter !== "all" ? "По этому запросу писем нет" : "Входящих писем пока нет"}</h2>
          <p>{query || filter !== "all" ? "Попробуйте изменить поиск или фильтр." : "После синхронизации записи робота появятся здесь автоматически."}</p>
        </div>
      ) : null}
      {!loading && letters.length > 0 ? (
        <div className="ai-incoming-table-wrap" role="region" aria-label="Реестр входящих писем" tabIndex={0}>
          <table className="ai-incoming-table">
            <thead>
              <tr>
                <th scope="col">Входящий №</th>
                <th scope="col">Отправитель и тема</th>
                <th scope="col">Документы</th>
                <th scope="col">Статус</th>
              </tr>
            </thead>
            <tbody>
              {letters.map((letter) => (
                <tr key={letter.id} className={isAttention(letter) ? "needs-attention" : ""}>
                  <td>
                    <strong>{letter.platformIncomingNumber || `№ ${letter.sequenceNumber}`}</strong>
                    <small>{dateTime(letter.receivedAt)} · {letter.source === "webmail" ? "Webmail" : "E-XAT"}</small>
                    {letter.senderLetterNumber ? <small title={letter.senderLetterNumber}>Исх. {letter.senderLetterNumber}</small> : null}
                  </td>
                  <td className="ai-incoming-subject">
                    <strong>{letter.subject || "Без темы"}</strong>
                    <small>{letter.senderOrganization || letter.senderPerson || "Отправитель не определён"} · Ответственный: {letter.responsibleUserName ?? (letter.responsibleDisplayName || "не назначен")}</small>
                  </td>
                  <td>
                    <span className="ai-incoming-attachment-count"><Attach20Regular /> {letter.attachmentsCount} {letter.attachmentsCount === 1 ? "файл" : "файлов"}</span>
                    {letter.mainDocumentFilename ? <small title={letter.mainDocumentFilename}>{letter.mainDocumentFilename}</small> : null}
                    <AIReferentFiles token={token} kind="incoming" ownerId={letter.id} letterLabel={`${letter.platformIncomingNumber || letter.sequenceNumber} — ${letter.subject || "Без темы"}`} />
                  </td>
                  <td>
                    <span className={`ai-incoming-status status-${isAttention(letter) ? "attention" : "ok"}`}>
                      {isAttention(letter) ? <Warning20Regular /> : null}{statusLabel(letter)}
                    </span>
                    {letter.errorMessage ? <small title={letter.errorMessage}>{letter.errorMessage}</small> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="ai-referent-pagination" role="group" aria-label="Страницы входящих писем">
        <Button disabled={page === 0 || loading} onClick={() => setPage(page - 1)}>Назад</Button>
        <span>Страница {page + 1} · Найдено {registry?.filteredCount ?? 0}</span>
        <Button disabled={loading || (page + 1) * 100 >= (registry?.filteredCount ?? 0)} onClick={() => setPage(page + 1)}>Далее</Button>
      </div>
    </div>
  );
}
