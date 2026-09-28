import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp, Maximize2, Mic, Minimize2, Square, X } from "lucide-react";

import type { AssistantMessage, AssistantModel } from "@yuksalish/contracts";
import { BorderBeam } from "@/components/ui/border-beam";
import { GradientOrb } from "@/components/ui/gradient-orb";
import { ThinkingOrb } from "@/components/ui/thinking-orbs";
import { loadAssistantMessages, sendAssistantMessage, transcribeAssistantVoice } from "./workspace-api";

const modelOptions: readonly { value: AssistantModel; label: string; description: string }[] = [
  { value: "flash", label: "Flash", description: "Быстрые ответы на повседневные вопросы" },
  { value: "pro", label: "Pro", description: "Сложный анализ и многошаговые задачи" },
  { value: "flash-lite", label: "Flash Lite", description: "Короткие и простые запросы" },
];

const MAX_COMPOSER_HEIGHT = 180;
const VOICE_LIMIT_MS = 60_000;
const quickPrompts = [
  "Что нового у меня за последнее время?",
  "Какие мои задачи требуют внимания?",
  "Расскажи о проектах движения «Юксалиш»",
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

export function YuksalishAssistant({ token }: { readonly token: string }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<readonly AssistantMessage[]>([]);
  const [model, setModel] = useState<AssistantModel>("flash");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState("");
  const [animatedReplyId, setAnimatedReplyId] = useState<string | null>(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (open && streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [messages, busy, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, open]);

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
    if (!value || busy) return;
    const temporaryId = `pending-${Date.now()}`;
    setMessages((current) => [...current, {
      id: temporaryId, role: "user", model, content: value,
      createdAt: new Date().toISOString(),
    }]);
    setDraft("");
    setBusy(true);
    setError("");
    try {
      const response = await sendAssistantMessage(token, model, value);
      setMessages((current) => [...current, response]);
      setAnimatedReplyId(response.id);
    } catch (failure) {
      setMessages((current) => current.filter((item) => item.id !== temporaryId));
      setDraft((current) => current ? `${value}\n${current}` : value);
      setError(failure instanceof Error ? failure.message : "Не удалось получить ответ. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const chosen = modelOptions.find((option) => option.value === model)!;
  const thinkingState = /юксалиш|yuksalish|источ|найди|поиск/i.test(messages.at(-1)?.content ?? "")
    ? "searching" : /задач|проект|заявк|анализ/i.test(messages.at(-1)?.content ?? "")
      ? "solving" : "composing";
  const compact = viewport.width <= 600;
  const edge = compact ? 8 : expanded ? 12 : 18;
  const panelWidth = expanded || compact ? viewport.width - edge * 2 : Math.min(460, viewport.width - 36);
  const panelHeight = expanded || compact ? viewport.height - edge * 2 : Math.min(670, viewport.height - 36);
  return <div className="yuksalish-assistant-root">
    {!open && <button type="button" className="assistant-launcher" ref={launcherRef}
      aria-label="Открыть ассистента Yuksalish" onClick={() => setOpen(true)}>
      <GradientOrb />
    </button>}
    <AnimatePresence onExitComplete={() => launcherRef.current?.focus()}>
      {open && <motion.section
        initial={reducedMotion ? false : { width: 72, height: 72, right: 12, bottom: 14, borderRadius: 36, opacity: 0.9 }}
        animate={{ width: panelWidth, height: panelHeight, right: edge, bottom: edge,
          borderRadius: expanded ? 22 : 26, opacity: 1 }}
        exit={reducedMotion ? { opacity: 0 } : { width: 72, height: 72, right: 12, bottom: 14,
          borderRadius: 36, opacity: 0.9 }}
        transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 330, damping: 34, mass: 1 }}
        onAnimationComplete={resizeInput}
        className={`assistant-panel ${expanded ? "is-expanded" : ""}`}
        role="dialog" aria-modal="false" aria-label="Ассистент Yuksalish">
        <motion.div className="assistant-panel-content"
          initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }}
          exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.18,
            delay: reducedMotion ? 0 : 0.15 }}>
        <header className="assistant-header">
          <span className="assistant-header-icon"><GradientOrb /></span>
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
              <GradientOrb />
              <h2>С чего начнём?</h2>
              <p>Помогу разобраться в рабочих делах, найти сведения о движении или улучшить текст.</p>
              <div className="assistant-quick-prompts">{quickPrompts.map((prompt) =>
                <button key={prompt} type="button" onClick={() => { setDraft(prompt); inputRef.current?.focus(); }}>
                  {prompt}
                </button>)}</div>
              <small>Рабочие данные — только в пределах ваших прав. Публичные материалы — с указанием источника.</small>
            </div>}
            {!loaded && !error && <div className="assistant-loading"><ThinkingOrb state="searching" /> Загружаю историю…</div>}
            {messages.map((item) => <article key={item.id} className={`assistant-message is-${item.role}`}>
              <span>{item.role === "user" ? "Вы" : "Yuksalish"}</span>
              {item.role === "assistant" ? <GeneratedReply content={item.content}
                animate={item.id === animatedReplyId} /> : <p>{item.content}</p>}
            </article>)}
            {busy && <div className="assistant-working"><ThinkingOrb state={thinkingState} />
              <span>{thinkingState === "searching" ? "Ищу источники…"
                : thinkingState === "solving" ? "Разбираюсь в деталях…" : "Готовлю ответ…"}</span>
            </div>}
          </div>
        </div>
        <div className="assistant-composer-area">
          <div className="assistant-composer-inner">
            <form className="assistant-composer" onSubmit={(event) => void send(event)}>
              <BorderBeam active={Boolean(draft.trim()) && !busy} />
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
                  <button type="button" className={`assistant-voice-button${recording ? " is-recording" : ""}`}
                    aria-label={recording ? "Остановить запись" : "Голосовой ввод"}
                    title={recording ? "Остановить запись" : "Голосовой ввод · до 1 минуты; аудио передаётся ИИ для расшифровки"}
                    disabled={transcribing || busy} onClick={() => void (recording ? stopRecording() : startRecording())}>
                    {recording ? <Square size={16} /> : <Mic size={19} />}
                  </button>
                  <button type="submit" className="assistant-send-button" aria-label="Отправить сообщение"
                    disabled={busy || recording || !draft.trim() || !loaded}>
                    <ArrowUp size={19} strokeWidth={2.4} />
                  </button>
                </div>
              </div>
            </form>
            {(recording || transcribing) && <div className="assistant-voice-status" role="status">
              <ThinkingOrb state="listening" size={20} />
              {recording ? "Слушаю… нажмите квадрат, чтобы закончить" : "Перевожу речь в текст…"}
            </div>}
            {error && <p className="assistant-error" role="alert">{error}</p>}
            <small className="assistant-privacy">Проверяйте важные сведения и даты публикаций.</small>
          </div>
        </div>
        </motion.div>
      </motion.section>}
    </AnimatePresence>
  </div>;
}
