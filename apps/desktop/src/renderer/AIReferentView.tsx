import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
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
  Attach20Regular,
  Checkmark20Regular,
  Dismiss20Regular,
  DocumentArrowUp20Regular,
  Mail24Regular,
  Open20Regular,
  Search20Regular,
} from "@fluentui/react-icons";

import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { WorkspaceSelect as Select } from "./WorkspaceSelect";
import {
  actOnAIReferentLetter,
  createAIReferentLetter,
  downloadWorkspaceAttachment,
  loadAIReferentRegistry,
  updateAIReferentLetter,
  uploadWorkspaceAttachment,
} from "./workspace-api";

interface AIReferentViewProps {
  readonly token: string;
  readonly people: readonly WorkspacePerson[];
  readonly canCreate: boolean;
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
};

const actionLabels: Readonly<Record<AIReferentAction, string>> = {
  submit: "Отправить на согласование",
  approve: "Согласовать",
  return_for_revision: "Вернуть на доработку",
  cancel: "Отменить письмо",
  queue_delivery: "Поставить в очередь отправки",
  retry_delivery: "Повторить отправку",
};

interface LetterForm {
  subject: string;
  recipientOrganization: string;
  recipientAddress: string;
  route: "exat" | "webmail";
  note: string;
  reviewerUserId: string;
  file?: File;
}

const emptyForm = (): LetterForm => ({
  subject: "",
  recipientOrganization: "",
  recipientAddress: "",
  route: "exat",
  note: "",
  reviewerUserId: "",
});

function letterForm(letter: AIReferentLetter): LetterForm {
  return {
    subject: letter.subject,
    recipientOrganization: letter.recipientOrganization,
    recipientAddress: letter.recipientAddress,
    route: letter.route,
    note: letter.note,
    reviewerUserId: letter.reviewerUserId ?? "",
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

export function AIReferentView({ token, people, canCreate }: AIReferentViewProps) {
  const [registry, setRegistry] = useState<AIReferentRegistry>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | AIReferentLetter["status"]>("all");
  const [selectedId, setSelectedId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<LetterForm>(emptyForm);
  const [decisionComment, setDecisionComment] = useState("");

  const selected = registry?.letters.find((letter) => letter.id === selectedId);
  const reviewers = people.filter((person) => person.status === "active");
  const visibleLetters = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return (registry?.letters ?? []).filter((letter) => {
      if (filter !== "all" && letter.status !== filter) return false;
      return !normalized || [
        letter.displayNumber ?? "",
        letter.subject,
        letter.recipientOrganization,
        letter.createdByName,
        letter.reviewerName ?? "",
      ].join(" ").toLocaleLowerCase("ru-RU").includes(normalized);
    });
  }, [filter, query, registry]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await loadAIReferentRegistry(token);
      setRegistry(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить письма.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { queueMicrotask(() => { void refresh(); }); }, [refresh]);

  const replaceLetter = (updated: AIReferentLetter) => {
    setRegistry((current) => current ? {
      ...current,
      letters: current.letters.map((letter) => letter.id === updated.id ? updated : letter),
    } : current);
  };

  const openCreate = () => {
    setEditingId("");
    setForm(emptyForm());
    setError("");
    setFormOpen(true);
  };

  const openEdit = (letter: AIReferentLetter) => {
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
      const existing = registry?.letters.find((letter) => letter.id === editingId);
      let saved = existing
        ? await updateAIReferentLetter(token, existing.id, formPayload(form), existing.revision)
        : await createAIReferentLetter(token, formPayload(form));
      if (!existing) {
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
      setSelectedId(saved.id);
      setFormOpen(false);
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
      const updated = await actOnAIReferentLetter(token, letter, action, decisionComment);
      replaceLetter(updated);
      setDecisionComment("");
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

  return (
    <section className="workspace-view ai-referent-view" aria-label="AI Referent">
      <header className="ai-referent-header">
        <div>
          <span className="view-kicker">Исходящая корреспонденция</span>
          <h1>AI Referent</h1>
          <p>Единый реестр писем из Workspace и Telegram с контролируемой отправкой.</p>
        </div>
        <div className="ai-referent-header-actions">
          <Button
            appearance="subtle"
            icon={<ArrowClockwise20Regular />}
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            Обновить
          </Button>
          {canCreate ? (
            <Button appearance="primary" icon={<Add24Regular />} onClick={openCreate}>
              Новое письмо
            </Button>
          ) : null}
        </div>
      </header>

      <section className="ai-referent-summary" aria-label="Сводка исходящих писем">
        <button type="button" className="primary" onClick={() => setFilter("pending_review")}>
          <span>Ожидают решения</span><strong>{registry?.pendingReviewCount ?? 0}</strong>
          <small>Открыть очередь согласования</small>
        </button>
        <button type="button" onClick={() => setFilter("all")}>
          <strong>{registry?.totalCount ?? 0}</strong><span>всего писем</span>
        </button>
        <button type="button" onClick={() => setFilter("approved")}>
          <strong>{registry?.readyCount ?? 0}</strong><span>готовы к отправке</span>
        </button>
        <button type="button" onClick={() => setFilter("sent")}>
          <strong>{registry?.sentCount ?? 0}</strong><span>отправлено</span>
        </button>
      </section>

      <div className="ai-referent-toolbar">
        <Input
          contentBefore={<Search20Regular />}
          aria-label="Поиск исходящих писем"
          placeholder="Номер, тема, организация или сотрудник"
          value={query}
          onChange={(_event, data) => setQuery(data.value)}
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
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="ai-referent-feedback" role="alert">{error}</p> : null}
      {loading ? <div className="ai-referent-loading"><Spinner label="Загружаем письма" /></div> : null}
      {!loading && visibleLetters.length === 0 ? (
        <div className="ai-referent-empty">
          <Mail24Regular />
          <h2>Здесь пока нет писем</h2>
          <p>Создайте черновик или измените фильтр поиска.</p>
        </div>
      ) : null}
      {!loading && visibleLetters.length > 0 ? (
        <div className="ai-referent-list" role="region" aria-label="Исходящие письма">
          {visibleLetters.map((letter) => (
            <button
              type="button"
              key={letter.id}
              className="ai-referent-row"
              onClick={() => { setSelectedId(letter.id); setDecisionComment(""); setError(""); }}
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
                <label>Организация-получатель<Input value={form.recipientOrganization} onChange={(_e, d) => setForm((current) => ({ ...current, recipientOrganization: d.value }))} /></label>
                <label>Адрес или получатель<Input value={form.recipientAddress} onChange={(_e, d) => setForm((current) => ({ ...current, recipientAddress: d.value }))} /></label>
                <div className="ai-referent-form-grid">
                  <label>Канал отправки<Select value={form.route} onChange={(event) => setForm((current) => ({ ...current, route: event.target.value as LetterForm["route"] }))}><option value="exat">E-XAT</option><option value="webmail">Webmail</option></Select></label>
                  <label>Согласующий<Select value={form.reviewerUserId} onChange={(event) => setForm((current) => ({ ...current, reviewerUserId: event.target.value }))}><option value="">Не назначен</option>{reviewers.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</Select></label>
                </div>
                <label>Служебная заметка<Textarea resize="vertical" value={form.note} onChange={(_e, d) => setForm((current) => ({ ...current, note: d.value }))} /></label>
                <label className="ai-referent-file-field">
                  <span><Attach20Regular /> Файл письма</span>
                  <input type="file" accept=".doc,.docx,.pdf" onChange={(event) => setForm((current) => ({ ...current, file: event.target.files?.[0] }))} />
                  <small>{form.file?.name ?? (editingId ? "Можно добавить новую версию файла" : "DOC, DOCX или PDF · до 25 МБ")}</small>
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
                <section className="ai-referent-detail-card">
                  <h3>Получатель</h3>
                  <strong>{selected.recipientOrganization}</strong>
                  <p>{selected.recipientAddress || "Адрес будет уточнён перед отправкой"}</p>
                </section>
                <section className="ai-referent-detail-people">
                  <div><small>Автор</small><strong>{selected.createdByName}</strong></div>
                  <div><small>Согласующий</small><strong>{selected.reviewerName ?? "Не назначен"}</strong></div>
                </section>
                {selected.note ? <section className="ai-referent-detail-card"><h3>Заметка</h3><p>{selected.note}</p></section> : null}
                <section className="ai-referent-detail-section">
                  <h3>Файлы <span>{selected.attachments.length}</span></h3>
                  {selected.attachments.length ? selected.attachments.map((attachment) => (
                    <button type="button" key={attachment.id} className="ai-referent-file" onClick={() => void download(attachment.id, attachment.fileName)}>
                      <DocumentArrowUp20Regular /><span><strong>{attachment.fileName}</strong><small>{Math.max(1, Math.round(attachment.byteSize / 1024))} КБ</small></span><Open20Regular />
                    </button>
                  )) : <p className="ai-referent-muted">Файл письма ещё не приложен.</p>}
                </section>
                <section className="ai-referent-detail-section">
                  <h3>Активность</h3>
                  <div className="ai-referent-timeline">
                    {selected.events.map((event) => (
                      <div key={event.id}><i aria-hidden="true" /><span><strong>{event.actorName}</strong><small>{dateTime(event.createdAt)}</small><p>{event.comment || statusLabels[event.toStatus ?? selected.status]}</p></span></div>
                    ))}
                  </div>
                </section>
                {selected.availableActions.includes("return_for_revision") ? (
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
                      disabled={busy || (action === "return_for_revision" && decisionComment.trim().length < 3)}
                      onClick={() => void act(selected, action)}
                    >
                      {actionLabels[action]}
                    </Button>
                  ))}
                </div>
              </DialogContent>
            </DialogBody>
          ) : null}
        </DialogSurface>
      </Dialog>
    </section>
  );
}
