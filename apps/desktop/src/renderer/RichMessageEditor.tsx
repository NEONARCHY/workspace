import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input } from "@fluentui/react-components";
import type { MessageEntity } from "@yuksalish/contracts";
import { MessageContextMenu, menuPortalContainerFor } from "./MessageContextMenu";
import { EMPTY_ENTITIES, editorSelection, readRichEditor, safeMessageUrl, setEditorSelection, writeRichEditor } from "./message-rich-text";

const formats = [
  ["bold", "Жирный", "Ctrl+B"], ["italic", "Курсив", "Ctrl+I"], ["underline", "Подчёркнутый", "Ctrl+U"],
  ["strikethrough", "Зачёркнутый", "Ctrl+Shift+X"], ["quote", "Цитата", "Ctrl+Shift+."],
  ["code", "Моноширинный", "Ctrl+Shift+M"], ["link", "Добавить ссылку", "Ctrl+K"],
] as const;
type Format = typeof formats[number][0] | "clear";
interface Props {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly value: string;
  readonly entities?: readonly MessageEntity[];
  readonly onChange: (text: string, entities: readonly MessageEntity[]) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly disabled?: boolean;
  readonly placeholder: string;
  readonly "aria-label": string;
  readonly style?: CSSProperties;
}

/** Native text entry + bounded document undo; only allowlisted marks cross the API. */
export function RichMessageEditor({ ref, value, entities = EMPTY_ENTITIES, onChange, onKeyDown, disabled, placeholder, style, "aria-label": label }: Props) {
  const composing = useRef(false);
  const savedSelection = useRef<{ offset: number; text: string } | undefined>(undefined);
  const [menu, setMenu] = useState<{ x: number; y: number; container: HTMLElement }>();
  const [linkOpen, setLinkOpen] = useState(false), [url, setUrl] = useState(""), [error, setError] = useState("");
  const before = useRef({ text: value, entities });
  type Snapshot = { text: string; entities: readonly MessageEntity[]; start: number; end: number };
  const historyRef = useRef<{ undo: Snapshot[]; redo: Snapshot[]; group: string; at: number }>({ undo: [], redo: [], group: "", at: 0 });
  const beforeSelection = useRef({ start: 0, end: 0 });
  function selectionRange() {
    const root = ref.current, selection = window.getSelection();
    if (!root || !selection?.rangeCount) return { start: value.length, end: value.length };
    const doc = readRichEditor(root), range = selection.getRangeAt(0);
    return { start: doc.offsetAt(range.startContainer, range.startOffset) ?? doc.text.length, end: doc.offsetAt(range.endContainer, range.endOffset) ?? doc.text.length };
  }
  function remember(group = "") {
    const history = historyRef.current, now = Date.now();
    if (!group || group !== history.group || now - history.at > 650) {
      history.undo.push({ ...before.current, ...beforeSelection.current });
      if (history.undo.length > 100) history.undo.shift();
    }
    history.group = group; history.at = now; history.redo = [];
  }
  function undo(redo = false) {
    const root = ref.current, history = historyRef.current;
    if (!root || disabled) return;
    const source = redo ? history.redo : history.undo, target = redo ? history.undo : history.redo;
    const previous = source.pop();
    if (!previous) return;
    target.push({ ...before.current, ...selectionRange() }); history.group = "";
    writeRichEditor(root, previous.text, previous.entities); setEditorSelection(root, previous.start, previous.end);
    before.current = previous; onChange(previous.text, previous.entities);
  }
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || composing.current) return;
    const current = readRichEditor(root);
    if (current.text !== value || JSON.stringify(current.entities) !== JSON.stringify(entities)) {
      const focused = document.activeElement === root;
      historyRef.current = { undo: [], redo: [], group: "", at: 0 };
      writeRichEditor(root, value, entities);
      if (focused) setEditorSelection(root, value.length);
    }
    before.current = { text: value, entities };
  }, [value, entities, ref]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(undefined);
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); restore(); } };
    window.addEventListener("pointerdown", close); window.addEventListener("blur", close); window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); window.removeEventListener("keydown", escape, true); };
    // restore reads the current saved range and editor, not render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);
  function restore() {
    const root = ref.current, selection = savedSelection.current;
    root?.focus();
    if (root && selection) setEditorSelection(root, selection.offset, selection.offset + selection.text.length);
  }
  function emit(group = "") {
    const root = ref.current;
    if (!root || composing.current) return;
    const doc = readRichEditor(root);
    if (doc.text.length > 20_000 || doc.entities.length > 128) {
      writeRichEditor(root, before.current.text, before.current.entities);
      setEditorSelection(root, before.current.text.length);
      setError("Не более 20 000 символов и 128 фрагментов форматирования"); return;
    }
    if (doc.text === before.current.text && JSON.stringify(doc.entities) === JSON.stringify(before.current.entities)) return;
    remember(group);
    setError(""); before.current = doc; onChange(doc.text, doc.entities);
  }
  function insertText(text: string) {
    const root = ref.current;
    if (!root || disabled) return;
    beforeSelection.current = selectionRange();
    const selectedLength = editorSelection(root)?.text.length ?? 0;
    if (readRichEditor(root).text.length - selectedLength + text.length > 20_000) { setError("Не более 20 000 символов в сообщении"); return; }
    if (document.execCommand) document.execCommand("insertText", false, text);
    else {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      range.deleteContents(); const node = document.createTextNode(text); range.insertNode(node);
      range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
    }
    emit();
  }
  function format(kind: Format, link?: string) {
    const root = ref.current, selection = savedSelection.current;
    if (!root || !selection?.text || disabled) return;
    if (kind === "link" && link !== undefined && !safeMessageUrl(link)) { setError("Укажите полную ссылку с http:// или https://"); return; }
    restore();
    if (kind === "link" && link === undefined) {
      const doc = readRichEditor(root);
      setUrl(doc.entities.find(e => e.type === "link" && e.offset <= selection.offset && e.offset + e.length >= selection.offset + selection.text.length)?.url ?? "https://");
      setError(""); setMenu(undefined); setLinkOpen(true); return;
    }
    const doc = readRichEditor(root), end = selection.offset + selection.text.length;
    const active = doc.entities.some(e => e.type === kind && e.offset <= selection.offset && e.offset + e.length >= end);
    const remaining = doc.entities.flatMap(e => {
      if ((kind !== "clear" && e.type !== kind) || e.offset >= end || e.offset + e.length <= selection.offset) return [e];
      return [e.offset < selection.offset ? { ...e, length: selection.offset - e.offset } : undefined,
        e.offset + e.length > end ? { ...e, offset: end, length: e.offset + e.length - end } : undefined].filter(e => e !== undefined);
    });
    if (kind !== "clear" && !active) remaining.push({ type: kind, offset: selection.offset, length: selection.text.length, ...(kind === "link" ? { url: link } : {}) });
    if (remaining.length > 128) { setError("Слишком много фрагментов форматирования"); return; }
    beforeSelection.current = { start: selection.offset, end };
    writeRichEditor(root, doc.text, remaining); restore();
    emit(); setMenu(undefined); setLinkOpen(false);
  }
  return <>
    <div ref={ref} className="composer-textarea composer-rich-editor" data-satin-surface="true" style={style}
      role="textbox" aria-multiline="true" aria-label={label} aria-disabled={disabled || undefined}
      aria-description="Enter — отправить. Ctrl+Enter или Shift+Enter — новая строка. Форматирование выделения: Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Shift+X, Ctrl+Shift+M, Ctrl+Shift+., Ctrl+K. Стрелка вверх — изменить последнее сообщение."
      data-placeholder={placeholder} data-empty={!value || undefined} contentEditable={!disabled} suppressContentEditableWarning spellCheck
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; emit(); }}
      onBeforeInput={event => {
        beforeSelection.current = selectionRange();
        const type = (event.nativeEvent as InputEvent).inputType;
        if (type === "historyUndo" || type === "historyRedo") { event.preventDefault(); undo(type === "historyRedo"); }
      }}
      onPointerDown={() => { historyRef.current.group = ""; }}
      onInput={event => {
        const input = event.nativeEvent as InputEvent;
        const group = input.inputType === "insertText" && input.data && !/\s/u.test(input.data) ? "typing"
          : input.inputType === "deleteContentBackward" ? "backspace" : "";
        emit(group);
      }}
      onPaste={event => {
        if (event.clipboardData.files.length || Array.from(event.clipboardData.items).some(item => item.kind === "file")) return;
        event.preventDefault(); insertText(event.clipboardData.getData("text/plain"));
      }}
      onDrop={event => { if (event.dataTransfer.types.includes("text/html")) event.preventDefault(); }}
      onKeyDown={event => {
        if (disabled || composing.current || event.nativeEvent.isComposing) return;
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          const root = ref.current;
          savedSelection.current = root ? editorSelection(root) : undefined;
          if (root && savedSelection.current) { event.preventDefault(); event.stopPropagation(); const rect = root.getBoundingClientRect(); setMenu({ x: rect.left + 12, y: rect.bottom, container: menuPortalContainerFor(root) }); return; }
        }
        if (/^(Arrow|Home|End|Page)/u.test(event.key)) historyRef.current.group = "";
        if ((event.ctrlKey || event.metaKey) && !event.altKey) {
          if (event.code === "KeyZ" || event.key.toLowerCase() === "z") { event.preventDefault(); undo(event.shiftKey); return; }
          if (event.code === "KeyY" || event.key.toLowerCase() === "y") { event.preventDefault(); undo(true); return; }
          const code = event.code || `Key${event.key.toUpperCase()}`;
          const kind: Format | undefined = event.shiftKey
            ? ({ KeyX: "strikethrough", KeyM: "code", Period: "quote", KeyN: "clear" } as const)[code as "KeyX"]
            : ({ KeyB: "bold", KeyI: "italic", KeyU: "underline", KeyK: "link" } as const)[code as "KeyB"];
          if (kind) { event.preventDefault(); savedSelection.current = ref.current ? editorSelection(ref.current) : undefined; format(kind); return; }
        }
        if (event.key === "Enter" && (event.ctrlKey || event.shiftKey) && !event.altKey && !event.metaKey) { event.preventDefault(); insertText("\n"); return; }
        onKeyDown(event);
      }}
      onContextMenu={event => {
        savedSelection.current = editorSelection(event.currentTarget);
        if (!savedSelection.current || disabled) return;
        event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, container: menuPortalContainerFor(event.currentTarget) });
      }} />
    {menu ? <MessageContextMenu x={menu.x} y={menu.y} portalContainer={menu.container} autoFocus onPointerDown={e => e.stopPropagation()}>
      {formats.map(([kind, title, hotkey]) => <Button key={kind} appearance="subtle" onClick={() => format(kind)}>{title}<kbd>{hotkey}</kbd></Button>)}
      <Button appearance="subtle" onClick={() => format("clear")}>Без форматирования<kbd>Ctrl+Shift+N</kbd></Button>
    </MessageContextMenu> : null}
    {linkOpen ? <Dialog open onOpenChange={(_, data) => { if (!data.open) { setLinkOpen(false); restore(); } }}>
      <DialogSurface aria-label="Ссылка на выделенный текст" className="composer-link-dialog"><DialogBody><DialogTitle>Добавить ссылку</DialogTitle><DialogContent>
        <Input autoFocus aria-label="Адрес ссылки" value={url} onChange={(_, data) => { setUrl(data.value); setError(""); }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); format("link", url); } }} />
        {error ? <p role="alert">{error}</p> : null}
      </DialogContent><DialogActions><Button onClick={() => { setLinkOpen(false); restore(); }}>Отмена</Button><Button appearance="primary" onClick={() => format("link", url)}>Применить</Button></DialogActions></DialogBody></DialogSurface>
    </Dialog> : error ? <span role="alert">{error}</span> : null}
  </>;
}
