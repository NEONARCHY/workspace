import type { ReactNode } from "react";
import type { MessageEntity, MessageQuote } from "@yuksalish/contracts";

export interface RichDocument { readonly text: string; readonly entities: readonly MessageEntity[] }
export const EMPTY_ENTITIES: readonly MessageEntity[] = [];
export function safeMessageUrl(url: string): string | undefined {
  if (Array.from(url).some(c => c.charCodeAt(0) <= 32)) return undefined;
  try { const parsed = new URL(url); return /^https?:$/u.test(parsed.protocol) && parsed.hostname ? url : undefined; }
  catch { return undefined; }
}
export function trimRichDocument(text: string, entities: readonly MessageEntity[]): RichDocument {
  const start = text.length - text.trimStart().length, end = text.trimEnd().length;
  return { text: text.trim(), entities: entities.flatMap(entity => {
    const left = Math.max(start, entity.offset), right = Math.min(end, entity.offset + entity.length);
    return right > left ? [{ ...entity, offset: left - start, length: right - left }] : [];
  }) };
}
export function richSegments(text: string, entities: readonly MessageEntity[] = EMPTY_ENTITIES) {
  const valid = entities.filter(e => Number.isInteger(e.offset) && Number.isInteger(e.length)
    && e.offset >= 0 && e.length > 0 && e.offset + e.length <= text.length
    && (e.type !== "link" || safeMessageUrl(e.url ?? "")));
  const points = [...new Set([0, text.length, ...valid.flatMap(e => [e.offset, e.offset + e.length])])].sort((a, b) => a - b);
  return points.slice(0, -1).map((start, i) => ({ start, text: text.slice(start, points[i + 1]),
    entities: valid.filter(e => e.offset <= start && e.offset + e.length >= points[i + 1]!) }));
}
export function RichMessageText({ text, entities }: { readonly text: string; readonly entities?: readonly MessageEntity[] }) {
  const groups = quoteGroups(text, entities);
  return <>{groups.map(group => {
    const children = group.segments.map(segment => {
    let content: ReactNode = segment.text;
    for (const kind of ["code", "bold", "italic", "underline", "strikethrough", "link"] as const) {
      const entity = segment.entities.find(e => e.type === kind);
      if (!entity) continue;
      switch (kind) {
        case "bold": content = <strong>{content}</strong>; break;
        case "italic": content = <em>{content}</em>; break;
        case "underline": content = <u>{content}</u>; break;
        case "strikethrough": content = <s>{content}</s>; break;
        case "code": content = <code>{content}</code>; break;
        case "link": content = <a href={entity.url} target="_blank" rel="noopener noreferrer">{content}</a>; break;
      }
    }
    return <span key={segment.start}>{content}</span>;
    });
    return <span key={group.segments[0]!.start} className={group.quoted ? "message-inline-quote" : undefined}>{children}</span>;
  })}</>;
}

function quoteGroups(text: string, entities?: readonly MessageEntity[]) {
  const groups: { quoted: boolean; segments: ReturnType<typeof richSegments> }[] = [];
  for (const segment of richSegments(text, entities)) {
    const quoted = segment.entities.some(e => e.type === "quote"), previous = groups.at(-1);
    if (previous?.quoted === quoted) previous.segments.push(segment);
    else groups.push({ quoted, segments: [segment] });
  }
  return groups;
}

interface Point { node: Node; offset: number }
/** A single serializer defines both text and selection offsets, including block newlines. */
export function readRichEditor(root: HTMLElement) {
  let text = "";
  const entities: MessageEntity[] = [];
  const positions = new Map<Node, { start: number; points: number[] }>();
  const textPoints: { node: Node; start: number; end: number }[] = [];
  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const start = text.length;
      text += node.textContent ?? "";
      positions.set(node, { start, points: [] });
      textPoints.push({ node, start, end: text.length });
      return;
    }
    if (!(node instanceof HTMLElement) || node.classList.contains("sr-only")) return;
    const block = node !== root && /^(DIV|P|BLOCKQUOTE)$/u.test(node.tagName);
    if (block && text && !text.endsWith("\n")) text += "\n";
    const start = text.length, points = [start];
    if (node.tagName === "BR") { if (node.nextSibling) text += "\n"; }
    else Array.from(node.childNodes).forEach(child => { walk(child); points.push(text.length); });
    positions.set(node, { start, points });
    const length = text.length - start;
    if (length) {
      const kinds: MessageEntity["type"][] = [];
      const style = node.style;
      if (/^(B|STRONG)$/u.test(node.tagName) || /^(bold|[6-9]00)$/u.test(style.fontWeight)) kinds.push("bold");
      if (/^(I|EM)$/u.test(node.tagName) || style.fontStyle === "italic") kinds.push("italic");
      if (node.tagName === "U" || style.textDecoration.includes("underline")) kinds.push("underline");
      if (/^(S|STRIKE|DEL)$/u.test(node.tagName) || style.textDecoration.includes("line-through")) kinds.push("strikethrough");
      if (node.tagName === "CODE" || /monospace/iu.test(style.fontFamily + (node.getAttribute("face") ?? ""))) kinds.push("code");
      if (node.tagName === "BLOCKQUOTE" || node.classList.contains("message-inline-quote")) kinds.push("quote");
      kinds.forEach(type => entities.push({ type, offset: start, length }));
      const url = node.tagName === "A" ? safeMessageUrl(node.getAttribute("href") ?? "") : undefined;
      if (url) entities.push({ type: "link", offset: start, length, url });
    }
    if (block && node.nextSibling && !text.endsWith("\n")) text += "\n";
  }
  walk(root);
  const offsetAt = (node: Node, offset: number) => {
    const position = positions.get(node);
    return position ? node.nodeType === Node.TEXT_NODE ? position.start + offset
      : (position.points[offset] ?? position.start) : undefined;
  };
  const pointAt = (offset: number): Point => {
    const point = textPoints.find(p => offset >= p.start && offset <= p.end) ?? textPoints.at(-1);
    return point ? { node: point.node, offset: Math.max(0, Math.min(offset - point.start, point.end - point.start)) }
      : { node: root, offset: 0 };
  };
  // Coalesce overlapping and adjacent identical marks; bound payload growth from editing.
  const merged: { type: MessageEntity["type"]; offset: number; length: number; url?: string }[] = [];
  for (const entity of entities.sort((a, b) => a.type.localeCompare(b.type) || (a.url ?? "").localeCompare(b.url ?? "") || a.offset - b.offset)) {
    const previous = merged.at(-1);
    if (previous && previous.type === entity.type && previous.url === entity.url && previous.offset + previous.length >= entity.offset)
      previous.length = Math.max(previous.offset + previous.length, entity.offset + entity.length) - previous.offset;
    else merged.push({ ...entity });
  }
  return { text, entities: merged, offsetAt, pointAt };
}
export function editorSelection(root: HTMLElement): MessageQuote | undefined {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return undefined;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined;
  const doc = readRichEditor(root), start = doc.offsetAt(range.startContainer, range.startOffset), end = doc.offsetAt(range.endContainer, range.endOffset);
  return start !== undefined && end !== undefined && end > start ? { offset: start, text: doc.text.slice(start, end) } : undefined;
}
export function setEditorSelection(root: HTMLElement, start: number, end = start) {
  const doc = readRichEditor(root), left = doc.pointAt(start), right = doc.pointAt(end), range = document.createRange();
  range.setStart(left.node, left.offset); range.setEnd(right.node, right.offset);
  const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
}
export function writeRichEditor(root: HTMLElement, text: string, entities: readonly MessageEntity[]) {
  const fragment = document.createDocumentFragment();
  for (const group of quoteGroups(text, entities)) {
    const parent = group.quoted ? document.createElement("span") : fragment;
    if (parent instanceof HTMLElement) parent.className = "message-inline-quote";
    for (const segment of group.segments) {
    let node: Node = document.createTextNode(segment.text);
    for (const entity of segment.entities) {
      if (entity.type === "quote") continue;
      const tags = { bold: "strong", italic: "em", underline: "u", strikethrough: "s", code: "code", quote: "span", link: "a" };
      const wrapper = document.createElement(tags[entity.type]);
      if (entity.type === "link") { wrapper.setAttribute("href", entity.url!); wrapper.setAttribute("target", "_blank"); wrapper.setAttribute("rel", "noopener noreferrer"); }
      wrapper.append(node); node = wrapper;
    }
      parent.append(node);
    }
    if (parent !== fragment) fragment.append(parent);
  }
  root.replaceChildren(fragment);
}
