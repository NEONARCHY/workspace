import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AIReferentConfiguration,
  AIReferentDocumentCheck,
  AIReferentCommentAudio,
  AIReferentAction,
  AIReferentLetter,
  AIReferentLetterInput,
  AIReferentRegistry,
  WorkspacePerson,
} from "@yuksalish/contracts";
import {
  Button,
  DialogActions,
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
  Mail32Regular,
  MailArrowForward20Regular,
  MailInbox48Regular,
  MailMultiple32Regular,
  Open20Regular,
} from "@fluentui/react-icons";

import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { WorkspaceSelect as Select } from "./WorkspaceSelect";
import { AIReferentIncomingRegister } from "./AIReferentIncomingRegister";
import { AIReferentSettings } from "./AIReferentSettings";
import { AIReferentFiles, referentDownloadName, saveReferentBlob } from "./AIReferentFiles";
import { AIReferentAudioComposer, AIReferentAudioPlayer } from "./AIReferentAudioComment";
import { AIReferentRecipientPicker } from "./AIReferentRecipientPicker";
import { AIReferentArchive, AIReferentTelegram } from "./AIReferentArchive";
import { AIReferentGooeySearch } from "./AIReferentGooeySearch";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import {
  actOnAIReferentLetter,
  deleteAIReferentLetter,
  checkAIReferentDocument,
  loadAIReferentDocumentCheck,
  loadAIReferentPacket,
  downloadAIReferentPacket,
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
  signed: "Подписано · без отправки",
  operator_revision: "Администратор заменяет файл",
};

const actionLabels: Readonly<Record<AIReferentAction, string>> = {
  submit: "Отправить на согласование",
  approve: "Согласовать",
  return_for_revision: "Вернуть на доработку",
  cancel: "Отменить письмо",
  queue_delivery: "Подготовить подписанный PDF",
  retry_delivery: "Повторить подготовку PDF",
  release_delivery: "Отправить",
  send: "Отправить письмо референтом",
  confirm_sent: "Подтвердить доставку",
  confirm_not_sent: "Подтвердить: не доставлено",
  remind: "Напомнить согласующему",
  replace_document: "Заменить письмо",
  mark_sent: "Отправлено вручную",
  prepare_replacement: "Применить замену без согласования",
};

interface LetterForm {
  workflowKind: "delivery" | "sign_only";
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

const emptyForm = (workflowKind: LetterForm["workflowKind"] = "delivery"): LetterForm => ({
  workflowKind,
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
    workflowKind: letter.workflowKind,
    subject: letter.subject,
    recipientOrganization: letter.recipientOrganization,
    recipientAddress: letter.recipientAddress,
    route: letter.route,
    note: letter.note,
    reviewerUserId: letter.finalReviewerUserId ?? letter.initialReviewerUserId ?? letter.reviewerUserId ?? "",
    finalReviewerUserId: letter.finalReviewerUserId ? (letter.initialReviewerUserId ?? letter.reviewerUserId ?? "") : "",
  };
}

function formPayload(form: LetterForm): AIReferentLetterInput {
  return {
    workflowKind: form.workflowKind,
    subject: form.subject.trim(),
    recipientOrganization: form.workflowKind === "sign_only" ? "Подписание без отправки" : form.recipientOrganization.trim(),
    recipientAddress: form.workflowKind === "sign_only" ? "" : form.recipientAddress.trim(),
    route: form.workflowKind === "sign_only" ? "exat" : form.route,
    note: form.note.trim(),
    reviewerUserId: (form.workflowKind === "delivery" && form.finalReviewerUserId ? form.finalReviewerUserId : form.reviewerUserId) || null,
    finalReviewerUserId: form.workflowKind === "delivery" && form.finalReviewerUserId ? form.reviewerUserId : null,
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
  const [registerKind, setRegisterKind] = useState<"incoming" | "outgoing" | "sign_only" | "settings" | "archive" | "telegram">("incoming");
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
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<LetterForm>(emptyForm);
  const [decisionComment, setDecisionComment] = useState("");
  const [decisionAudio, setDecisionAudio] = useState<{ letterId: string; revision: number; audio: AIReferentCommentAudio }>();
  const [documentCheck, setDocumentCheck] = useState<{ file: File; result?: AIReferentDocumentCheck; error?: string }>();
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [replacement, setReplacement] = useState<{ letterId: string; file: File }>();
  const replacementFile = replacement?.letterId === selectedId ? replacement.file : undefined;

  const selected = detail?.id === selectedId ? detail : registry?.letters.find((letter) => letter.id === selectedId);
  const selectedAudio = decisionAudio?.letterId === selected?.id && decisionAudio?.revision === selected?.revision ? decisionAudio?.audio : undefined;
  const activeCheck = documentCheck?.file === form.file ? documentCheck : undefined;
  const checkingFile = Boolean(form.file && (!activeCheck?.result || ["pending", "checking"].includes(activeCheck.result.status)));
  const reviewers = reviewerConfig?.reviewers.flatMap((item) =>
    item.canApprove && item.userId ? [{ id: item.userId, name: item.fullName }] : []) ?? [];
  const boburId = reviewerConfig?.reviewers.find((item) => item.key === "bobur" && item.canApprove)?.userId;
  // Search and counts use the same server-side selection across all pages.
  const visibleLetters = registry?.letters ?? [];

  useEffect(() => {
    const file = form.file;
    if (!formOpen || !file) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (reason: unknown) => { if (alive) setDocumentCheck({ file, error: reason instanceof Error ? reason.message : "Проверка недоступна. Повторите попытку." }); };
    const accept = (result: AIReferentDocumentCheck) => {
      if (!alive) return;
      setDocumentCheck({ file, result });
      if (result.status === "pending" || result.status === "checking") {
        timer = setTimeout(() => { void loadAIReferentDocumentCheck(token, result.id).then(accept).catch(fail); }, 2500);
      }
    };
    void checkAIReferentDocument(token, file, form.workflowKind).then(accept).catch(fail);
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [token, form.file, form.workflowKind, formOpen, checkAttempt]);

  const selectDocument = (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".docx") || file.size > 20 * 1024 * 1024) {
      setError("Основной документ должен быть DOCX размером до 20 МБ."); return;
    }
    setError(""); setDocumentCheck(undefined);
    setForm((current) => ({ ...current, file }));
    setCheckAttempt((attempt) => attempt + 1);
  };

  const refresh = useCallback(async (quiet = false) => {
    const sequence = ++requestSequence.current;
    if (!quiet) { setLoading(true); setRegistryError(""); }
    try {
      const [next, nextReviewers] = await Promise.all([
        loadAIReferentRegistry(token, { query, status: filter === "all" ? undefined : filter, offset: page * 50, workflowKind: registerKind === "sign_only" ? "sign_only" : "delivery" }), loadAIReferentReviewers(token),
      ]);
      if (sequence === requestSequence.current) { setReviewerConfig(nextReviewers); setRegistry(next); setRegistryError(""); }
    } catch (reason) {
      if (sequence === requestSequence.current) setRegistryError(reason instanceof Error ? reason.message : "Не удалось загрузить письма.");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [token, query, filter, page, registerKind]);

  useEffect(() => {
    if (registerKind !== "outgoing" && registerKind !== "sign_only") return;
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
      void loadAIReferentLetter(token, selectedId).then((letter) => {
        if (alive) {
          setDetail(letter);
          if (letter.workflowKind === "sign_only") setRegisterKind("sign_only");
        }
      })
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

  const openCreate = (workflowKind: LetterForm["workflowKind"] = "delivery") => {
    savedMetadata.current = undefined;
    saveOperation.current = crypto.randomUUID();
    setEditingId("");
    setForm(emptyForm(workflowKind));
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
    if (form.file && activeCheck?.result?.status !== "passed") { setError("Дождитесь успешной проверки DOCX роботом."); return; }
    if (form.workflowKind === "delivery" && form.reviewerUserId === boburId && !form.finalReviewerUserId) { setError("Выберите предварительного согласующего перед Бобуром."); return; }
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
        } : { letters: [saved], totalCount: 1, pendingReviewCount: 0, readyCount: 0, sentCount: 0, signedCount: 0 });
      }
      if (form.file) {
        await uploadWorkspaceAttachment(
          token,
          "ai_referent_letter",
          saved.id,
          form.file,
          "primary",
          undefined,
          saved.revision,
        );
        saved = await loadAIReferentLetter(token, saved.id);
        replaceLetter(saved);
      } else if (existing) {
        replaceLetter(saved);
      }
      for (const file of form.additionalFiles ?? []) {
        await uploadWorkspaceAttachment(token, "ai_referent_letter", saved.id, file, "additional", undefined, saved.revision);
        saved = await loadAIReferentLetter(token, saved.id);
      }
      saved = await loadAIReferentLetter(token, saved.id);
      replaceLetter(saved);
      editRevision.current = saved.revision;
      setRegisterKind(form.workflowKind === "sign_only" ? "sign_only" : "outgoing");
      setFilter("all");
      setPage(0);
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
      const updated = await actOnAIReferentLetter(token, letter, action, decisionComment, crypto.randomUUID(), action === "return_for_revision" ? selectedAudio?.id : undefined);
      replaceLetter(updated);
      setDecisionComment("");
      setDecisionAudio(undefined);
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
        <div className="ai-referent-header-art" aria-hidden="true">
          <MailInbox48Regular className="ai-referent-header-mail mail-inbox" />
          <Mail32Regular className="ai-referent-header-mail mail-main" />
          <MailMultiple32Regular className="ai-referent-header-mail mail-stack" />
          <MailArrowForward20Regular className="ai-referent-header-mail mail-forward" />
          <Mail24Regular className="ai-referent-header-mail mail-edge" />
        </div>
        <div className="ai-referent-header-actions">
          {canCreate ? (<>
            <Button appearance="primary" icon={<Add24Regular />} onClick={() => openCreate("delivery")}>
              Новое письмо
            </Button>
            <Button appearance="secondary" icon={<Document20Regular />} onClick={() => openCreate("sign_only")}>
              На подпись
            </Button>
          </>) : null}
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
          onClick={() => { setRegisterKind("outgoing"); setFilter("all"); setPage(0); }}
        >
          Исходящие
        </button>
        <button type="button" role="tab" aria-selected={registerKind === "sign_only"}
          className={registerKind === "sign_only" ? "active" : ""}
          onClick={() => { setRegisterKind("sign_only"); setFilter("all"); setPage(0); }}>
          На подпись
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

      <section className="ai-referent-summary" aria-label={registerKind === "sign_only" ? "Сводка заявок на подпись" : "Сводка исходящих писем"}>
        <button type="button" className="primary" aria-pressed={filter === "pending_review"} onClick={() => { setFilter("pending_review"); setPage(0); }}>
          <span>Ожидают решения</span><strong>{registry?.pendingReviewCount ?? 0}</strong>
          <small>Открыть очередь согласования</small>
        </button>
        <button type="button" aria-pressed={filter === "all"} onClick={() => { setFilter("all"); setPage(0); }}>
          <strong>{registry?.totalCount ?? 0}</strong><span>{registerKind === "sign_only" ? "пакетов на подпись" : "всего писем"}</span>
        </button>
        <button type="button" aria-pressed={filter === (registerKind === "sign_only" ? "queued" : "approved")} onClick={() => { setFilter(registerKind === "sign_only" ? "queued" : "approved"); setPage(0); }}>
          <strong>{registry?.readyCount ?? 0}</strong><span>{registerKind === "sign_only" ? "готовятся роботом" : "готовы к отправке"}</span>
        </button>
        <button type="button" aria-pressed={filter === (registerKind === "sign_only" ? "signed" : "sent")} onClick={() => { setFilter(registerKind === "sign_only" ? "signed" : "sent"); setPage(0); }}>
          <strong>{registerKind === "sign_only" ? registry?.signedCount ?? 0 : registry?.sentCount ?? 0}</strong><span>{registerKind === "sign_only" ? "подписано" : "отправлено"}</span>
        </button>
      </section>

      <div className="ai-referent-toolbar">
        <AIReferentGooeySearch
          ariaLabel={registerKind === "sign_only" ? "Поиск пакетов на подпись" : "Поиск исходящих писем"}
          placeholder="Номер, тема, организация или сотрудник"
          value={query}
          onValueChange={(value) => { setQuery(value); setPage(0); }}
        />
        <div className="ai-referent-toolbar-actions">
          <div className="ai-referent-filters" role="group" aria-label="Фильтр писем">
            {([
              ["all", "Все"],
              ["draft", "Черновики"],
              ["pending_review", "На согласовании"],
              ["needs_revision", "Доработка"],
              [registerKind === "sign_only" ? "signed" : "sent", registerKind === "sign_only" ? "Подписанные" : "Отправленные"],
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
          <Button
            appearance="subtle"
            icon={<ArrowClockwise20Regular />}
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            Обновить
          </Button>
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
                <small>{letter.workflowKind === "sign_only" ? "Без отправки адресату · каждая страница — отдельный PDF" : letter.recipientOrganization}</small>
              </span>
              <span className="ai-referent-row-person">
                <small>Автор</small><EmployeeProfileLink
                  userId={letter.createdByUserId}
                  personName={letter.createdByName}
                >{letter.createdByName}</EmployeeProfileLink>
              </span>
              <span className="ai-referent-row-person">
                <small>Согласующий</small><EmployeeProfileLink
                  userId={letter.reviewerUserId ?? undefined}
                  personName={letter.reviewerName ?? "Не назначен"}
                >{letter.reviewerName ?? "Не назначен"}</EmployeeProfileLink>
              </span>
              <span className="ai-referent-row-number">
                <strong>{letter.displayNumber ?? (letter.workflowKind === "sign_only" ? "На подпись" : "Без номера")}</strong>
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
              {form.workflowKind === "sign_only" ? (editingId ? "Редактировать заявку на подпись" : "Подписать без отправки") : (editingId ? "Редактировать письмо" : "Новое исходящее письмо")}
            </DialogTitle>
            <DialogContent>
              <div className="ai-referent-form">
                <label>Тема письма (необязательно)<Input maxLength={300} placeholder="Если пропустить — исходящий номер" value={form.subject} onChange={(_e, d) => setForm((current) => ({ ...current, subject: d.value }))} /></label>
                <small>Оставьте пустой — робот использует исходящий номер. Введённая тема уйдёт без добавления номера.</small>
                {form.workflowKind === "sign_only" ? <p className="ai-referent-sign-hint">Загрузите DOCX, выберите одного согласующего. После его решения робот вернёт каждый лист отдельным подписанным PDF. Адресатам письма не отправляются.</p> : null}
                {formOpen && form.workflowKind === "delivery" ? <AIReferentRecipientPicker
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
                    route: recipientAddress.includes("@") ? (recipientAddress.toLowerCase().endsWith("@exat.uz") ? "exat" : "webmail") : current.route,
                  }))}
                /> : null}
                <div className="ai-referent-form-grid">
                  {form.workflowKind === "delivery" ? <div className="ai-referent-select-field"><span id="referent-route-label">Канал отправки</span><Select aria-labelledby="referent-route-label" value={form.route} onChange={(event) => setForm((current) => ({ ...current, route: event.target.value as LetterForm["route"] }))}><option value="exat">E-XAT</option><option value="webmail">Webmail</option></Select></div> : null}
                  <div className="ai-referent-select-field"><span id="referent-reviewer-label">Согласующий</span><Select aria-labelledby="referent-reviewer-label" value={form.reviewerUserId} onChange={(event) => setForm((current) => ({ ...current, reviewerUserId: event.target.value, finalReviewerUserId: "" }))}><option value="">Не назначен</option>{reviewers.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</Select></div>
                </div>
                {form.workflowKind === "delivery" && boburId && form.reviewerUserId === boburId ? <div className="ai-referent-select-field"><span id="referent-preliminary-label">Предварительный согласующий — до Бобура · обязательно</span><Select aria-labelledby="referent-preliminary-label" required value={form.finalReviewerUserId} onChange={(event) => setForm((current) => ({ ...current, finalReviewerUserId: event.target.value }))}><option value="" disabled>Выберите предварительного согласующего</option>{reviewers.filter((person) => person.id !== boburId).map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</Select></div> : null}
                <label>Служебная заметка<Textarea resize="vertical" value={form.note} onChange={(_e, d) => setForm((current) => ({ ...current, note: d.value }))} /></label>
                <label className="ai-referent-upload-zone ai-referent-upload-primary" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={(event) => { event.preventDefault(); if (!busy) selectDocument(event.dataTransfer.files[0]); }}>
                  <input className="ai-referent-upload-input" disabled={busy} type="file" accept=".docx" aria-label="Выбрать основной документ DOCX" onChange={(event) => selectDocument(event.target.files?.[0])} />
                  <span className="ai-referent-upload-icon"><Document20Regular aria-hidden="true" /></span>
                  <span className="ai-referent-upload-copy"><strong>Основной документ</strong><small>{editingId ? "Новая версия письма в формате DOCX" : "Письмо в формате DOCX"}</small>{form.file ? <span className="ai-referent-upload-selected"><em title={form.file.name}>{form.file.name}</em></span> : null}</span>
                  <span className="ai-referent-upload-action">{form.file ? "Заменить" : "Выбрать DOCX"}</span>
                </label>
                {form.file && (checkingFile || activeCheck?.error || activeCheck?.result?.status === "failed") ? <div className="ai-referent-preflight" role="status" aria-live="polite">
                  {activeCheck?.error || activeCheck?.result?.status === "failed" ? <><p>{activeCheck.error || activeCheck.result?.detail}</p><Button onClick={() => { setDocumentCheck(undefined); setCheckAttempt((attempt) => attempt + 1); }}>Повторить проверку</Button></> : <><Spinner size="tiny" /><span>Подождите: робот проверяет форматирование и место для подписи.<small>Проверка выполняется на ПК референта. Если он выключен, письмо останется в ожидании.</small></span></>}
                </div> : null}
                {form.workflowKind === "delivery" ? <label className="ai-referent-upload-zone" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={(event) => { event.preventDefault(); const files = Array.from(event.dataTransfer.files); if (!busy) setForm((current) => ({ ...current, additionalFiles: [...(current.additionalFiles ?? []), ...files] })); }}>
                  <input className="ai-referent-upload-input" type="file" multiple aria-label="Выбрать дополнительные вложения" onChange={(event) => setForm((current) => ({ ...current, additionalFiles: Array.from(event.target.files ?? []) }))} />
                  <span className="ai-referent-upload-icon"><Attach20Regular aria-hidden="true" /></span>
                  <span className="ai-referent-upload-copy"><strong>Дополнительные вложения</strong><small>Приложения, таблицы и сопроводительные файлы</small>{selectedAdditionalFiles.length ? <span className="ai-referent-upload-selected">{selectedAdditionalFiles.slice(0, 2).map((file, index) => <em key={`${file.name}-${index}`} title={file.name}>{file.name}</em>)}{selectedAdditionalFiles.length > 2 ? <em>+{selectedAdditionalFiles.length - 2}</em> : null}</span> : null}</span>
                  <span className="ai-referent-upload-action">{selectedAdditionalFiles.length ? "Изменить" : "Добавить файлы"}</span>
                </label> : null}
                {error ? <p className="ai-referent-feedback" role="alert">{error}</p> : null}
              </div>
            </DialogContent>
            <DialogActions className="ai-referent-form-actions">
              <Button appearance="secondary" disabled={busy} onClick={() => setFormOpen(false)}>Отмена</Button>
              <Button appearance="primary" disabled={busy || Boolean(form.file && activeCheck?.result?.status !== "passed")} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить черновик"}</Button>
            </DialogActions>
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
                <span className="ai-referent-detail-number">{selected.displayNumber ?? (selected.workflowKind === "sign_only" ? "Подпись без отправки" : "Черновик без номера")}</span>
                {selected.subject || selected.displayNumber || "Тема — исходящий номер"}
              </DialogTitle>
              <DialogContent className="ai-referent-detail-content">
                <div className="ai-referent-detail-status">
                  <span className={`ai-referent-status status-${selected.status}`}>{statusLabels[selected.status]}</span>
                  <span>{selected.workflowKind === "sign_only" ? "Только подпись · без доставки" : selected.route === "exat" ? "E-XAT" : "Webmail"}</span>
                  <span>Источник: {selected.source === "telegram" ? "Telegram" : selected.source === "import" ? "Архив" : "Workspace"}</span>
                </div>
                {selected.documentCheck && selected.canEdit && selected.documentCheck.status !== "passed" ? <p className="ai-referent-preflight" role="status">{selected.documentCheck.detail || "Робот проверяет DOCX. Согласование станет доступно после успешной проверки."}</p> : null}
                {selected.finalPdfFileId ? <section className="ai-referent-detail-card"><h3>Итоговый подписанный PDF</h3><p>Проверьте именно этот документ перед отправкой. Приложения в предварительный просмотр не включены.</p><Button disabled={busy} icon={<ArrowDownload20Regular />} onClick={() => {
                  setError("");
                  void loadAIReferentPacket(token, "outgoing", selected.id).then(async (packet) => {
                    const pdf = packet.files.find((entry) => entry.id === selected.finalPdfFileId);
                    if (!pdf) throw new Error("Итоговый PDF ещё недоступен. Обновите письмо.");
                    saveReferentBlob(await downloadAIReferentPacket(token, "outgoing", selected.id, pdf), referentDownloadName(selected.displayNumber || selected.subject || "Подписанное письмо", "pdf"));
                  }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить PDF."));
                }}>Открыть подписанный PDF</Button></section> : null}
                <div className="ai-referent-detail-tabs" role="tablist" aria-label="Разделы письма">
                  {([ ["overview", "Обзор"], ["files", `Документы · ${selected.attachments.length}`], ["history", `История · ${selected.events.length}`] ] as const).map(([key, label]) =>
                    <button type="button" role="tab" key={key} aria-selected={detailTab === key} className={detailTab === key ? "active" : ""} onClick={() => setDetailTab(key)}>{label}</button>)}
                </div>
                {detailTab === "overview" ? <>
                {selected.workflowKind === "delivery" ? <section className="ai-referent-detail-card ai-referent-recipient">
                  <h3>Получатель</h3>
                  <strong>{selected.recipientOrganization}</strong>
                  <p>{selected.recipientAddress || "Адрес будет уточнён перед отправкой"}</p>
                </section> : null}
                <section className="ai-referent-detail-people">
                  <div><small>Автор</small><EmployeeProfileLink
                    userId={selected.createdByUserId}
                    personName={selected.createdByName}
                  ><strong>{selected.createdByName}</strong></EmployeeProfileLink></div>
                  <div><small>Согласующий</small><EmployeeProfileLink
                    userId={selected.reviewerUserId ?? undefined}
                    personName={selected.reviewerName ?? "Не назначен"}
                  ><strong>{selected.reviewerName ?? "Не назначен"}</strong></EmployeeProfileLink></div>
                </section>
                {selected.note ? <section className="ai-referent-detail-card"><h3>Заметка</h3><p>{selected.note}</p></section> : null}
                </> : null}
                {detailTab === "files" ?
                <section className="ai-referent-detail-section">
                  <h3>Файлы <span>{selected.attachments.length}</span></h3>
                  <AIReferentFiles token={token} kind="outgoing" ownerId={selected.id} letterLabel={`${selected.displayNumber ?? (selected.workflowKind === "sign_only" ? "Подпись" : "Черновик")} — ${selected.subject}`} />
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
                      <div key={event.id}><i aria-hidden="true" /><span><EmployeeProfileLink
                        userId={event.actorUserId ?? undefined}
                        personName={event.actorName}
                      ><strong>{event.actorName}</strong></EmployeeProfileLink><small>{dateTime(event.createdAt)}</small><p>{event.comment || statusLabels[event.toStatus ?? selected.status]}</p>{event.audio ? <AIReferentAudioPlayer key={event.audio.id} token={token} audio={event.audio} /> : null}</span></div>
                    ))}
                  </div>
                </section> : null}
                {selected.deliveryError ? <p role="alert">{selected.deliveryError}</p> : null}
                {selected.canReplaceDocument ? <section className="ai-referent-detail-card">
                  <h3>Замена администратором</h3>
                  <p>Без нового согласования. DOCX получит прежний номер и подпись; готовый PDF будет использован как есть. Проверьте номер, подпись и содержимое.</p>
                  <label className="ai-referent-upload-zone" key={selected.id}>
                    <input className="ai-referent-upload-input" type="file" accept=".docx,.pdf" aria-label="Новый документ администратора" onChange={(event) => { const file = event.target.files?.[0]; setReplacement(file ? { letterId: selected.id, file } : undefined); }} />
                    <Document20Regular /><span>{replacementFile?.name ?? "Выбрать DOCX или PDF"}</span>
                  </label>
                  <Button disabled={busy || !replacementFile} onClick={() => {
                    if (!replacementFile || busyRef.current) return;
                    busyRef.current = true; setBusy(true); setError("");
                    void uploadWorkspaceAttachment(token, "ai_referent_letter", selected.id, replacementFile, "primary", undefined, selected.revision)
                      .then(() => loadAIReferentLetter(token, selected.id))
                      .then((letter) => { replaceLetter(letter); setReplacement(undefined); })
                      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить замену."))
                      .finally(() => { busyRef.current = false; setBusy(false); });
                  }}>Загрузить замену</Button>
                </section> : null}
                {selected.availableActions.some((action) => ["return_for_revision", "confirm_sent", "confirm_not_sent"].includes(action)) ? (
                  <label className="ai-referent-decision-comment">Комментарий к решению<Textarea value={decisionComment} onChange={(_e, d) => setDecisionComment(d.value)} /></label>
                ) : null}
                {selected.availableActions.includes("return_for_revision") ? <AIReferentAudioComposer key={`${selected.id}:${selected.revision}`} token={token} letter={selected} disabled={busy} value={selectedAudio} onChange={(audio) => setDecisionAudio(audio ? { letterId: selected.id, revision: selected.revision, audio } : undefined)} /> : null}
                {error ? <p className="ai-referent-feedback" role="alert">{error}</p> : null}
                <div className="ai-referent-detail-actions">
                  {selected.canEdit ? <Button appearance="secondary" onClick={() => openEdit(selected)}>Редактировать</Button> : null}
                  {selected.canDelete ? <Button disabled={busy} onClick={() => setDeleteConfirmation(selected.id)}>Удалить письмо из базы</Button> : null}
                  {selected.availableActions.map((action) => (
                    <Button
                      key={action}
                      appearance={action === "approve" || action === "queue_delivery" || action === "submit" ? "primary" : "secondary"}
                      icon={action === "approve" ? <Checkmark20Regular /> : undefined}
                      disabled={busy || (["return_for_revision", "confirm_sent", "confirm_not_sent"].includes(action) && decisionComment.trim().length < 3 && !(action === "return_for_revision" && selectedAudio))}
                      onClick={() => ["send", "cancel", "confirm_sent", "confirm_not_sent", "mark_sent", "replace_document", "prepare_replacement"].includes(action) ? setConfirmAction(action) : void act(selected, action)}
                    >
                      {selected.workflowKind === "sign_only" ? ({ submit: "Отправить на подпись", approve: "Одобрить подпись", retry_delivery: "Повторить подпись", cancel: "Отменить заявку" } as Partial<Record<AIReferentAction, string>>)[action] ?? actionLabels[action] : actionLabels[action]}
                    </Button>
                  ))}
                </div>
                {deleteConfirmation === selected.id ? <section className="ai-referent-detail-card" aria-label="Подтверждение удаления"><p>Удалить письмо из общей базы Workspace и Telegram? Отправленные письма и выполняемую отправку удалить нельзя. Журнал удаления и резервные файлы сохранятся.</p><Button disabled={busy} onClick={() => {
                  if (busyRef.current) return;
                  busyRef.current = true; setBusy(true); setError("");
                  void deleteAIReferentLetter(token, selected).then(() => { setSelectedId(""); setDeleteConfirmation(""); void refresh(); })
                    .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Не удалось удалить письмо."))
                    .finally(() => { busyRef.current = false; setBusy(false); });
                }}>Подтвердить удаление</Button><Button disabled={busy} onClick={() => setDeleteConfirmation("")}>Не удалять</Button></section> : null}
                {confirmAction && selected.availableActions.includes(confirmAction) ? <div className="ai-referent-detail-card" role="group" aria-label="Подтверждение действия"><p>{confirmAction === "send" ? "Робот отправит письмо внешнему получателю. Подтверждаете?" : confirmAction === "prepare_replacement" ? "Применить замену без повторного согласования? Номер сохранится. Готовый PDF используется как есть — проверьте подпись и содержимое." : confirmAction === "replace_document" ? "Робот закроет подготовленное окно. Затем вы сможете заменить документ без повторного согласования." : confirmAction === "mark_sent" ? "Подтверждаете, что письмо уже отправлено вручную? Робот запишет результат без повторной отправки." : "Подтвердите изменение состояния письма."}</p><Button appearance="primary" disabled={busy} onClick={() => void act(selected, confirmAction)}>Подтвердить</Button><Button disabled={busy} onClick={() => setConfirmAction(undefined)}>Отмена</Button></div> : null}
              </DialogContent>
            </DialogBody>
          ) : null}
        </DialogSurface>
      </Dialog>
    </section>
  );
}
