import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp, Maximize2, Minimize2, X } from "lucide-react";

import type { AssistantMessage, AssistantModel } from "@yuksalish/contracts";
import { BorderBeam } from "@/components/ui/border-beam";
import { GradientOrb } from "@/components/ui/gradient-orb";
import { ThinkingOrb } from "@/components/ui/thinking-orbs";
import { loadAssistantMessages, sendAssistantMessage } from "./workspace-api";

const modelOptions: readonly { value: AssistantModel; label: string; description: string }[] = [
  { value: "flash", label: "Flash", description: "Быстрые ответы на повседневные вопросы" },
  { value: "pro", label: "Pro", description: "Сложный анализ и многошаговые задачи" },
  { value: "flash-lite", label: "Flash Lite", description: "Короткие и простые запросы" },
];

const MAX_COMPOSER_HEIGHT = 180;

function GeneratedReply({ content, animate }: { readonly content: string; readonly animate: boolean }) {
  const reducedMotion = useReducedMotion();
  if (!animate || reducedMotion) return <p>{content}</p>;
  const words = content.match(/\S+\s*|\s+/g) ?? [content];
  return <p>{words.map((word, index) => <motion.span key={`${index}-${word}`}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
    transition={{ duration: 0.22, delay: Math.min(index * 0.018, 0.72) }}>
    {word}
  </motion.span>)}</p>;
}

export function YuksalishAssistant({ token }: { readonly token: string }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<readonly AssistantMessage[]>([]);
  const [model, setModel] = useState<AssistantModel>("flash");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [animatedReplyId, setAnimatedReplyId] = useState<string | null>(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const close = useCallback(() => {
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

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await sendAssistantMessage(token, model, value);
      setMessages((current) => [...current, {
        id: `user-${response.id}`, role: "user", model, content: value,
        createdAt: response.createdAt,
      }, response]);
      setAnimatedReplyId(response.id);
      setDraft("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не удалось получить ответ. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const chosen = modelOptions.find((option) => option.value === model)!;
  const compact = viewport.width <= 600;
  const edge = compact ? 8 : expanded ? 12 : 18;
  const panelWidth = expanded || compact ? viewport.width - edge * 2 : Math.min(460, viewport.width - 36);
  const panelHeight = expanded || compact ? viewport.height - edge * 2 : Math.min(670, viewport.height - 36);
  return <div className="yuksalish-assistant-root">
    {!open && <button type="button" className="assistant-launcher" ref={launcherRef}
      aria-label="Открыть ассистента Yuksalish" onClick={() => setOpen(true)}>
      <GradientOrb config={{ rotationSpeed: 0.75, noiseScale: 0.8 }} />
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
          <span className="assistant-header-icon"><GradientOrb config={{ rotationSpeed: 0.75 }} /></span>
          <span className="assistant-header-title"><strong>Ассистент Yuksalish</strong><small>Ваш рабочий помощник</small></span>
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
            {messages.length === 0 && loaded && <div className="assistant-empty">
              <GradientOrb config={{ rotationSpeed: 0.75, noiseScale: 0.8 }} />
              <h2>С чего начнём?</h2>
              <p>Спросите о своих задачах или попросите помочь с текстом и идеями.</p>
              <small>Для ответов о работе используются только доступные вам сведения.</small>
            </div>}
            {!loaded && !error && <div className="assistant-loading"><ThinkingOrb state="searching" /> Загружаю историю…</div>}
            {messages.map((item) => <article key={item.id} className={`assistant-message is-${item.role}`}>
              <span>{item.role === "user" ? "Вы" : "Yuksalish"}</span>
              {item.role === "assistant" ? <GeneratedReply content={item.content}
                animate={item.id === animatedReplyId} /> : <p>{item.content}</p>}
            </article>)}
            {busy && <div className="assistant-working"><ThinkingOrb state="working" /> Думаю над ответом…</div>}
          </div>
        </div>
        <div className="assistant-composer-area">
          <div className="assistant-composer-inner">
            <form className="assistant-composer" onSubmit={(event) => void send(event)}>
              <BorderBeam active={Boolean(draft.trim()) && !busy} />
              <textarea ref={inputRef} aria-label="Сообщение ассистенту" placeholder="Напишите сообщение…"
                value={draft} maxLength={4000} onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault(); event.currentTarget.form?.requestSubmit();
                  }
                }} />
              <div className="assistant-composer-toolbar">
                <div className="assistant-model-control">
                  <label className="assistant-model-label" htmlFor="assistant-model">Модель</label>
                  <select id="assistant-model" value={model} disabled={busy}
                    title={chosen.description}
                    onChange={(event) => setModel(event.target.value as AssistantModel)}>
                    {modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <span className="assistant-model-description">{chosen.description}</span>
                </div>
                <button type="submit" aria-label="Отправить сообщение" disabled={busy || !draft.trim() || !loaded}>
                  <ArrowUp size={19} strokeWidth={2.4} />
                </button>
              </div>
            </form>
            {error && <p className="assistant-error" role="alert">{error}</p>}
            <small className="assistant-privacy">Ответы ИИ могут ошибаться — проверяйте важные сведения.</small>
          </div>
        </div>
        </motion.div>
      </motion.section>}
    </AnimatePresence>
  </div>;
}
