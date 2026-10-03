import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp, ArrowUpRight, Maximize2, Mic, Minimize2, Paperclip, Reply, Square, X } from "lucide-react";

import type { AssistantActionDraft, AssistantMessage, AssistantModel, AssistantReference } from "@yuksalish/contracts";
import { GradientOrb } from "@/components/ui/gradient-orb";
import { hasBlockingDialog, useBlockingDialog } from "@/components/ui/use-blocking-dialog";
import { ThinkingOrb } from "@/components/ui/thinking-orbs";
import { loadAssistantMessages, sendAssistantMessage, transcribeAssistantVoice, type AssistantAttachmentInput } from "./workspace-api";

const modelOptions: readonly { value: AssistantModel; label: string; description: string }[] = [
  { value: "flash-lite", label: "Лёгкий", description: "Повседневные вопросы · экономный режим" },
  { value: "flash", label: "Рабочий", description: "Задачи, тексты и документы" },
  { value: "pro", label: "Фокус", description: "Более сложные вопросы" },
];

const MAX_COMPOSER_HEIGHT = 180;
const VOICE_LIMIT_MS = 60_000;
const REPLY_EXCERPT_LENGTH = 280;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const fileTypes: Record<string, AssistantAttachmentInput["mime_type"]> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

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
  "Что нового у меня за последнее время?",
  "Какие мои задачи требуют внимания?",
  "Расскажи о проектах движения «Юксалиш»",
] as const;
const presets = [
  { label: "Мои дела", prompt: "Какие мои задачи и события сейчас требуют внимания?" },
  { label: "О сотруднике", prompt: "Расскажи о сотруднике [имя]: должность, стаж, достижения, награды и доступный показатель выполнения задач в срок." },
  { label: "Разобрать файл", prompt: "Кратко перескажи приложенный файл, выдели главные факты и необходимые действия." },
  { label: "Подготовить текст", prompt: "Помоги написать ясный рабочий текст на тему: " },
] as const;

function GeneratedReply({ content, animate }: { readonly content: string; readonly animate: boolean }) {
  const reducedMotion = useReducedMotion();
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
      initial={animate && !reducedMotion ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.22, delay: animate ? Math.min(index * 0.055, 0.6) : 0 }}>
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
  const [replyMenu, setReplyMenu] = useState<{ message: AssistantMessage; x: number; y: number } | null>(null);
  const [dismissedDraftId, setDismissedDraftId] = useState<string>();
  const [preparingAction, setPreparingAction] = useState(false);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const replyMenuButtonRef = useRef<HTMLButtonElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const voiceTimerRef = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();
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
    setAnimatedReplyId(null);
  }, []);
  const resizeInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 30), MAX_COMPOSER_HEIGHT)}px`;
    input.style.overflowY = input.scrollHeight > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useLayoutEffect(resizeInput, [draft, resizeInput]);

  useEffect(() => {
    if (!open || loaded) return;
    let active = true;
    void loadAssistantMessages(token)
      .then((history) => { if (active) { setMessages(history); setLoaded(true); } })
      .catch(() => { if (active) setError("Не удалось загрузить историю. Закройте и откройте ассистента ещё раз."); });
    return () => { active = false; };
  }, [open, loaded, token]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useLayoutEffect(() => {
    if (open && streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [messages, busy, open, recording, transcribing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (replyMenu) setReplyMenu(null);
        else close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, open, replyMenu]);

  useEffect(() => {
    if (!replyMenu) return;
    replyMenuButtonRef.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".assistant-context-menu")) setReplyMenu(null);
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [replyMenu]);

  const openReplyMenu = (item: AssistantMessage, clientX: number, clientY: number) => {
    const bounds = panelRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setReplyMenu({ message: item,
      x: Math.max(8, Math.min(clientX - bounds.left, bounds.width - 130)),
      y: Math.max(8, Math.min(clientY - bounds.top, bounds.height - 48)) });
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
    if ((!value && !selectedFile) || busy) return;
    const quote = replyingTo?.content.replace(/\s+/g, " ").trim().slice(0, REPLY_EXCERPT_LENGTH);
    const prompt = value || "Расскажи, что находится во вложении.";
    const content = quote ? `↳ Ответ на сообщение ассистента: ${quote}\n\n${prompt}` : prompt;
    if (content.length > 4000) {
      setError("Сократите ответ: вместе с цитатой он должен быть не длиннее 4000 символов.");
      return;
    }
    const file = selectedFile;
    const latestAnswer = [...messages].reverse().find((item) => item.role === "assistant");
    const continueDraft = Boolean(latestAnswer?.actionDraft && latestAnswer.id !== dismissedDraftId);
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
      const response = await sendAssistantMessage(token, model, content, attachment, continueDraft);
      setMessages((current) => [...current, response]);
      setAnimatedReplyId(response.id);
      setDismissedDraftId(undefined);
      setReplyingTo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (failure) {
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
  const currentActionId = [...messages].reverse().find((item) => item.role === "assistant")?.id;
  const openPreparedForm = async (action: AssistantActionDraft) => {
    if (!onPrepareAction || preparingAction) return;
    setPreparingAction(true);
    setError("");
    try {
      await onPrepareAction(action);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не удалось открыть форму.");
    } finally {
      setPreparingAction(false);
    }
  };
  const thinkingState = /юксалиш|yuksalish|источ|найди|поиск/i.test(messages.at(-1)?.content ?? "")
    ? "searching" : /задач|проект|заявк|анализ/i.test(messages.at(-1)?.content ?? "")
      ? "solving" : "composing";
  const compact = viewport.width <= 600;
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
        initial={reducedMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.2, 0, 0, 1] }}
        style={{ width: panelWidth, height: panelHeight, right: edge, bottom: edge,
          borderRadius: expanded ? 22 : 26 }}
        ref={panelRef}
        className={`assistant-panel ${expanded ? "is-expanded" : ""}`}
        role="dialog" aria-modal="false" aria-label="Ассистент Yuksalish">
        <motion.div className="assistant-panel-content"
          initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }}
          exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.18,
            delay: reducedMotion ? 0 : 0.15 }}>
        <header className="assistant-header">
          <span className="assistant-header-icon"><GradientOrb paused={blockingDialog} /></span>
          <span className="assistant-header-title"><strong>Ассистент Yuksalish</strong><small>Рабочие вопросы и тексты</small></span>
          <button type="button" aria-label={expanded ? "Свернуть окно" : "Развернуть окно"}
            title={expanded ? "Свернуть окно" : "Развернуть окно"}
            onClick={() => setExpanded((current) => !current)}>
            {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button type="button" aria-label="Закрыть ассистента" title="Закрыть"
            onClick={close}><X size={19} /></button>
        </header>
        <div className={`assistant-stream ${messages.length === 0 && loaded ? "is-empty" : ""}`}
        ref={streamRef} aria-live="polite">
          <div className="assistant-stream-inner">
            {messages.length === 0 && loaded && !busy && <div className="assistant-empty">
              <GradientOrb paused={blockingDialog} />
              <h2>С чего начнём?</h2>
              <p>Помогу разобраться в рабочих делах, найти сведения о движении или улучшить текст.</p>
              <div className="assistant-quick-prompts">{quickPrompts.map((prompt) =>
                <button key={prompt} type="button" onClick={() => { setDraft(prompt); inputRef.current?.focus(); }}>
                  {prompt}
                </button>)}</div>
              <small>Рабочие данные — только в пределах ваших прав. Публичные материалы — с указанием источника.</small>
            </div>}
            {!loaded && !error && <div className="assistant-loading"><ThinkingOrb state="searching" /> Загружаю историю…</div>}
            {messages.map((item) => <article key={item.id} className={`assistant-message is-${item.role}`}
              tabIndex={item.role === "assistant" ? 0 : undefined}
              onContextMenu={(event) => onMessageContextMenu(event, item)}
              onKeyDown={(event) => onMessageKeyDown(event, item)}>
              <div className="assistant-message-meta"><span>{item.role === "user" ? "Вы" : "Yuksalish"}</span>
                <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</time></div>
              {item.role === "assistant" ? <>
                <GeneratedReply content={item.content} animate={item.id === animatedReplyId} />
                {item.references?.length ? <div className="assistant-references" aria-label="Открыть записи в Workspace">
                  {item.references.map((reference, index) => <button type="button"
                    key={`${reference.section}:${reference.entityId ?? "list"}:${index}`}
                    onClick={() => onOpenReference?.(reference)} disabled={!onOpenReference}
                    title={`Открыть в Workspace: ${reference.label}`}>
                    <span>{reference.label}</span><ArrowUpRight size={14} aria-hidden="true" />
                  </button>)}
                </div> : null}
                {item.actionDraft && item.id === currentActionId && item.id !== dismissedDraftId ? <div className="assistant-action-draft">
                  {item.actionDraft.ready ? <button type="button" disabled={!onPrepareAction || preparingAction}
                    onClick={() => { if (item.actionDraft) void openPreparedForm(item.actionDraft); }}>
                    {preparingAction ? "Открываю…" : "Открыть заполненную форму"}
                  </button> : null}
                  <button type="button" className="assistant-action-cancel"
                    onClick={() => setDismissedDraftId(item.id)}>Отменить подготовку</button>
                </div> : null}
                <details className="assistant-answer-context">
                  <summary>Как подготовлен ответ</summary>
                  <p>Это перечень проверенных источников, а не скрытые рассуждения модели.</p>
                  {item.sourceLabels === undefined
                    ? <p>Для этого старого ответа сведения об источниках не сохранены.</p>
                    : item.sourceLabels.length
                      ? <ul>{item.sourceLabels.map((label, index) => <li key={`${label}-${index}`}>{label}</li>)}</ul>
                      : <p>Ответ подготовлен без дополнительного рабочего контекста.</p>}
                </details>
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
              <button type="button" className="assistant-presets-toggle" aria-expanded={presetsOpen}
                aria-controls="assistant-presets-list" onClick={() => setPresetsOpen((current) => !current)}>
                Шаблоны запросов <span aria-hidden="true">{presetsOpen ? "−" : "+"}</span>
              </button>
              {presetsOpen && <div id="assistant-presets-list" className="assistant-presets-list">
                {presets.map((preset) => <button key={preset.label} type="button"
                  onClick={() => { setDraft(preset.prompt); setPresetsOpen(false); inputRef.current?.focus(); }}>
                  {preset.label}
                </button>)}
              </div>}
            </div>
            <form className="assistant-composer" onSubmit={(event) => void send(event)}>
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
              <textarea ref={inputRef} aria-label="Сообщение ассистенту" placeholder="Спросите о работе или движении «Юксалиш»…"
                value={draft} maxLength={4000} onChange={(event) => setDraft(event.target.value)}
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
                <span className="assistant-model-description">{chosen.description}</span>
                <div className="assistant-composer-actions">
                  <input ref={fileInputRef} type="file" className="assistant-file-input" tabIndex={-1}
                    accept=".docx,.pdf,.png,.jpg,.jpeg,.webp,.txt" aria-label="Выбрать вложение"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const suffix = file.name.split(".").at(-1)?.toLowerCase() ?? "";
                      if (!fileTypes[suffix] || file.size > MAX_FILE_BYTES || file.size === 0
                        || file.name.length > 160) {
                        setError("Выберите DOCX, PDF, изображение или TXT размером до 5 МБ.");
                        event.target.value = "";
                        return;
                      }
                      setSelectedFile(file); setError("");
                    }} />
                  <button type="button" className="assistant-attach-button" aria-label="Прикрепить файл"
                    title="DOCX, PDF, PNG, JPEG, WebP или TXT · до 5 МБ; файл передаётся ИИ, но не хранится в истории"
                    disabled={busy || recording} onClick={() => fileInputRef.current?.click()}>
                    <Paperclip size={18} />
                  </button>
                  <button type="button" className={`assistant-voice-button${recording ? " is-recording" : ""}`}
                    aria-label={recording ? "Остановить запись" : "Голосовой ввод"}
                    title={recording ? "Остановить запись" : "Голосовой ввод · до 1 минуты; аудио передаётся ИИ для расшифровки"}
                    disabled={transcribing || busy} onClick={() => void (recording ? stopRecording() : startRecording())}>
                    {recording ? <Square size={16} /> : <Mic size={19} />}
                  </button>
                  <button type="submit" className="assistant-send-button" aria-label="Отправить сообщение"
                    disabled={busy || recording || transcribing || (!draft.trim() && !selectedFile) || !loaded}>
                    <ArrowUp size={19} strokeWidth={2.4} />
                  </button>
                </div>
              </div>
            </form>
            {error && <p className="assistant-error" role="alert">{error}</p>}
            <small className="assistant-privacy">Проверяйте важные сведения и даты публикаций.</small>
          </div>
        </div>
        </motion.div>
        {replyMenu && <div className="assistant-context-menu" role="menu" style={{ left: replyMenu.x, top: replyMenu.y }}>
          <button ref={replyMenuButtonRef} type="button" role="menuitem" onClick={() => {
            setReplyingTo(replyMenu.message); setReplyMenu(null); inputRef.current?.focus();
          }}><Reply size={16} aria-hidden="true" /> Ответить</button>
        </div>}
      </motion.section>}
    </AnimatePresence>
  </div>;
}
