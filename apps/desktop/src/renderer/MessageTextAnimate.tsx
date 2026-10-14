import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { motion, type Variants } from "framer-motion";

// The owner's blurInUp preset, restricted to message text (never the chat canvas).
export const MESSAGE_TEXT_DURATION = 0.35;
const item: Variants = {
  // Relative inline offsets move only the painted text. Unlike inline-block
  // transforms, they preserve word breaking, line boxes and the timestamp float.
  hidden: { opacity: 0, filter: "blur(10px)", top: 20 },
  show: { opacity: 1, filter: "blur(0px)", top: 0, transition: { duration: MESSAGE_TEXT_DURATION } },
  exit: { opacity: 0, filter: "blur(10px)", top: 20, transition: { duration: MESSAGE_TEXT_DURATION } },
};

export function MessageTextAnimate({ children, enabled, disabled, outgoing = false, onComplete }: {
  readonly children: string;
  readonly enabled: boolean;
  readonly disabled: boolean;
  readonly outgoing?: boolean;
  readonly onComplete?: () => void;
}) {
  const [active, setActive] = useState(enabled && !disabled);
  if (disabled && active) setActive(false);
  if (!enabled || disabled || !active) return <>{children}</>;
  const segments = children.split(/(\s+)/u);
  const words = segments.filter(segment => segment && !/^\s+$/u.test(segment));
  // Bound the animated node count for 20,000-character messages; the remaining
  // text uses the same fade/blur without per-word transforms or layout changes.
  let wordIndex = 0;
  const cutoff = segments.findIndex(segment => segment && !/^\s+$/u.test(segment) && ++wordIndex > 160);
  const animatedSegments = cutoff < 0 ? segments : segments.slice(0, cutoff);
  const tail = cutoff < 0 ? "" : segments.slice(cutoff).join("");
  const variants: Variants = {
    hidden: { opacity: 1 },
    show: { opacity: 1, transition: { staggerChildren: MESSAGE_TEXT_DURATION / Math.max(1, Math.min(words.length, 160)) } },
    exit: { opacity: 1, transition: { staggerChildren: MESSAGE_TEXT_DURATION / Math.max(1, Math.min(words.length, 160)), staggerDirection: -1 } },
  };
  return <motion.span className="message-text-animate" data-text-animation={outgoing ? "exit" : "enter"}
    initial={outgoing ? "show" : "hidden"} animate={outgoing ? "exit" : "show"}
    variants={variants} onAnimationComplete={() => { setActive(false); onComplete?.(); }}>
    <span className="sr-only">{children}</span>
    <span aria-hidden="true">{animatedSegments.map((segment, index) => {
      if (!segment || /^\s+$/u.test(segment)) return segment;
      return <motion.span key={index} className="message-text-word" variants={item}>{segment}</motion.span>;
    })}{tail ? <motion.span className="message-text-tail" variants={{ hidden: { opacity: 0, filter: "blur(10px)" }, show: { opacity: 1, filter: "blur(0px)", transition: { duration: MESSAGE_TEXT_DURATION } }, exit: { opacity: 0, filter: "blur(10px)", transition: { duration: MESSAGE_TEXT_DURATION } } }}>{tail}</motion.span> : null}</span>
  </motion.span>;
}

export function ComposerSendTransition({ inputRef, text, scrollLeft, scrollTop = 0, disabled, onComplete }: {
  readonly inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  readonly text: string;
  readonly scrollLeft: number;
  readonly scrollTop?: number;
  readonly disabled: boolean;
  readonly onComplete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const completeRef = useRef(onComplete);
  useLayoutEffect(() => { completeRef.current = onComplete; }, [onComplete]);
  useEffect(() => {
    if (disabled) return;
    // Bound the decorative lifetime even if Chromium suppresses a completion
    // event while a frame is interrupted. Sending never waits for this timer.
    const timer = window.setTimeout(() => completeRef.current(), MESSAGE_TEXT_DURATION * 2000 + 100);
    return () => window.clearTimeout(timer);
  }, [disabled, text]);
  useLayoutEffect(() => {
    if (disabled) { onComplete(); return; }
    const input = inputRef.current;
    const overlay = ref.current;
    if (!input || !overlay) return;
    const style = getComputedStyle(input);
    const inputRect = input.getBoundingClientRect();
    const shellRect = overlay.parentElement!.getBoundingClientRect();
    overlay.style.left = `${inputRect.left - shellRect.left}px`;
    overlay.style.top = `${inputRect.top - shellRect.top}px`;
    overlay.style.width = `${inputRect.width}px`;
    overlay.style.height = `${inputRect.height}px`;
    overlay.style.font = style.font;
    overlay.style.padding = style.padding;
    overlay.style.whiteSpace = input.tagName === "TEXTAREA" ? "pre-wrap" : "pre";
    overlay.style.lineHeight = style.lineHeight;
  }, [disabled, inputRef, onComplete]);
  if (disabled) return null;
  return <div ref={ref} className="composer-send-text" aria-hidden="true">
    <span style={{ display: "block", transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }}>
      <MessageTextAnimate enabled disabled={false} outgoing onComplete={onComplete}>{text}</MessageTextAnimate>
    </span>
  </div>;
}
