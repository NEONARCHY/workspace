import { useCallback, useState, type RefObject, type SetStateAction } from "react";
import type { MessageEntity } from "@yuksalish/contracts";
import { EMPTY_ENTITIES, richSegments, type RichDocument } from "./message-rich-text";

export function useRichComposer(initial: string, revisionRef: RefObject<number>) {
  const [doc, setDoc] = useState<RichDocument>({ text: initial, entities: EMPTY_ENTITIES });
  const setDocument = useCallback((text: string, entities: readonly MessageEntity[]) => {
    revisionRef.current += 1; setDoc({ text, entities });
  }, [revisionRef]);
  const setText = useCallback((next: SetStateAction<string>) => {
    revisionRef.current += 1;
    setDoc(current => {
      const text = typeof next === "function" ? next(current.text) : next;
      // External replacements (mentions/AI) keep only unchanged prefix/suffix marks.
      let left = 0, right = 0;
      while (left < Math.min(text.length, current.text.length) && text[left] === current.text[left]) left++;
      while (right < Math.min(text.length, current.text.length) - left && text[text.length - right - 1] === current.text[current.text.length - right - 1]) right++;
      const oldEnd = current.text.length - right, delta = text.length - current.text.length;
      return { text, entities: current.entities.flatMap(e => {
        if (e.offset + e.length <= left) return [e];
        if (e.offset >= oldEnd) return [{ ...e, offset: e.offset + delta }];
        return [];
      }) };
    });
  }, [revisionRef]);
  return [doc.text, setText, doc.entities, setDocument] as const;
}
const DRAFT_PREFIX = "\u001eYUKSALISH-RICH-1:";
export function encodeRichDraft(text: string, entities: readonly MessageEntity[]) {
  return entities.length ? DRAFT_PREFIX + JSON.stringify({ text, entities }) : text;
}
export function decodeRichDraft(saved: string): RichDocument {
  if (saved.startsWith(DRAFT_PREFIX)) {
    try {
      const value = JSON.parse(saved.slice(DRAFT_PREFIX.length)) as RichDocument;
      if (typeof value.text === "string" && value.text.length <= 20_000 && Array.isArray(value.entities) && value.entities.length <= 128) {
        const entities = value.entities.filter(e => e && ["bold", "italic", "underline", "strikethrough", "code", "quote", "link"].includes(e.type));
        const valid = new Set(richSegments(value.text, entities).flatMap(s => s.entities));
        return { text: value.text, entities: entities.filter(e => valid.has(e)) };
      }
    } catch { /* Keep a damaged draft recoverable as text. */ }
  }
  return { text: saved, entities: EMPTY_ENTITIES };
}
