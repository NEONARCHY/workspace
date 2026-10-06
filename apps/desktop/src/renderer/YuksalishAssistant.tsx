import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { ArrowUp, ArrowUpRight, CalendarDays, ChevronDown, FileText, FolderKanban, ListChecks, ListTodo, Maximize2, MessageCircle, Mic, Minimize2, Paperclip, PenLine, Plane, Plus, Reply, Square, Trash2, Upload, UserRound, X } from "lucide-react";

import type { AssistantActionDraft, AssistantChat, AssistantMessage, AssistantModel, AssistantReference } from "@yuksalish/contracts";
import { GradientOrb } from "@/components/ui/gradient-orb";
import { hasBlockingDialog, useBlockingDialog } from "@/components/ui/use-blocking-dialog";
import { ThinkingOrb } from "@/components/ui/thinking-orbs";
import { clearAssistantChat, createAssistantChat, listAssistantChats, loadAssistantMessages, sendAssistantMessage, transcribeAssistantVoice, type AssistantAttachmentInput } from "./workspace-api";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { isDraftContinuation, isFormOpenSignal } from "./assistant-form-handoff";

const modelOptions: readonly { value: AssistantModel; label: string; description: string }[] = [
  { value: "flash-lite", label: "Лёгкий", description: "Повседневные вопросы · экономный режим" },
  { value: "flash", label: "Рабочий", description: "Задачи, тексты и документы" },
  { value: "pro", label: "Фокус", description: "Более сложные вопросы" },
];

const MAX_COMPOSER_HEIGHT = 180;
const VOICE_LIMIT_MS = 60_000;
const REPLY_EXCERPT_LENGTH = 280;
const MAX_FILE_BYTES = 50_000_000;
const CHAT_SIDEBAR_MIN_WIDTH = 760;
const fileTypes: Record<string, AssistantAttachmentInput["mime_type"]> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function assistantViewport() {
  const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  return { width: window.innerWidth / zoom, height: window.innerHeight / zoom, zoom };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл. Выберите его повторно."));
    reader.onload = () => {
      if (typeof reader.result !== "string") return reject(new Error("Не удалось прочитать файл."));
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}
const quickPrompts = [
  { kind: "task", label: "Создать задачу", hint: "Название, исполнитель и срок", icon: ListTodo, prompt: "Создай задачу: " },
  { kind: "project", label: "Начать проект", hint: "Идея, команда и даты", icon: FolderKanban, prompt: "Создай проект: " },
  { kind: "trip", label: "Спланировать поездку", hint: "Куда, зачем и когда", icon: Plane, prompt: "Подготовь командировку: " },
  { kind: "absence", label: "Оформить отсутствие", hint: "Отгул, отпуск или больничный", icon: CalendarDays, prompt: "Подготовь заявку на отсутствие: " },
] as const;
const presets = [
  ...quickPrompts,
  { label: "Мои дела", icon: ListChecks, prompt: "Какие мои задачи и события сейчас требуют внимания?" },
  { label: "О сотруднике", icon: UserRound, prompt: "Расскажи о сотруднике [имя]: должность, стаж, достижения, награды и доступный показатель выполнения задач в срок." },
  { label: "Разобрать файл", icon: FileText, prompt: "Кратко перескажи приложенный файл, выдели главные факты и необходимые действия." },
  { label: "Подготовить текст", icon: PenLine, prompt: "Помоги написать ясный рабочий текст на тему: " },
] as const;

const actionLabels: Record<AssistantActionDraft["kind"], string> = {
  task: "Задача", project: "Проект", trip: "Поездка", absence: "Заявка на отсутствие",
  feed: "Публикация", message: "Сообщение сотруднику",
};
const fieldLabels: Record<string, string> = {
  title: "Название", description: "Описание", assignee: "Исполнитель", dueAt: "Срок",
  code: "Код проекта", purpose: "Цель", destination: "Направление", startDate: "Начало",
  endDate: "Окончание", reason: "Причина", absenceKind: "Вид отсутствия", recipient: "Получатель", body: "Текст",
  priority: "Приоритет", project: "Проект / направление", coAssignees: "Соисполнители",
  observers: "Наблюдатели", checklist: "Чек-лист", manager: "Руководитель",
  budget: "Бюджет", currency: "Валюта", accessStatus: "Доступ", responsibles: "Ответственные",
  approvers: "Согласующие по порядку", employees: "Участники поездки",
};
const fieldValueLabels: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  priority: { low: "Низкий", normal: "Обычный", high: "Высокий", urgent: "Срочный" },
  accessStatus: { open: "Открытый", closed: "Закрытый" },
};
const absenceLabels: Record<string, string> = {
  vacation: "Отпуск", personal_time: "Личное время / отгул", sick_leave: "Больничный",
  late_arrival: "Опоздание", business_event: "Мероприятие",
};

function useAssistantMotionDisabled() {
  const [disabled, setDisabled] = useState(() => Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    || window.matchMedia?.("(forced-colors: active)").matches,
  ));
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const forced = window.matchMedia?.("(forced-colors: active)");
    if (!reduced || !forced) return;
    const update = () => setDisabled(reduced.matches || forced.matches);
    reduced.addEventListener("change", update);
    forced.addEventListener("change", update);
    return () => { reduced.removeEventListener("change", update); forced.removeEventListener("change", update); };
  }, []);
  return disabled;
}

function GeneratedReply({ content, animate, reducedMotion }: {
  readonly content: string; readonly animate: boolean; readonly reducedMotion: boolean;
}) {
  const inline = (value: string) => value.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/g)
    .filter(Boolean).map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
      const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (link) return <span className="assistant-source" key={index} title={link[2]}>{link[1]} · {link[2]}</span>;
      return part;
    });
  return <div className="assistant-reply">{content.split("\n").map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return <div className="assistant-reply-spacer" key={index} />;
    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    const list = trimmed.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
    return <motion.p key={index} className={heading ? "is-heading" : list ? "is-list" : ""}
      initial={animate && !reducedMotion ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.18, delay: animate ? Math.min(index * 0.02, 0.12) : 0 }}>
      {list && <span className="assistant-list-marker" aria-hidden="true">•</span>}
      {inline(heading?.[1] ?? list?.[1] ?? trimmed)}
    </motion.p>;
  })}</div>;
}

export function YuksalishAssistant({ token, onOpenReference, onPrepareAction }: {
  readonly token: string;
  readonly onOpenReference?: (reference: AssistantReference) => void;
  readonly onPrepareAction?: (draft: AssistantActionDraft) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const blockingDialog = useBlockingDialog();
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<readonly AssistantMessage[]>([]);
  const [chats, setChats] = useState<readonly AssistantChat[]>([]);
  const [chatId, setChatId] = useState("");
  const [chatPickerOpen, setChatPickerOpen] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearError, setClearError] = useState("");
  const chatOperationRef = useRef(false);
  const chatDraftsRef = useRef(new Map<string, string>());
  const mountedRef = useRef(true);
  const [model, setModel] = useState<AssistantModel>("flash-lite");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState("");
  const [animatedReplyId, setAnimatedReplyId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<AssistantMessage | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [draggingFile, setDraggingFile] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string>();
  const [replyMenu, setReplyMenu] = useState<{ message: AssistantMessage; x: number; y: number } | null>(null);
  const [dismissedDraftId, setDismissedDraftId] = useState<string>();
  const [preparingAction, setPreparingAction] = useState(false);
  const [selectedActionKind, setSelectedActionKind] = useState<AssistantActionDraft["kind"]>();
  const preparingActionRef = useRef(false);
  const [viewport, setViewport] = useState(assistantViewport);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const chatPickerRef = useRef<HTMLDivElement>(null);
  const presetsToggleRef = useRef<HTMLButtonElement>(null);
  const replyMenuButtonRef = useRef<HTMLButtonElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const voiceTimerRef = useRef<number | null>(null);
  const dragDepthRef = useRef(0);
  const sizeFromRef = useRef<DOMRect | null>(null);
  const sizeAnimationRef = useRef<Animation | null>(null);
  const reducedMotion = useAssistantMotionDisabled();
  const close = useCallback(() => {
    if (voiceTimerRef.current !== null) window.clearTimeout(voiceTimerRef.current);
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.onstop = () => recorder.stream.getTracks().forEach((track) => track.stop());
      recorder.stop();
    }
    setRecording(false);
    setOpen(false);
    setReplyMenu(null);
    setChatPickerOpen(false);
    setPresetsOpen(false);
    setAnimatedReplyId(null);
    setDraggingFile(false);
    dragDepthRef.current = 0;
    sizeFromRef.current = null;
    sizeAnimationRef.current?.cancel();
  }, []);
  const resizeInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const maxHeight = Math.min(MAX_COMPOSER_HEIGHT, Math.max(72, viewport.height / 4));
    input.style.height = "0px";
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 48), maxHeight)}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [viewport.height]);

  useEffect(() => {
    const updateViewport = () => {
      const next = assistantViewport();
      setChatPickerOpen(false);
      setPresetsOpen(false);
      setViewport((current) => current.width === next.width && current.height === next.height
        && current.zoom === next.zoom ? current : next);
    };
    window.addEventListener("resize", updateViewport);
    const observer = new MutationObserver(updateViewport);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => { window.removeEventListener("resize", updateViewport); observer.disconnect(); };
  }, []);

  useLayoutEffect(resizeInput, [draft, resizeInput, expanded, viewport]);

  useLayoutEffect(() => {
    const from = sizeFromRef.current;
    sizeFromRef.current = null;
    const panel = panelRef.current;
    sizeAnimationRef.current?.cancel();
    if (!from || !panel || reducedMotion || !panel.animate) return;
    const to = panel.getBoundingClientRect();
    // Real bounds, not a scaled screenshot: text stays crisp and controls remain usable.
    const animation = panel.animate([
      { width: `${from.width / viewport.zoom}px`, height: `${from.height / viewport.zoom}px` },
      { width: `${to.width / viewport.zoom}px`, height: `${to.height / viewport.zoom}px` },
    ], { duration: 220, easing: "cubic-bezier(.2, 0, 0, 1)" });
    sizeAnimationRef.current = animation;
    return () => animation.cancel();
  }, [expanded, viewport, reducedMotion]);

  const acceptFiles = (files: readonly File[]) => {
    if (!files.length) return;
    if (busy || recording || transcribing || chatBusy) {
      setError("Дождитесь окончания ответа или голосового ввода, затем прикрепите файл.");
      return;
    }
    if (files.length > 1) {
      setError("Прикрепляйте по одному файлу на сообщение. Несколько файлов не были добавлены.");
      return;
    }
    const file = files[0]!;
    const suffix = file.name.split(".").at(-1)?.toLowerCase() ?? "";
    if (!fileTypes[suffix] || file.size > MAX_FILE_BYTES || file.size === 0 || file.name.length > 160) {
      setError("Выберите непустой DOCX, PDF, PNG, JPEG, WebP или TXT до 50 МБ с именем до 160 символов.");
      return;
    }
    setSelectedFile(file);
    setError("");
    inputRef.current?.focus();
  };

  const isFileDrag = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes("Files");

  useEffect(() => {
    mountedRef.current = true;
    const drafts = chatDraftsRef.current;
    return () => { mountedRef.current = false; drafts.clear(); };
  }, []);

  useEffect(() => {
    if (!open || loaded) return;
    let active = true;
    void listAssistantChats(token)
      .then(async (available) => {
        const selected = available[0];
        if (!selected) throw new Error("Чат не найден");
        const history = await loadAssistantMessages(token, selected.id);
        if (active) { setChats(available); setChatId(selected.id); setMessages(history); setLoaded(true); setError(""); }
      })
      .catch(() => { if (active) setError("Не удалось загрузить историю. Закройте и откройте ассистента ещё раз."); });
    return () => { active = false; };
  }, [open, loaded, token]);

  useEffect(() => {
    if (open && !blockingDialog) inputRef.current?.focus();
  }, [open, blockingDialog]);

  useLayoutEffect(() => {
    if (open && streamRef.current) streamRef.current.scrollTop = messages.length || busy || recording || transcribing
      ? streamRef.current.scrollHeight : 0;
  }, [messages, busy, open, recording, transcribing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        if (replyMenu) setReplyMenu(null);
        else if (chatPickerOpen) setChatPickerOpen(false);
        else if (presetsOpen) setPresetsOpen(false);
        else if (!confirmClear) close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, open, replyMenu, chatPickerOpen, presetsOpen, confirmClear]);

  const chatControlsDisabled = !loaded || busy || recording || transcribing || preparingAction || chatBusy || confirmClear;
  const changeChat = async (targetId?: string) => {
    setChatPickerOpen(false);
    setPresetsOpen(false);
    if (chatControlsDisabled || chatOperationRef.current) return;
    if (targetId === chatId) { inputRef.current?.focus(); return; }
    chatOperationRef.current = true;
    setChatBusy(true); setError("");
    try {
      const created = targetId ? null : await createAssistantChat(token);
      const nextId = targetId ?? created!.id;
      // A freshly created conversation is known to be empty; no second request can
      // leave an unreachable chat after a history-loading failure.
      const history = created ? [] : await loadAssistantMessages(token, nextId);
      if (!mountedRef.current) return;
      chatDraftsRef.current.set(chatId, draft);
      if (created) setChats((current) => [created, ...current]);
      setChatId(nextId); setMessages(history); setDraft(chatDraftsRef.current.get(nextId) ?? "");
      setSelectedFile(null); setReplyingTo(null); setReplyMenu(null);
      setEditingDraftId(undefined); setDismissedDraftId(undefined); setAnimatedReplyId(null);
      setSelectedActionKind(undefined);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (failure) {
      if (mountedRef.current) setError(failure instanceof Error ? failure.message : "Не удалось открыть чат.");
    } finally {
      chatOperationRef.current = false; setChatBusy(false); inputRef.current?.focus();
    }
  };

  const clearCurrentChat = async () => {
    if (chatOperationRef.current || !chatId) return;
    chatOperationRef.current = true; setChatBusy(true); setClearError("");
    try {
      await clearAssistantChat(token, chatId);
      if (!mountedRef.current) return;
      setMessages([]); setDraft(""); setSelectedFile(null); setReplyingTo(null); setReplyMenu(null);
      setEditingDraftId(undefined); setDismissedDraftId(undefined); setAnimatedReplyId(null);
      setSelectedActionKind(undefined);
      chatDraftsRef.current.delete(chatId);
      setChats((current) => current.map((chat) => chat.id === chatId
        ? { ...chat, title: chat.isDefault ? "Первый чат" : "Новый чат" } : chat));
      setConfirmClear(false); setError("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (failure) {
      if (mountedRef.current) setClearError(failure instanceof Error ? failure.message : "Не удалось очистить чат.");
    } finally { chatOperationRef.current = false; setChatBusy(false); }
  };

  useEffect(() => {
    if (!replyMenu) return;
    replyMenuButtonRef.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".assistant-context-menu")) setReplyMenu(null);
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [replyMenu]);

  useEffect(() => {
    if (!chatPickerOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !chatPickerRef.current?.contains(event.target)) setChatPickerOpen(false);
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [chatPickerOpen]);

  const openReplyMenu = (item: AssistantMessage, clientX: number, clientY: number) => {
    const bounds = panelRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setReplyMenu({ message: item,
      x: Math.max(8, Math.min(clientX - bounds.left, bounds.width - 156)),
      y: Math.max(8, Math.min(clientY - bounds.top, bounds.height - 58)) });
  };

  const onMessageContextMenu = (event: ReactMouseEvent<HTMLElement>, item: AssistantMessage) => {
    if (item.role !== "assistant") return;
    event.preventDefault();
    openReplyMenu(item, event.clientX, event.clientY);
  };

  const onMessageKeyDown = (event: ReactKeyboardEvent<HTMLElement>, item: AssistantMessage) => {
    if (item.role !== "assistant" || !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    openReplyMenu(item, bounds.left + 24, bounds.bottom - 8);
  };

  useEffect(() => () => {
    if (voiceTimerRef.current !== null) window.clearTimeout(voiceTimerRef.current);
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    recorder?.stream.getTracks().forEach((track) => track.stop());
  }, []);

  const stopRecording = () => {
    if (voiceTimerRef.current !== null) window.clearTimeout(voiceTimerRef.current);
    voiceTimerRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setRecording(false);
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined"
      || !MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
      setError("Голосовой ввод недоступен в этом браузере.");
      return;
    }
    setError("");
    let stream: MediaStream | null = null;
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream = audioStream;
      const recorder = new MediaRecorder(audioStream, { mimeType: "audio/webm;codecs=opus" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        audioStream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        if (!chunks.length) return;
        setTranscribing(true);
        void transcribeAssistantVoice(token, new Blob(chunks, { type: "audio/webm" }))
          .then(({ text }) => setDraft((current) => current ? `${current.trimEnd()} ${text}` : text))
          .catch((failure) => setError(failure instanceof Error ? failure.message : "Не удалось распознать речь."))
          .finally(() => { setTranscribing(false); inputRef.current?.focus(); });
      };
      recorderRef.current = recorder;
      recorder.start(250);
      setRecording(true);
      voiceTimerRef.current = window.setTimeout(stopRecording, VOICE_LIMIT_MS);
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      setError("Не удалось получить доступ к микрофону. Проверьте разрешение в системе.");
    }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if ((!value && !selectedFile) || busy || preparingActionRef.current || recording || transcribing || !loaded || chatBusy || confirmClear) return;
    const latestAnswer = [...messages].reverse().find((item) => item.role === "assistant");
    if (!selectedFile && !replyingTo && isFormOpenSignal(value)) {
      if (latestAnswer?.actionDraft?.ready && latestAnswer.id !== dismissedDraftId) {
        if (await openPreparedForm(latestAnswer.actionDraft)) setDraft("");
      } else setError("Сначала согласуйте данные черновика в чате. Готовую форму можно открыть по команде «Открывай форму».");
      return;
    }
    const quote = replyingTo?.content.replace(/\s+/g, " ").trim().slice(0, REPLY_EXCERPT_LENGTH);
    const prompt = value || "Расскажи, что находится во вложении.";
    const content = quote ? `↳ Ответ на сообщение ассистента: ${quote}\n\n${prompt}` : prompt;
    if (content.length > 4000) {
      setError("Сократите ответ: вместе с цитатой он должен быть не длиннее 4000 символов.");
      return;
    }
    const file = selectedFile;
    const continueDraft = Boolean(latestAnswer?.actionDraft && latestAnswer.id !== dismissedDraftId
      && (!latestAnswer.actionDraft.ready || editingDraftId === latestAnswer.id || isDraftContinuation(value)));
    const temporaryId = `pending-${Date.now()}`;
    setMessages((current) => [...current, {
      id: temporaryId, role: "user", model,
      content: file ? `${content}\n\n📎 ${file.name}` : content,
      createdAt: new Date().toISOString(),
    }]);
    setDraft("");
    setSelectedFile(null);
    setBusy(true);
    setError("");
    try {
      const suffix = file?.name.split(".").at(-1)?.toLowerCase() ?? "";
      const mimeType = fileTypes[suffix];
      if (file && !mimeType) throw new Error("Неподдерживаемый формат вложения.");
      const attachment: AssistantAttachmentInput | undefined = file && mimeType ? {
        name: file.name, mime_type: mimeType, data_base64: await readFileAsBase64(file),
      } : undefined;
      const response = selectedActionKind
        ? await sendAssistantMessage(token, model, content, attachment, continueDraft, chatId, selectedActionKind)
        : await sendAssistantMessage(token, model, content, attachment, continueDraft, chatId);
      if (!mountedRef.current) return;
      setMessages((current) => [...current, response]);
      setChats((current) => current.map((chat) => chat.id === chatId ? {
        ...chat, updatedAt: response.createdAt,
        title: ["Первый чат", "Новый чат"].includes(chat.title) ? content.slice(0, 100) : chat.title,
      } : chat));
      setAnimatedReplyId(response.id);
      setDismissedDraftId(undefined);
      setEditingDraftId(undefined);
      setReplyingTo(null);
      setSelectedActionKind(undefined);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (failure) {
      if (!mountedRef.current) return;
      setMessages((current) => current.filter((item) => item.id !== temporaryId));
      setDraft((current) => current ? `${value}\n${current}` : value);
      setSelectedFile(file);
      setError(failure instanceof Error ? failure.message : "Не удалось получить ответ. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const chosen = modelOptions.find((option) => option.value === model)!;
  const currentAnswer = [...messages].reverse().find((item) => item.role === "assistant");
  const currentActionId = currentAnswer?.id;
  const activeDraft = currentAnswer?.actionDraft && currentAnswer.id !== dismissedDraftId
    && (!currentAnswer.actionDraft.ready || editingDraftId === currentAnswer.id) ? currentAnswer : undefined;
  const openPreparedForm = async (action: AssistantActionDraft) => {
    if (preparingActionRef.current) return false;
    if (!onPrepareAction) {
      setError("Это только визуальный предпросмотр. Для открытия рабочей формы войдите в Workspace.");
      return false;
    }
    preparingActionRef.current = true;
    setPreparingAction(true);
    setError("");
    try {
      await onPrepareAction(action);
      if (!mountedRef.current) return false;
      setOpen(false);
      setPresetsOpen(false);
      setSelectedActionKind(undefined);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не удалось открыть форму.");
      return false;
    } finally {
      setPreparingAction(false);
      preparingActionRef.current = false;
    }
  };
  const thinkingState = /юксалиш|yuksalish|источ|найди|поиск/i.test(messages.at(-1)?.content ?? "")
    ? "searching" : /задач|проект|заявк|анализ/i.test(messages.at(-1)?.content ?? "")
      ? "solving" : "composing";
  const compact = viewport.width <= 600;
  const showChatSidebar = expanded && viewport.width > CHAT_SIDEBAR_MIN_WIDTH;
  const currentChat = chats.find((chat) => chat.id === chatId);
  const edge = compact ? 8 : expanded ? 12 : 18;
  const panelWidth = expanded || compact ? viewport.width - edge * 2 : Math.min(460, viewport.width - 36);
  const panelHeight = expanded || compact ? viewport.height - edge * 2 : Math.min(670, viewport.height - 36);
  return <div className="yuksalish-assistant-root" data-blocking-dialog={blockingDialog || undefined}>
    <button type="button" className="assistant-launcher" ref={launcherRef}
      aria-label="Открыть ассистента Yuksalish" title="Ассистент Yuksalish"
      aria-expanded={open} disabled={blockingDialog} onClick={() => open ? close() : setOpen(true)}>
      <GradientOrb paused={open || blockingDialog} />
    </button>
    <AnimatePresence onExitComplete={() => {
      if (!hasBlockingDialog()) launcherRef.current?.focus({ preventScroll: true });
    }}>
      {open && <motion.section
        initial={reducedMotion ? false : { opacity: 0, transform: "translateY(12px)" }}
        animate={{ opacity: 1, transform: "translateY(0px)" }}
        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px)" }}
        transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.2, 0, 0, 1] }}
        style={{ width: panelWidth, height: panelHeight, right: edge, bottom: edge,
          borderRadius: expanded ? 22 : 26 }}
        ref={panelRef}
        onDragEnter={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault(); dragDepthRef.current += 1; setDraggingFile(true);
        }}
        onDragOver={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault(); event.dataTransfer.dropEffect = busy || recording || transcribing ? "none" : "copy";
        }}
        onDragLeave={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault(); dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDraggingFile(false);
        }}
        onDrop={(event) => {
          if (!isFileDrag(event) && !event.dataTransfer.files.length) return;
          event.preventDefault(); event.stopPropagation(); dragDepthRef.current = 0; setDraggingFile(false);
          acceptFiles(Array.from(event.dataTransfer.files));
        }}
        className={`assistant-panel ${expanded ? "is-expanded" : ""} ${showChatSidebar ? "has-sidebar" : ""}`}
        role="dialog" aria-modal="false" aria-label="Ассистент Yuksalish">
        <div className="assistant-panel-content">
        <header className="assistant-header">
          <span className="assistant-header-icon"><GradientOrb paused={blockingDialog} /></span>
          <span className="assistant-header-title"><strong>Ассистент Yuksalish</strong><small>Ваши дела и любые вопросы</small></span>
          <button type="button" aria-label={expanded ? "Свернуть окно" : "Развернуть окно"}
            title={expanded ? "Свернуть окно" : "Развернуть окно"}
            onClick={() => { setChatPickerOpen(false); setPresetsOpen(false); sizeFromRef.current = panelRef.current?.getBoundingClientRect() ?? null; setExpanded((current) => !current); }}>
            {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button type="button" aria-label="Закрыть ассистента" title="Закрыть"
            onClick={close}><X size={19} /></button>
        </header>
        {showChatSidebar && <aside className="assistant-chat-sidebar" aria-label="Чаты ассистента">
          <div className="assistant-sidebar-heading"><span>Ваши чаты</span><strong>{chats.length}</strong></div>
          <button type="button" className="assistant-sidebar-new" disabled={chatControlsDisabled}
            onClick={() => void changeChat()}><Plus size={17} aria-hidden="true" /> Новый чат</button>
          <nav className="assistant-sidebar-list" aria-label="Список чатов ассистента">
            {chats.map((chat) => <button type="button" key={chat.id} className="assistant-sidebar-chat"
              aria-current={chat.id === chatId ? "true" : undefined} disabled={chatControlsDisabled}
              onClick={() => void changeChat(chat.id)}>
              {chat.id === chatId && <motion.span className="assistant-sidebar-active" layoutId="assistant-sidebar-active"
                transition={{ duration: reducedMotion ? 0 : .26, ease: [0.2, 0, 0, 1] }} aria-hidden="true" />}
              <MessageCircle size={18} aria-hidden="true" />
              <span><strong title={chat.title}>{chat.title}</strong><small>{chat.isDefault ? "Основной чат" : "Диалог"}</small></span>
            </button>)}
          </nav>
        </aside>}
        <nav className="assistant-chat-controls" aria-label="Чаты ассистента">
          <span className="assistant-current-chat"><MessageCircle size={18} aria-hidden="true" />
            <span><strong title={currentChat?.title}>{currentChat?.title ?? "Новый чат"}</strong>
              <small>Рабочий диалог</small></span></span>
          <div className="assistant-chat-picker" ref={chatPickerRef}>
            <button type="button" role="combobox" aria-label="Чат ассистента" aria-expanded={chatPickerOpen}
              aria-controls="assistant-chat-options" aria-haspopup="listbox" data-chat-id={chatId}
              disabled={chatControlsDisabled} onClick={() => setChatPickerOpen((current) => !current)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                event.preventDefault(); setChatPickerOpen(true);
                requestAnimationFrame(() => chatPickerRef.current?.querySelector<HTMLButtonElement>("[role='option']")?.focus());
              }}>
              <MessageCircle size={17} aria-hidden="true" />
              <span>{currentChat?.title ?? "Загрузка чатов…"}</span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            <AnimatePresence>{chatPickerOpen && <motion.div id="assistant-chat-options" role="listbox"
              aria-label="Чаты ассистента" className="assistant-chat-options"
              initial={reducedMotion ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={{ duration: reducedMotion ? 0 : .17, ease: [0.2, 0, 0, 1] }}>
              {chats.map((chat) => <button type="button" role="option" tabIndex={-1} aria-selected={chat.id === chatId}
                key={chat.id} onClick={() => void changeChat(chat.id)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setChatPickerOpen(false); chatPickerRef.current?.querySelector<HTMLElement>("[role='combobox']")?.focus(); }
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                  event.preventDefault();
                  const items = Array.from(chatPickerRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []);
                  items[(items.indexOf(event.currentTarget) + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
                }}><MessageCircle size={16} aria-hidden="true" /><span>{chat.title}</span></button>)}
            </motion.div>}</AnimatePresence>
          </div>
          <button type="button" className="assistant-chat-new" disabled={chatControlsDisabled} onClick={() => void changeChat()}>
            <Plus size={16} aria-hidden="true" /> Новый чат
          </button>
          <button type="button" aria-label="Очистить текущий чат" title="Очистить текущий чат"
            disabled={chatControlsDisabled || !messages.length}
            onClick={() => { setClearError(""); setConfirmClear(true); }}><Trash2 size={16} /></button>
        </nav>
        {chatBusy && <span className="assistant-chat-status" role="status">Обновляю чат…</span>}
        <div className={`assistant-stream ${messages.length === 0 && loaded ? "is-empty" : ""}`}
        ref={streamRef} aria-live="polite" inert={chatBusy || confirmClear}>
          <div className="assistant-stream-inner">
            {messages.length === 0 && loaded && !busy && <div className="assistant-empty">
              <GradientOrb className="assistant-empty-orb" paused={blockingDialog} />
              <h2>С чего начнём?</h2>
              <p>Подготовим рабочие записи, разберём документ или просто обсудим ваш вопрос.</p>
              <div className="assistant-quick-prompts">{quickPrompts.map((prompt) =>
                <button key={prompt.label} type="button" onClick={() => { setSelectedActionKind(prompt.kind); setDraft(prompt.prompt); setDismissedDraftId(currentActionId); inputRef.current?.focus(); }}>
                  <prompt.icon size={19} aria-hidden="true" /><span><strong>{prompt.label}</strong><small>{prompt.hint}</small></span>
                </button>)}</div>
              <small>Я подготовлю форму. Проверка и окончательное создание — за вами.</small>
            </div>}
            {!loaded && !error && <div className="assistant-loading"><ThinkingOrb state="searching" /> Загружаю историю…</div>}
            {messages.map((item) => <article key={item.id} className={`assistant-message is-${item.role}`}
              tabIndex={item.role === "assistant" ? 0 : undefined}
              onContextMenu={(event) => onMessageContextMenu(event, item)}
              onKeyDown={(event) => onMessageKeyDown(event, item)}>
              <div className="assistant-message-meta"><span>{item.role === "user" ? "Вы" : "Yuksalish"}</span>
                <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</time></div>
              {item.role === "assistant" ? <>
                <GeneratedReply content={item.content} animate={item.id === animatedReplyId} reducedMotion={reducedMotion} />
                {item.references?.length ? <div className="assistant-references" aria-label="Открыть записи в Workspace">
                  {item.references.map((reference, index) => <button type="button"
                    key={`${reference.section}:${reference.entityId ?? "list"}:${index}`}
                    onClick={() => onOpenReference?.(reference)} disabled={!onOpenReference}
                    title={`Открыть в Workspace: ${reference.label}`}>
                    <span>{reference.label}</span><ArrowUpRight size={14} aria-hidden="true" />
                  </button>)}
                </div> : null}
                {item.actionDraft && item.id === currentActionId && item.id !== dismissedDraftId ? <div className="assistant-action-draft">
                  <div className="assistant-draft-heading"><strong>{actionLabels[item.actionDraft.kind]}</strong>
                    <span>{item.actionDraft.ready ? "Черновик готов" : "Уточняем детали"}</span></div>
                  <dl>{Object.entries(item.actionDraft.fields).filter(([key, value]) => fieldLabels[key] && value).map(([key, value]) =>
                    <div key={key}><dt>{fieldLabels[key]}</dt><dd>{key === "absenceKind" ? absenceLabels[value] ?? value : fieldValueLabels[key]?.[value] ?? value}</dd></div>)}</dl>
                  <small>Запись ещё не создана. Проверьте данные в форме.</small>
                  <div className="assistant-draft-actions">
                  {item.actionDraft.ready ? <button type="button" disabled={!onPrepareAction || preparingAction}
                    onClick={() => { if (item.actionDraft) void openPreparedForm(item.actionDraft); }}>
                    {preparingAction ? "Открываю…" : "Открыть заполненную форму"}
                  </button> : null}
                  {item.actionDraft.ready && <button type="button" className="assistant-action-cancel"
                    onClick={() => { setEditingDraftId(item.id); inputRef.current?.focus(); }}>Уточнить черновик</button>}
                  <button type="button" className="assistant-action-cancel"
                    onClick={() => setDismissedDraftId(item.id)}>Отменить подготовку</button>
                  </div>
                </div> : null}
              </> : item.content.startsWith("↳ Ответ на сообщение ассистента: ") && item.content.includes("\n\n")
                ? <p><span className="assistant-message-quote">{item.content.split("\n\n", 1)[0]}</span>{item.content.slice(item.content.indexOf("\n\n") + 2)}</p>
                : <p>{item.content}</p>}
            </article>)}
            {busy && <div className="assistant-working"><ThinkingOrb state={thinkingState} />
              <span>{thinkingState === "searching" ? "Ищу источники…"
                : thinkingState === "solving" ? "Разбираюсь в деталях…" : "Готовлю ответ…"}</span>
            </div>}
            {(recording || transcribing) && <div className="assistant-working assistant-voice-status" role="status">
              <ThinkingOrb state="listening" size={20} />
              <span>{recording ? "Слушаю… нажмите квадрат, чтобы закончить" : "Перевожу речь в текст…"}</span>
            </div>}
          </div>
        </div>
        <div className="assistant-composer-area">
          <div className="assistant-composer-inner">
            <div className="assistant-presets">
              <Popover open={presetsOpen} onOpenChange={(_, data) => setPresetsOpen(data.open)}
                positioning={{ position: "above", align: "start", offset: 8 }} mountNode={panelRef.current}>
              <PopoverTrigger disableButtonEnhancement>
              <button ref={presetsToggleRef} type="button" className="assistant-presets-toggle" aria-expanded={presetsOpen}
                aria-controls="assistant-presets-list" disabled={chatBusy || confirmClear}>
                Быстрые действия <ChevronDown size={14} aria-hidden="true" />
              </button>
              </PopoverTrigger>
              <PopoverSurface role="group" aria-label="Быстрые действия" className="assistant-presets-surface"
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault(); event.stopPropagation(); setPresetsOpen(false); presetsToggleRef.current?.focus();
                }}
                style={{ width: Math.min(800, Math.max(240, panelWidth - (showChatSidebar ? 258 : 0) - 36)) }}>
              <div id="assistant-presets-list" className="assistant-presets-list">
                {presets.map((preset) => <button key={preset.label} type="button" disabled={chatBusy || confirmClear}
                  onClick={() => { setSelectedActionKind("kind" in preset ? preset.kind : undefined); setDraft(preset.prompt); setDismissedDraftId(currentActionId); setPresetsOpen(false); inputRef.current?.focus(); }}>
                  <span className="assistant-preset-icon"><preset.icon size={17} aria-hidden="true" /></span><span>{preset.label}</span>
                </button>)}
              </div>
              </PopoverSurface>
              </Popover>
            </div>
            <form className="assistant-composer" onSubmit={(event) => void send(event)}>
              {selectedActionKind && <div className="assistant-draft-context" role="status">
                <span>Подготовка: {actionLabels[selectedActionKind]}. Обсудим детали, затем откроем форму.</span>
                <button type="button" aria-label="Отменить выбранное действие" onClick={() => setSelectedActionKind(undefined)}><X size={15} /></button>
              </div>}
              {activeDraft?.actionDraft && <div className="assistant-draft-context">
                <span>Уточняем: {actionLabels[activeDraft.actionDraft.kind].toLocaleLowerCase("ru-RU")}</span>
                <button type="button" aria-label="Завершить уточнение черновика" onClick={() => setDismissedDraftId(activeDraft.id)}><X size={15} /></button>
              </div>}
              {replyingTo && <div className="assistant-reply-target"><Reply size={16} aria-hidden="true" />
                <span><strong>Ответ на сообщение Yuksalish</strong><small>{replyingTo.content.replace(/\s+/g, " ").slice(0, REPLY_EXCERPT_LENGTH)}</small></span>
                <button type="button" aria-label="Отменить ответ" onClick={() => setReplyingTo(null)}><X size={16} /></button>
              </div>}
              {selectedFile && <div className="assistant-file-chip"><Paperclip size={15} aria-hidden="true" />
                <span title={selectedFile.name}>{selectedFile.name}</span>
                <button type="button" aria-label="Убрать вложение" disabled={busy}
                  onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                  <X size={15} />
                </button>
              </div>}
              <textarea ref={inputRef} className="assistant-editor" aria-label="Сообщение ассистенту" placeholder="Задайте вопрос или опишите, что нужно сделать…"
                value={draft} disabled={chatBusy || confirmClear} maxLength={4000} onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.files);
                  if (!files.length) return;
                  event.preventDefault(); acceptFiles(files);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault(); event.currentTarget.form?.requestSubmit();
                  }
                }} />
              <div className="assistant-composer-toolbar">
                <div className="assistant-model-control">
                  <label className="assistant-model-label" htmlFor="assistant-model">Режим</label>
                  <select id="assistant-model" value={model} disabled={busy}
                    title={chosen.description}
                    onChange={(event) => setModel(event.target.value as AssistantModel)}>
                    {modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div className="assistant-composer-actions">
                  <input ref={fileInputRef} type="file" className="assistant-file-input" tabIndex={-1}
                    accept=".docx,.pdf,.png,.jpg,.jpeg,.webp,.txt" aria-label="Выбрать вложение"
                    onChange={(event) => {
                      acceptFiles(Array.from(event.target.files ?? []));
                      event.target.value = "";
                    }} />
                  <button type="button" className="assistant-attach-button" aria-label="Прикрепить файл"
                    title="DOCX, PDF, PNG, JPEG, WebP или TXT · до 50 МБ; TXT и текст DOCX — до 50 000 символов. Файл не сохраняется в истории"
                    disabled={busy || recording || transcribing || chatBusy || confirmClear} onClick={() => fileInputRef.current?.click()}>
                    <Paperclip size={18} />
                  </button>
                  <button type="button" className={`assistant-voice-button${recording ? " is-recording" : ""}`}
                    aria-label={recording ? "Остановить запись" : "Голосовой ввод"}
                    title={recording ? "Остановить запись" : "Голосовой ввод · до 1 минуты; аудио передаётся ИИ для расшифровки"}
                    disabled={transcribing || busy || chatBusy || confirmClear || !loaded} onClick={() => void (recording ? stopRecording() : startRecording())}>
                    {recording ? <Square size={16} /> : <Mic size={19} />}
                  </button>
                  <button type="submit" className="assistant-send-button" aria-label="Отправить сообщение"
                    disabled={busy || recording || transcribing || chatBusy || confirmClear || (!draft.trim() && !selectedFile) || !loaded}>
                    <ArrowUp size={19} strokeWidth={2.4} />
                  </button>
                </div>
              </div>
            </form>
            {error && <p className="assistant-error" role="alert">{error}</p>}
            {selectedFile && <small className="assistant-attachment-notice">Файл используется только для этого запроса и не сохраняется на сервере. TXT и текст DOCX — до 50 000 символов.</small>}
            <small className="assistant-privacy">ИИ может допускать ошибки, перепроверяйте ответы</small>
          </div>
        </div>
        </div>
        <AnimatePresence>{draggingFile && <motion.div className="assistant-drop-overlay" role="status"
          initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.16 }}>
          <Upload size={32} aria-hidden="true" /><strong>Отпустите файл здесь</strong>
          <span>DOCX, PDF, PNG, JPEG, WebP или TXT · один файл до 50 МБ</span>
          <small>Добавится к сообщению — отправка только по вашему нажатию.</small>
        </motion.div>}</AnimatePresence>
        {replyMenu && <div className="assistant-context-menu" role="menu" aria-label="Действия с ответом" style={{ left: replyMenu.x, top: replyMenu.y }}>
          <button ref={replyMenuButtonRef} type="button" role="menuitem" onClick={() => {
            setReplyingTo(replyMenu.message); setReplyMenu(null); inputRef.current?.focus();
          }}><Reply size={16} aria-hidden="true" /> Ответить</button>
        </div>}
      </motion.section>}
    </AnimatePresence>
    <ConfirmActionDialog open={confirmClear} title="Очистить текущий чат?"
      message={clearError || "Переписка этого чата будет удалена без восстановления. Остальные чаты сохранятся."}
      confirmLabel="Очистить чат" busyLabel="Очищаем…" busy={chatBusy}
      onCancel={() => setConfirmClear(false)} onConfirm={clearCurrentChat} />
  </div>;
}
