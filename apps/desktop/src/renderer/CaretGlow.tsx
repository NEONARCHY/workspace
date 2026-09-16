import { useEffect, useRef } from "react";

const textInputTypes = new Set(["", "email", "password", "search", "tel", "text", "url"]);

function isTextEditor(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  if (target instanceof HTMLTextAreaElement) return !target.disabled && !target.readOnly;
  return target instanceof HTMLInputElement
    && textInputTypes.has(target.type)
    && !target.disabled
    && !target.readOnly;
}

const mirroredProperties = [
  "borderBottomWidth", "borderLeftWidth", "borderRightWidth", "borderTopWidth",
  "boxSizing", "fontFamily", "fontFeatureSettings", "fontKerning", "fontSize",
  "fontStretch", "fontStyle", "fontVariant", "fontWeight", "letterSpacing",
  "lineHeight", "paddingBottom", "paddingLeft", "paddingRight", "paddingTop",
  "textIndent", "textTransform", "wordSpacing",
] as const;

/**
 * A visual-only caret companion for text fields. Native selection and editing stay intact;
 * the overlay follows the collapsed selection without reading or storing field contents.
 */
export function WorkspaceCaret() {
  const caretRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const caret = caretRef.current;
    if (!caret) return;

    const mirror = document.createElement("div");
    const marker = document.createElement("span");
    mirror.className = "ws-caret-measure";
    marker.textContent = "\u200b";
    mirror.append(marker);
    document.body.append(mirror);

    let active: HTMLInputElement | HTMLTextAreaElement | undefined;
    let frame = 0;
    let revealTimer = 0;

    const hide = () => {
      window.clearTimeout(revealTimer);
      active?.classList.remove("ws-caret-managed");
      active = undefined;
      caret.classList.remove("is-visible");
    };

    const position = () => {
      frame = 0;
      const editor = active;
      if (!editor || document.activeElement !== editor) return hide();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      if (start === null || end === null || start !== end) {
        editor.classList.remove("ws-caret-managed");
        caret.classList.remove("is-visible");
        return;
      }

      const computed = getComputedStyle(editor);
      for (const property of mirroredProperties) mirror.style[property] = computed[property];
      mirror.style.width = `${editor.clientWidth}px`;
      mirror.style.height = editor instanceof HTMLTextAreaElement ? `${editor.clientHeight}px` : "auto";
      mirror.style.whiteSpace = editor instanceof HTMLTextAreaElement ? "pre-wrap" : "pre";
      mirror.style.overflowWrap = editor instanceof HTMLTextAreaElement ? "break-word" : "normal";

      const rawPrefix = editor.value.slice(0, start);
      const prefix = editor.type === "password" ? "•".repeat(rawPrefix.length) : rawPrefix;
      mirror.replaceChildren(document.createTextNode(prefix || "\u200b"), marker);

      const rect = editor.getBoundingClientRect();
      const lineHeight = Number.parseFloat(computed.lineHeight)
        || Number.parseFloat(computed.fontSize) * 1.25;
      const x = rect.left + marker.offsetLeft - editor.scrollLeft;
      const y = rect.top + marker.offsetTop - editor.scrollTop;
      const innerLeft = rect.left + Number.parseFloat(computed.paddingLeft || "0");
      const innerRight = rect.right - Number.parseFloat(computed.paddingRight || "0");

      if (x < innerLeft - 2 || x > innerRight + 2 || y < rect.top || y + lineHeight > rect.bottom + 2) {
        editor.classList.remove("ws-caret-managed");
        caret.classList.remove("is-visible");
        return;
      }

      editor.classList.add("ws-caret-managed");
      caret.style.setProperty("--ws-caret-x", `${Math.max(innerLeft, Math.min(x, innerRight))}px`);
      caret.style.setProperty("--ws-caret-y", `${y}px`);
      caret.style.setProperty("--ws-caret-height", `${Math.max(16, lineHeight)}px`);
      window.clearTimeout(revealTimer);
      revealTimer = window.setTimeout(() => caret.classList.add("is-visible"), 70);
    };

    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    const focusIn = (event: FocusEvent) => {
      if (!isTextEditor(event.target)) return;
      active?.classList.remove("ws-caret-managed");
      active = event.target;
      schedule();
    };
    const focusOut = (event: FocusEvent) => {
      if (event.target === active) hide();
    };
    const update = (event: Event) => {
      if (event.target === active) schedule();
    };

    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
    document.addEventListener("input", update);
    document.addEventListener("keyup", update);
    document.addEventListener("pointerup", update);
    document.addEventListener("selectionchange", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);

    return () => {
      hide();
      cancelAnimationFrame(frame);
      mirror.remove();
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
      document.removeEventListener("input", update);
      document.removeEventListener("keyup", update);
      document.removeEventListener("pointerup", update);
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
    };
  }, []);

  return <div ref={caretRef} className="ws-caret-line" aria-hidden="true" />;
}

/** @deprecated Use WorkspaceCaret. Kept to avoid breaking renderer-only imports. */
export const CaretGlow = WorkspaceCaret;
