import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AIReferentIncomingLetter,
  AIReferentIncomingRegistry,
} from "@yuksalish/contracts";
import { Button, Input, Spinner } from "@fluentui/react-components";
import {
  ArrowClockwise20Regular,
  ArrowDownload20Regular,
  Attach20Regular,
  MailInbox20Regular,
  Search20Regular,
  Warning20Regular,
} from "@fluentui/react-icons";

import {
  downloadAIReferentJournal,
  loadAIReferentIncomingRegistry,
} from "./workspace-api";

interface AIReferentIncomingRegisterProps {
  readonly token: string;
}

type IncomingFilter = "all" | "registered" | "attention" | "attachments";

const registeredStatuses = new Set(["platform_submitted", "submitted", "completed"]);
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

  const refresh = useCallback(async (search = "") => {
    setLoading(true);
    setError("");
    try {
      setRegistry(await loadAIReferentIncomingRegistry(token, { query: search }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить входящие письма.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(query); }, 250);
    return () => window.clearTimeout(timer);
  }, [query, refresh]);

  const letters = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return (registry?.letters ?? []).filter((letter) => {
      if (filter === "registered" && !registeredStatuses.has(letter.status)) return false;
      if (filter === "attention" && !isAttention(letter)) return false;
      if (filter === "attachments" && !letter.hasAttachments) return false;
      return !normalized || [
        letter.sequenceNumber,
        letter.platformIncomingNumber,
        letter.senderLetterNumber,
        letter.senderOrganization,
        letter.senderPerson,
        letter.subject,
        letter.responsibleUserName ?? letter.responsibleDisplayName,
      ].join(" ").toLocaleLowerCase("ru-RU").includes(normalized);
    });
  }, [filter, query, registry]);

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
    <div className="ai-incoming-register">
      <section className="ai-referent-summary" aria-label="Сводка входящих писем">
        <button type="button" className="primary" onClick={() => setFilter("registered")}>
          <span>Зарегистрировано</span><strong>{registry?.registeredCount ?? 0}</strong>
          <small>Письма, внесённые роботом в платформу</small>
        </button>
        <button type="button" onClick={() => setFilter("all")}>
          <strong>{registry?.totalCount ?? 0}</strong><span>всего входящих</span>
        </button>
        <button type="button" onClick={() => setFilter("attention")}>
          <strong>{registry?.attentionCount ?? 0}</strong><span>требуют внимания</span>
        </button>
        <button type="button" onClick={() => setFilter("attachments")}>
          <strong>{registry?.withAttachmentsCount ?? 0}</strong><span>с вложениями</span>
        </button>
      </section>

      <div className="ai-referent-toolbar ai-incoming-toolbar">
        <Input
          contentBefore={<Search20Regular />}
          aria-label="Поиск входящих писем"
          placeholder="Номер, организация, тема или ответственный"
          value={query}
          onChange={(_event, data) => setQuery(data.value)}
        />
        <div className="ai-referent-filters" role="group" aria-label="Фильтр входящих писем">
          {([
            ["all", "Все"],
            ["registered", "Зарегистрированные"],
            ["attention", "Требуют внимания"],
            ["attachments", "С вложениями"],
          ] as const).map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={filter === key ? "active" : ""}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
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

      <div className="ai-incoming-sync-line" aria-live="polite">
        <span className={registry?.lastSyncAt ? "online" : "offline"} aria-hidden="true" />
        {registry?.lastSyncAt
          ? `Последняя синхронизация: ${dateTime(registry.lastSyncAt)}`
          : "Робот ещё не синхронизировался с Workspace"}
        {registry?.journal.updatedAt ? ` · Excel: ${dateTime(registry.journal.updatedAt)}` : ""}
      </div>

      {error ? <p className="ai-referent-feedback" role="alert">{error}</p> : null}
      {loading ? <div className="ai-referent-loading"><Spinner label="Загружаем входящие письма" /></div> : null}
      {!loading && letters.length === 0 ? (
        <div className="ai-referent-empty">
          <MailInbox20Regular />
          <h2>Входящих писем пока нет</h2>
          <p>После первого запуска моста записи робота появятся здесь автоматически.</p>
        </div>
      ) : null}
      {!loading && letters.length > 0 ? (
        <div className="ai-incoming-table-wrap" role="region" aria-label="Реестр входящих писем" tabIndex={0}>
          <table className="ai-incoming-table">
            <thead>
              <tr>
                <th scope="col">Входящий №</th>
                <th scope="col">Получено</th>
                <th scope="col">Отправитель и тема</th>
                <th scope="col">Ответственный</th>
                <th scope="col">Вложения</th>
                <th scope="col">Статус</th>
              </tr>
            </thead>
            <tbody>
              {letters.map((letter) => (
                <tr key={letter.id} className={isAttention(letter) ? "needs-attention" : ""}>
                  <td>
                    <strong>{letter.platformIncomingNumber || `№ ${letter.sequenceNumber}`}</strong>
                    <small>{letter.senderLetterNumber ? `Исх. ${letter.senderLetterNumber}` : "Без номера отправителя"}</small>
                  </td>
                  <td><span>{dateTime(letter.receivedAt)}</span><small>{letter.source === "webmail" ? "Webmail" : "E-XAT"}</small></td>
                  <td className="ai-incoming-subject">
                    <strong>{letter.subject || "Без темы"}</strong>
                    <small>{letter.senderOrganization || letter.senderPerson || "Отправитель не определён"}</small>
                  </td>
                  <td>
                    <span>{letter.responsibleUserName ?? (letter.responsibleDisplayName || "Не назначен")}</span>
                    {!letter.responsibleUserId && letter.responsibleDisplayName ? <small>Ожидает сопоставления</small> : null}
                  </td>
                  <td>
                    <span className="ai-incoming-attachment-count"><Attach20Regular /> {letter.attachmentsCount}</span>
                    <small>{letter.mainDocumentFilename || "Нет файла"}</small>
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
    </div>
  );
}
