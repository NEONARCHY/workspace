import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Maximize2, Minimize2, Send, Sparkles, X } from "lucide-react";

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

export function YuksalishAssistant({ token }: { readonly token: string }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<readonly AssistantMessage[]>([]);
  const [model, setModel] = useState<AssistantModel>("flash");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => launcherRef.current?.focus());
  }, []);

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
      setDraft("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не удалось получить ответ. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const chosen = modelOptions.find((option) => option.value === model)!;
  return <div className="yuksalish-assistant-root">
    {!open && <button type="button" className="assistant-launcher" ref={launcherRef}
      aria-label="Открыть ассистента Yuksalish" onClick={() => setOpen(true)}>
      <GradientOrb config={{ rotationSpeed: 0.28, noiseScale: 0.7 }} />
      <span className="assistant-launcher-mark" aria-hidden="true"><Sparkles size={18} /></span>
    </button>}
    <AnimatePresence>
      {open && <motion.section
        initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reducedMotion ? undefined : { opacity: 0, y: 8, scale: 0.99 }}
        transition={{ duration: reducedMotion ? 0 : 0.24 }}
        className={`assistant-panel ${expanded ? "is-expanded" : ""}`}
        role="dialog" aria-modal="false" aria-label="Ассистент Yuksalish">
        <header className="assistant-header">
          <span className="assistant-header-icon"><Sparkles size={18} /></span>
          <span className="assistant-header-title"><strong>Ассистент Yuksalish</strong><small>Ваш рабочий помощник</small></span>
          <button type="button" aria-label={expanded ? "Свернуть окно" : "Развернуть окно"}
            title={expanded ? "Свернуть окно" : "Развернуть окно"}
            onClick={() => setExpanded((current) => !current)}>
            {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button type="button" aria-label="Закрыть ассистента" title="Закрыть"
            onClick={close}><X size={19} /></button>
        </header>
        <div className="assistant-stream" ref={streamRef} aria-live="polite">
          <div className="assistant-stream-inner">
            {messages.length === 0 && loaded && <div className="assistant-empty">
              <GradientOrb />
              <h2>С чего начнём?</h2>
              <p>Спросите о своих задачах или попросите помочь с текстом и идеями.</p>
              <small>Для ответа по задачам Gemini получает только доступные вам сведения.</small>
            </div>}
            {!loaded && !error && <div className="assistant-loading"><ThinkingOrb state="searching" /> Загружаю историю…</div>}
            {messages.map((item) => <article key={item.id} className={`assistant-message is-${item.role}`}>
              <span>{item.role === "user" ? "Вы" : "Yuksalish"}</span>
              <p>{item.content}</p>
            </article>)}
            {busy && <div className="assistant-working"><ThinkingOrb state="working" /> Думаю над ответом…</div>}
          </div>
        </div>
        <div className="assistant-composer-area">
          <div className="assistant-composer-inner">
            <label className="assistant-model-label" htmlFor="assistant-model">Модель</label>
            <select id="assistant-model" value={model} disabled={busy}
              onChange={(event) => setModel(event.target.value as AssistantModel)}>
              {modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <span className="assistant-model-description">{chosen.description}</span>
            <form className="assistant-composer" onSubmit={(event) => void send(event)}>
              <BorderBeam active={!busy} />
              <textarea ref={inputRef} aria-label="Сообщение ассистенту" placeholder="Напишите сообщение…"
                value={draft} maxLength={4000} onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault(); event.currentTarget.form?.requestSubmit();
                  }
                }} />
              <button type="submit" aria-label="Отправить сообщение" disabled={busy || !draft.trim() || !loaded}>
                <Send size={18} />
              </button>
            </form>
            {error && <p className="assistant-error" role="alert">{error}</p>}
            <small className="assistant-privacy">Ответы ИИ могут ошибаться — проверяйте важные сведения.</small>
          </div>
        </div>
      </motion.section>}
    </AnimatePresence>
  </div>;
}
