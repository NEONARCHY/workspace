import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AIReferentConfiguration,
  AIReferentAction,
  AIReferentLetter,
  AIReferentLetterInput,
  AIReferentRegistry,
  WorkspacePerson,
} from "@yuksalish/contracts";
import {
  Button,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Input,
  Spinner,
  Textarea,
} from "@fluentui/react-components";
import {
  Add24Regular,
  ArrowClockwise20Regular,
  ArrowDownload20Regular,
  Attach20Regular,
  Checkmark20Regular,
  Dismiss20Regular,
  Document20Regular,
  Mail24Regular,
  Open20Regular,
  Search20Regular,
} from "@fluentui/react-icons";

import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { WorkspaceSelect as Select } from "./WorkspaceSelect";
import { AIReferentIncomingRegister } from "./AIReferentIncomingRegister";
import { AIReferentSettings } from "./AIReferentSettings";
import { AIReferentFiles } from "./AIReferentFiles";
import { AIReferentRecipientPicker } from "./AIReferentRecipientPicker";
import { AIReferentArchive, AIReferentTelegram } from "./AIReferentArchive";
import {
  actOnAIReferentLetter,
  createAIReferentLetter,
  downloadWorkspaceAttachment,
  loadAIReferentRegistry,
  loadAIReferentLetter,
  loadAIReferentReviewers,
  updateAIReferentLetter,
  uploadWorkspaceAttachment,
} from "./workspace-api";

interface AIReferentViewProps {
  readonly token: string;
  readonly people: readonly WorkspacePerson[];
  readonly canCreate: boolean;
  readonly canAdmin?: boolean;
  readonly focusRequestId?: string;
  readonly focusRevision?: number;
}

const statusLabels: Readonly<Record<AIReferentLetter["status"], string>> = {
  draft: "Черновик",
  pending_review: "На согласовании",
  needs_revision: "На доработке",
  approved: "Согласовано",
  queued: "В очереди",
  sending: "Отправляется",
  sent: "Отправлено",
  failed: "Ошибка отправки",
  cancelled: "Отменено",
  awaiting_final_send: "Подписанный PDF · финальное решение",
  referent_review_pending: "Ожидает отправки референтом",
  delivery_unknown: "Нужно проверить доставку",
};

const actionLabels: Readonly<Record<AIReferentAction, string>> = {
  submit: "Отправить на согласование",
  approve: "Согласовать",
  return_for_revision: "Вернуть на доработку",
  cancel: "Отменить письмо",
  queue_delivery: "Подготовить подписанный PDF",
  retry_delivery: "Повторить подготовку PDF",
  release_delivery: "Разрешить отправку",
  send: "Отправить письмо референтом",
  confirm_sent: "Подтвердить доставку",
  confirm_not_sent: "Подтвердить: не доставлено",
};

interface LetterForm {
  subject: string;
  recipientOrganization: string;
  recipientAddress: string;
  route: "exat" | "webmail";
  note: string;
  reviewerUserId: string;
  finalReviewerUserId: string;
  file?: File;
  additionalFiles?: readonly File[];
}

const emptyForm = (): LetterForm => ({
  subject: "",
  recipientOrganization: "",
  recipientAddress: "",
  route: "exat",
  note: "",
  reviewerUserId: "",
  finalReviewerUserId: "",
});

function letterForm(letter: AIReferentLetter): LetterForm {
  return {
    subject: letter.subject,
    recipientOrganization: letter.recipientOrganization,
    recipientAddress: letter.recipientAddress,
    route: letter.route,
    note: letter.note,
    reviewerUserId: letter.reviewerUserId ?? "",
    finalReviewerUserId: letter.finalReviewerUserId ?? "",
  };
}

function formPayload(form: LetterForm): AIReferentLetterInput {
  return {
    subject: form.subject.trim(),
    recipientOrganization: form.recipientOrganization.trim(),
    recipientAddress: form.recipientAddress.trim(),
    route: form.route,
    note: form.note.trim(),
    reviewerUserId: form.reviewerUserId || null,
    finalReviewerUserId: form.finalReviewerUserId || null,
  };
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AIReferentView({ token, people, canCreate, canAdmin = false, focusRequestId, focusRevision }: AIReferentViewProps) {
  const [registerKind, setRegisterKind] = useState<"incoming" | "outgoing" | "settings" | "archive" | "telegram">("incoming");
  const [reviewerConfig, setReviewerConfig] = useState<AIReferentConfiguration>();
  const [registry, setRegistry] = useState<AIReferentRegistry>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [registryError, setRegistryError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<"all" | AIReferentLetter["status"]>("all");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<AIReferentLetter>();
  const [detailTab, setDetailTab] = useState<"overview" | "files" | "history">("overview");
  const editRevision = useRef(1);
  const saveOperation = useRef("");
  const requestSequence = useRef(0);
  const savedMetadata = useRef<{ readonly id: string; readonly fingerprint: string } | undefined>(undefined);
  const [confirmAction, setConfirmAction] = useState<AIReferentAction>();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<LetterForm>(emptyForm);
  const [decisionComment, setDecisionComment] = useState("");

  const selected = detail?.id === selectedId ? detail : registry?.letters.find((letter) => letter.id === selectedId);
  const reviewers = reviewerConfig?.reviewers.flatMap((item) =>
    item.canApprove && item.userId ? [{ id: item.userId, name: item.fullName }] : []) ?? [];
  // Search and counts use the same server-side selection across all pages.
  const visibleLetters = registry?.letters ?? [];

  const refresh = useCallback(async (quiet = false) => {
    const sequence = ++requestSequence.current;
    if (!quiet) { setLoading(true); setRegistryError(""); }
    try {
      const [next, nextReviewers] = await Promise.all([
        loadAIReferentRegistry(token, { query, status: filter === "all" ? undefined : filter, offset: page * 50 }), loadAIReferentReviewers(token),
      ]);
      if (sequence === requestSequence.current) { setReviewerConfig(nextReviewers); setRegistry(next); setRegistryError(""); }
    } catch (reason) {
      if (sequence === requestSequence.current) setRegistryError(reason instanceof Error ? reason.message : "Не удалось загрузить письма.");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [token, query, filter, page]);

  useEffect(() => {
    if (registerKind !== "outgoing") return;
    const debounce = setTimeout(() => { void refresh(); }, 250);
    const timer = setInterval(() => { if (!busyRef.current) void refresh(true); }, 15000);
    return () => { clearTimeout(debounce); clearInterval(timer); requestSequence.current += 1; };
  }, [refresh, registerKind]);

  useEffect(() => {
    if (!focusRequestId) return;
    queueMicrotask(() => { setRegisterKind("outgoing"); setSelectedId(focusRequestId); });
  }, [focusRequestId, focusRevision]);

  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    const reload = () => {
      if (busyRef.current) return;
      void loadAIReferentLetter(token, selectedId).then((letter) => { if (alive) setDetail(letter); })
        .catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : "Письмо недоступно."); });
    };
    reload();
    const timer = setInterval(reload, 10000);
    return () => { alive = false; clearInterval(timer); };
  }, [token, selectedId]);

  const replaceLetter = (updated: AIReferentLetter) => {
    setDetail(updated);
    setRegistry((current) => current ? {
      ...current,
      letters: current.letters.map((letter) => letter.id === updated.id ? updated : letter),
    } : current);
  };

  const openCreate = () => {
    savedMetadata.current = undefined;
    saveOperation.current = crypto.randomUUID();
    setEditingId("");
    setForm(emptyForm());
    setError("");
    setFormOpen(true);
  };

  const openEdit = (letter: AIReferentLetter) => {
    savedMetadata.current = undefined;
    editRevision.current = letter.revision;
    saveOperation.current = crypto.randomUUID();
    setEditingId(letter.id);
    setForm(letterForm(letter));
    setError("");
    setSelectedId("");
    setFormOpen(true);
  };

  const save = async () => {
    if (busyRef.current) return;
    if (!form.subject.trim() || !form.recipientOrganization.trim()) {
      setError("Укажите тему и организацию-получателя.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const existing = Boolean(editingId);
      const fingerprint = JSON.stringify(formPayload(form));
      let saved = savedMetadata.current?.fingerprint === fingerprint
        ? await loadAIReferentLetter(token, savedMetadata.current.id)
        : existing
        ? await updateAIReferentLetter(token, editingId, { ...formPayload(form), operationId: saveOperation.current }, editRevision.current)
        : await createAIReferentLetter(token, { ...formPayload(form), operationId: saveOperation.current });
      savedMetadata.current = { id: saved.id, fingerprint };
      editRevision.current = saved.revision;
      saveOperation.current = crypto.randomUUID();
      if (!editingId) {
        setEditingId(saved.id);
        setRegistry((current) => current ? {
          ...current,
          totalCount: current.totalCount + 1,
          letters: [saved, ...current.letters],
        } : { letters: [saved], totalCount: 1, pendingReviewCount: 0, readyCount: 0, sentCount: 0 });
      }
      if (form.file) {
        await uploadWorkspaceAttachment(
          token,
          "ai_referent_letter",
          saved.id,
          form.file,
          "primary",
        );
        const latest = await loadAIReferentRegistry(token);
        setRegistry(latest);
        saved = latest.letters.find((letter) => letter.id === saved.id) ?? saved;
      } else if (existing) {
        replaceLetter(saved);
      }
      for (const file of form.additionalFiles ?? []) {
        await uploadWorkspaceAttachment(token, "ai_referent_letter", saved.id, file, "additional");
      }
      saved = await loadAIReferentLetter(token, saved.id);
      replaceLetter(saved);
      editRevision.current = saved.revision;
      setSelectedId(saved.id);
      setFormOpen(false);
      savedMetadata.current = undefined;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить письмо.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const act = async (letter: AIReferentLetter, action: AIReferentAction) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const updated = await actOnAIReferentLetter(token, letter, action, decisionComment, crypto.randomUUID());
      replaceLetter(updated);
      setDecisionComment("");
      setConfirmAction(undefined);
      void refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось выполнить действие.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const download = async (attachmentId: string, fileName: string) => {
    setError("");
    try {
      const blob = await downloadWorkspaceAttachment(token, attachmentId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось скачать файл.");
    }
  };

  const selectedAdditionalFiles = form.additionalFiles ?? [];
  return (
    <section className="workspace-view ai-referent-view" aria-label="AI Referent">
      <header className="ai-referent-header">
        <div>
          <span className="view-kicker">Единая корреспонденция</span>
          <h1>AI Referent</h1>
          <p>Письма, согласования и архив — в одном рабочем пространстве.</p>
        </div>
        <div className="ai-referent-header-art" aria-hidden="true"><Mail24Regular /><span /><Mail24Regular /></div>
        <div className="ai-referent-header-actions">
          {registerKind === "outgoing" ? <Button
              appearance="subtle"
              icon={<ArrowClockwise20Regular />}
              disabled={loading || busy}
              onClick={() => void refresh()}
            >
              Обновить
            </Button> : null}
          {registerKind === "outgoing" && canCreate ? (
            <Button appearance="primary" icon={<Add24Regular />} onClick={openCreate}>
              Новое письмо
            </Button>
          ) : null}
        </div>
      </header>

      <div className="ai-referent-register-tabs" role="tablist" aria-label="Реестры корреспонденции">
        <button
          type="button"
          role="tab"
          aria-selected={registerKind === "incoming"}
          className={registerKind === "incoming" ? "active" : ""}
          onClick={() => setRegisterKind("incoming")}
        >
          Входящие
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={registerKind === "outgoing"}
          className={registerKind === "outgoing" ? "active" : ""}
          onClick={() => setRegisterKind("outgoing")}
        >
          Исходящие
        </button>
        {canAdmin ? <button type="button" role="tab" aria-selected={registerKind === "settings"}
          className={registerKind === "settings" ? "active" : ""}
          onClick={() => setRegisterKind("settings")}>Согласующие</button> : null}
        <button type="button" role="tab" aria-selected={registerKind === "archive"} className={registerKind === "archive" ? "active" : ""} onClick={() => setRegisterKind("archive")}>Архив и журналы</button>
        <button type="button" role="tab" aria-selected={registerKind === "telegram"} className={registerKind === "telegram" ? "active" : ""} onClick={() => setRegisterKind("telegram")}>Мой Telegram</button>
      </div>

      {registerKind === "settings" && canAdmin ? <AIReferentSettings token={token} people={people} /> :
        registerKind === "archive" ? <AIReferentArchive token={token} /> :
        registerKind === "telegram" ? <AIReferentTelegram token={token} /> :
        registerKind === "incoming" ? <AIReferentIncomingRegister token={token} /> : (
        <div className="ai-referent-page ai-referent-outgoing-page">

      <section className="ai-referent-summary" aria-label="Сводка исходящих писем">
        <button type="button" className="primary" aria-pressed={filter === "pending_review"} onClick={() => { setFilter("pending_review"); setPage(0); }}>
          <span>Ожидают решения</span><strong>{registry?.pendingReviewCount ?? 0}</strong>
          <small>Открыть очередь согласования</small>
        </button>
        <button type="button" aria-pressed={filter === "all"} onClick={() => { setFilter("all"); setPage(0); }}>
          <strong>{registry?.totalCount ?? 0}</strong><span>всего писем</span>
        </button>
        <button type="button" aria-pressed={filter === "approved"} onClick={() => { setFilter("approved"); setPage(0); }}>
          <strong>{registry?.readyCount ?? 0}</strong><span>готовы к отправке</span>
        </button>
        <button type="button" aria-pressed={filter === "sent"} onClick={() => { setFilter("sent"); setPage(0); }}>
          <strong>{registry?.sentCount ?? 0}</strong><span>отправлено</span>
        </button>
      </section>

      <div className="ai-referent-toolbar">
        <Input
          contentBefore={<Search20Regular />}
          aria-label="Поиск исходящих писем"
          placeholder="Номер, тема, организация или сотрудник"
          value={query}
          onChange={(_event, data) => { setQuery(data.value); setPage(0); }}
        />
        <div className="ai-referent-filters" role="group" aria-label="Фильтр писем">
          {([
            ["all", "Все"],
            ["draft", "Черновики"],
            ["pending_review", "На согласовании"],
            ["needs_revision", "Доработка"],
            ["sent", "Отправленные"],
          ] as const).map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={filter === key ? "active" : ""}
              aria-pressed={filter === key}
              onClick={() => { setFilter(key); setPage(0); }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {registryError ? <p className="ai-referent-feedback" role="alert">{registryError}</p> : null}
      {error ? <p className="ai-referent-feedback" role="alert">{error}</p> : null}
      {loading ? <div className="ai-referent-loading"><Spinner label="Загружаем письма" /></div> : null}
      {!loading && !registryError && visibleLetters.length === 0 ? (
        <div className="ai-referent-empty">
          <Mail24Regular />
          <h2>{query || filter !== "all" ? "Письма не найдены" : "Исходящих писем пока нет"}</h2>
          <p>{query || filter !== "all" ? "Попробуйте другой запрос или фильтр." : "Создайте первое письмо, чтобы начать согласование."}</p>
        </div>
      ) : null}
      {!loading && visibleLetters.length > 0 ? (
        <div className="ai-referent-list" role="region" aria-label="Исходящие письма" tabIndex={0}>
          {visibleLetters.map((letter) => (
            <button
              type="button"
              key={letter.id}
              className="ai-referent-row"
              onClick={() => { setSelectedId(letter.id); setDetailTab("overview"); setDecisionComment(""); setError(""); }}
            >
              <span className={`ai-referent-status status-${letter.status}`}>
                {statusLabels[letter.status]}
              </span>
              <span className="ai-referent-row-main">
                <strong>{letter.subject}</strong>
                <small>{letter.recipientOrganization}</small>
              </span>
              <span className="ai-referent-row-person">
                <small>Автор</small>{letter.createdByName}
              </span>
              <span className="ai-referent-row-person">
                <small>Согласующий</small>{letter.reviewerName ?? "Не назначен"}
              </span>
              <span className="ai-referent-row-number">
                <strong>{letter.displayNumber ?? "Без номера"}</strong>
                <small>{dateTime(letter.updatedAt)}</small>
              </span>
              <Open20Regular aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="ai-referent-pagination" role="group" aria-label="Страницы исходящих писем"><Button disabled={loading || page === 0} onClick={() => setPage((value) => value - 1)}>Назад</Button><span>Страница {page + 1}</span><Button disabled={loading || (registry?.letters.length ?? 0) < 50} onClick={() => setPage((value) => value + 1)}>Далее</Button></div>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={(_event, data) => !busy && setFormOpen(data.open)}>
        <DialogSurface className="ai-referent-form-dialog">
          <DialogBody>
            <DialogTitle
              action={(
                <DialogTrigger action="close" disableButtonEnhancement>
                  <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть" />
                </DialogTrigger>
              )}
            >
              {editingId ? "Редактировать письмо" : "Новое исходящее письмо"}
            </DialogTitle>
            <DialogContent>
              <div className="ai-referent-form">
                <label>Тема письма<Input value={form.subject} onChange={(_e, d) => setForm((current) => ({ ...current, subject: d.value }))} /></label>
                {formOpen ? <AIReferentRecipientPicker
                  token={token}
                  organization={form.recipientOrganization}
                  address={form.recipientAddress}
                  onSelect={(recipient) => setForm((current) => ({
                    ...current,
                    recipientOrganization: recipient.addressBookOrganization || recipient.name,
                    recipientAddress: recipient.addresses[0] || "",
                    route: recipient.route,
                  }))}
                  onManualChange={(recipientOrganization, recipientAddress) => setForm((current) => ({
                    ...current, recipientOrganization, recipientAddress,
                  }))}
                /> : null}
                <div className="ai-referent-form-grid">
                  <label>Канал отправки<Select value={form.route} onChange={(event) => setForm((current) => ({ ...current, route: event.target.value as LetterForm["route"] }))}><option value="exat">E-XAT</option><option value="webmail">Webmail</option></Select></label>
                  <label>Согласующий<Select value={form.reviewerUserId} onChange={(event) => setForm((current) => ({ ...current, reviewerUserId: event.target.value }))}><option value="">Не назначен</option>{reviewers.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</Select></label>
                </div>
                <label>Второй согласующий (необязательно)<Select value={form.finalReviewerUserId} onChange={(event) => setForm((current) => ({ ...current, finalReviewerUserId: event.target.value }))}><option value="">Без второго согласующего</option>{reviewers.filter((person) => person.id !== form.reviewerUserId).map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</Select></label>
                <label>Служебная заметка<Textarea resize="vertical" value={form.note} onChange={(_e, d) => setForm((current) => ({ ...current, note: d.value }))} /></label>
                <label className="ai-referent-upload-zone ai-referent-upload-primary">
                  <input className="ai-referent-upload-input" type="file" accept=".docx" aria-label="Выбрать основной документ DOCX" onChange={(event) => setForm((current) => ({ ...current, file: event.target.files?.[0] }))} />
                  <span className="ai-referent-upload-icon"><Document20Regular aria-hidden="true" /></span>
                  <span className="ai-referent-upload-copy"><strong>Основной документ</strong><small>{editingId ? "Новая версия письма в формате DOCX" : "Письмо в формате DOCX"}</small>{form.file ? <span className="ai-referent-upload-selected"><em title={form.file.name}>{form.file.name}</em></span> : null}</span>
                  <span className="ai-referent-upload-action">{form.file ? "Заменить" : "Выбрать DOCX"}</span>
                </label>
                <label className="ai-referent-upload-zone">
                  <input className="ai-referent-upload-input" type="file" multiple aria-label="Выбрать дополнительные вложения" onChange={(event) => setForm((current) => ({ ...current, additionalFiles: Array.from(event.target.files ?? []) }))} />
                  <span className="ai-referent-upload-icon"><Attach20Regular aria-hidden="true" /></span>
                  <span className="ai-referent-upload-copy"><strong>Дополнительные вложения</strong><small>Приложения, таблицы и сопроводительные файлы</small>{selectedAdditionalFiles.length ? <span className="ai-referent-upload-selected">{selectedAdditionalFiles.slice(0, 2).map((file, index) => <em key={`${file.name}-${index}`} title={file.name}>{file.name}</em>)}{selectedAdditionalFiles.length > 2 ? <em>+{selectedAdditionalFiles.length - 2}</em> : null}</span> : null}</span>
                  <span className="ai-referent-upload-action">{selectedAdditionalFiles.length ? "Изменить" : "Добавить файлы"}</span>
                </label>
                {error ? <p className="ai-referent-feedback" role="alert">{error}</p> : null}
                <div className="ai-referent-form-actions">
                  <Button appearance="secondary" disabled={busy} onClick={() => setFormOpen(false)}>Отмена</Button>
                  <Button appearance="primary" disabled={busy} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить черновик"}</Button>
                </div>
              </div>
            </DialogContent>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={Boolean(selected)} onOpenChange={(_event, data) => !data.open && !busy && setSelectedId("")}>
        <DialogSurface className="ai-referent-detail-dialog">
          {selected ? (
            <DialogBody>
              <DialogTitle
                action={(
                  <DialogTrigger action="close" disableButtonEnhancement>
                    <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть" />
                  </DialogTrigger>
                )}
              >
                <span className="ai-referent-detail-number">{selected.displayNumber ?? "Черновик без номера"}</span>
                {selected.subject}
              </DialogTitle>
              <DialogContent className="ai-referent-detail-content">
                <div className="ai-referent-detail-status">
                  <span className={`ai-referent-status status-${selected.status}`}>{statusLabels[selected.status]}</span>
                  <span>{selected.route === "exat" ? "E-XAT" : "Webmail"}</span>
                  <span>Источник: {selected.source === "telegram" ? "Telegram" : selected.source === "import" ? "Архив" : "Workspace"}</span>
                </div>
                <div className="ai-referent-detail-tabs" role="tablist" aria-label="Разделы письма">
                  {([ ["overview", "Обзор"], ["files", `Документы · ${selected.attachments.length}`], ["history", `История · ${selected.events.length}`] ] as const).map(([key, label]) =>
                    <button type="button" role="tab" key={key} aria-selected={detailTab === key} className={detailTab === key ? "active" : ""} onClick={() => setDetailTab(key)}>{label}</button>)}
                </div>
                {detailTab === "overview" ? <>
                <section className="ai-referent-detail-card ai-referent-recipient">
                  <h3>Получатель</h3>
                  <strong>{selected.recipientOrganization}</strong>
                  <p>{selected.recipientAddress || "Адрес будет уточнён перед отправкой"}</p>
                </section>
                <section className="ai-referent-detail-people">
                  <div><small>Автор</small><strong>{selected.createdByName}</strong></div>
                  <div><small>Согласующий</small><strong>{selected.reviewerName ?? "Не назначен"}</strong></div>
                </section>
                {selected.note ? <section className="ai-referent-detail-card"><h3>Заметка</h3><p>{selected.note}</p></section> : null}
                </> : null}
                {detailTab === "files" ?
                <section className="ai-referent-detail-section">
                  <h3>Файлы <span>{selected.attachments.length}</span></h3>
                  <AIReferentFiles token={token} kind="outgoing" ownerId={selected.id} letterLabel={`${selected.displayNumber ?? "Черновик"} — ${selected.subject}`} />
                  {selected.attachments.length ? selected.attachments.map((attachment) => (
                    <button type="button" key={attachment.id} className="ai-referent-file" aria-label={`Скачать ${attachment.fileName}`} onClick={() => void download(attachment.id, attachment.fileName)}>
                      <Document20Regular /><span><strong>{attachment.fileName}</strong><small>{Math.max(1, Math.round(attachment.byteSize / 1024))} КБ</small></span><ArrowDownload20Regular />
                    </button>
                  )) : <p className="ai-referent-muted">Файл письма ещё не приложен.</p>}
                </section> : null}
                {detailTab === "history" ?
                <section className="ai-referent-detail-section">
                  <h3>Активность</h3>
                  <div className="ai-referent-timeline">
                    {selected.events.map((event) => (
                      <div key={event.id}><i aria-hidden="true" /><span><strong>{event.actorName}</strong><small>{dateTime(event.createdAt)}</small><p>{event.comment || statusLabels[event.toStatus ?? selected.status]}</p></span></div>
                    ))}
                  </div>
                </section> : null}
                {selected.deliveryError ? <p role="alert">{selected.deliveryError}</p> : null}
                {selected.availableActions.some((action) => ["return_for_revision", "confirm_sent", "confirm_not_sent"].includes(action)) ? (
                  <label className="ai-referent-decision-comment">Комментарий к решению<Textarea value={decisionComment} onChange={(_e, d) => setDecisionComment(d.value)} /></label>
                ) : null}
                {error ? <p className="ai-referent-feedback" role="alert">{error}</p> : null}
                <div className="ai-referent-detail-actions">
                  {selected.canEdit ? <Button appearance="secondary" onClick={() => openEdit(selected)}>Редактировать</Button> : null}
                  {selected.availableActions.map((action) => (
                    <Button
                      key={action}
                      appearance={action === "approve" || action === "queue_delivery" || action === "submit" ? "primary" : "secondary"}
                      icon={action === "approve" ? <Checkmark20Regular /> : undefined}
                      disabled={busy || (["return_for_revision", "confirm_sent", "confirm_not_sent"].includes(action) && decisionComment.trim().length < 3)}
                      onClick={() => ["send", "cancel", "confirm_sent", "confirm_not_sent"].includes(action) ? setConfirmAction(action) : void act(selected, action)}
                    >
                      {actionLabels[action]}
                    </Button>
                  ))}
                </div>
                {confirmAction && selected.availableActions.includes(confirmAction) ? <div className="ai-referent-detail-card" role="group" aria-label="Подтверждение действия"><p>{confirmAction === "send" ? "Робот отправит письмо внешнему получателю. Подтверждаете?" : "Подтвердите изменение состояния письма."}</p><Button appearance="primary" disabled={busy} onClick={() => void act(selected, confirmAction)}>Подтвердить</Button><Button disabled={busy} onClick={() => setConfirmAction(undefined)}>Отмена</Button></div> : null}
              </DialogContent>
            </DialogBody>
          ) : null}
        </DialogSurface>
      </Dialog>
    </section>
  );
}
