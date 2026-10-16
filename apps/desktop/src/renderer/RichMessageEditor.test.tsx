import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageEntity } from "@yuksalish/contracts";
import { RichMessageEditor } from "./RichMessageEditor";
import { editorSelection, readRichEditor, RichMessageText, safeMessageUrl, setEditorSelection, trimRichDocument, writeRichEditor } from "./message-rich-text";
import { decodeRichDraft, encodeRichDraft } from "./useRichComposer";

function Fixture() {
  const ref = useRef<HTMLDivElement>(null), [text, setText] = useState("Тест 😀 текст"), [entities, setEntities] = useState<readonly MessageEntity[]>([]);
  return <FluentProvider theme={webLightTheme}><RichMessageEditor ref={ref} value={text} entities={entities} onChange={(value, marks) => { setText(value); setEntities(marks); }} onKeyDown={() => undefined} placeholder="Сообщение" aria-label="Редактор" /><output data-testid="entities">{JSON.stringify(entities)}</output></FluentProvider>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.getSelection()?.removeAllRanges(); });
describe("structured rich text", () => {
  it.each(["javascript:alert(1)", "file:///x", "data:text/html,x", "https://", "https://a.org/\n"])("rejects unsafe link %s", url => expect(safeMessageUrl(url)).toBeUndefined());
  it("round-trips overlapping marks, emoji and newlines without HTML injection", () => {
    const text = "A😀Б\n<script>", entities: MessageEntity[] = [{ type: "bold", offset: 0, length: 4 }, { type: "italic", offset: 1, length: 2 }, { type: "link", offset: 5, length: 8, url: "https://example.org" }];
    const root = document.createElement("div"); writeRichEditor(root, text, entities);
    const doc = readRichEditor(root);
    expect(doc.text).toBe(text); expect(doc.entities).toEqual(expect.arrayContaining(entities));
    expect(root.querySelector("script")).toBeNull();
    document.body.append(root); setEditorSelection(root, 1, 3);
    expect(editorSelection(root)).toEqual({ offset: 1, text: "😀" }); root.remove();
  });
  it("normalizes native block line breaks and keeps selection offsets", () => {
    const root = document.createElement("div"), first = document.createElement("div"), second = document.createElement("div");
    first.textContent = "Первая"; second.textContent = "Вторая"; root.append(first, second); document.body.append(root);
    expect(readRichEditor(root).text).toBe("Первая\nВторая"); setEditorSelection(root, 7, 13);
    expect(editorSelection(root)).toEqual({ offset: 7, text: "Вторая" }); root.remove();
  });
  it("renders one quote container across mixed inline formatting", () => {
    const entities: MessageEntity[] = [{ type: "quote", offset: 0, length: 6 }, { type: "bold", offset: 2, length: 2 }];
    const root = document.createElement("div"); writeRichEditor(root, "abcdef", entities);
    expect(root.querySelectorAll(".message-inline-quote")).toHaveLength(1);
    expect(readRichEditor(root).text).toBe("abcdef");
    expect(readRichEditor(root).entities).toEqual(expect.arrayContaining(entities));
    const { container } = render(<RichMessageText text="abcdef" entities={entities} />);
    expect(container.querySelectorAll(".message-inline-quote")).toHaveLength(1);
  });
  it("clips marks after trimming and preserves backward-compatible drafts", () => {
    const marks: MessageEntity[] = [{ type: "bold", offset: 0, length: 6 }];
    expect(trimRichDocument("  Тест  ", marks)).toEqual({ text: "Тест", entities: [{ type: "bold", offset: 0, length: 4 }] });
    expect(decodeRichDraft(encodeRichDraft("Текст", marks))).toEqual({ text: "Текст", entities: [] }); // invalid range is not restored
    const doc = { text: "Текст", entities: [{ type: "underline", offset: 0, length: 5 } as const] };
    expect(decodeRichDraft(encodeRichDraft(doc.text, doc.entities))).toEqual(doc);
    expect(decodeRichDraft("Старый черновик").text).toBe("Старый черновик");
  });
  it("renders only safe React text and links", () => {
    render(<RichMessageText text="<script>" entities={[{ type: "link", offset: 0, length: 8, url: "javascript:alert(1)" }]} />);
    expect(screen.getByText("<script>")).toBeInTheDocument(); expect(document.querySelector("script,a")).toBeNull();
  });
});
describe("message editor selection commands", () => {
  it("toggles only a selected subrange and undoes/redoes formatting with selection intact", () => {
    render(<Fixture />); const input = screen.getByRole("textbox", { name: "Редактор" }); input.focus(); setEditorSelection(input, 0, 4);
    fireEvent.keyDown(input, { code: "KeyB", key: "b", ctrlKey: true });
    setEditorSelection(input, 1, 3); fireEvent.keyDown(input, { code: "KeyB", key: "b", ctrlKey: true });
    expect(readRichEditor(input).entities).toEqual([{ type: "bold", offset: 0, length: 1 }, { type: "bold", offset: 3, length: 1 }]);
    fireEvent.keyDown(input, { code: "KeyZ", key: "z", ctrlKey: true });
    expect(readRichEditor(input).entities).toEqual([{ type: "bold", offset: 0, length: 4 }]);
    expect(editorSelection(input)).toEqual({ offset: 1, text: "ес" });
    fireEvent.keyDown(input, { code: "KeyZ", key: "z", ctrlKey: true, shiftKey: true });
    expect(readRichEditor(input).entities).toHaveLength(2);
  });
  it("keeps quote and monospace toggles restricted to the exact selection", () => {
    render(<Fixture />); const input = screen.getByRole("textbox", { name: "Редактор" }); input.focus(); setEditorSelection(input, 1, 3);
    for (const code of ["Period", "KeyM"]) fireEvent.keyDown(input, { code, key: code === "Period" ? "." : "m", ctrlKey: true, shiftKey: true });
    expect(readRichEditor(input).entities).toEqual(expect.arrayContaining([{ type: "quote", offset: 1, length: 2 }, { type: "code", offset: 1, length: 2 }]));
    fireEvent.keyDown(input, { code: "KeyM", key: "m", ctrlKey: true, shiftKey: true });
    expect(readRichEditor(input).entities).toEqual([{ type: "quote", offset: 1, length: 2 }]);
    fireEvent.keyDown(input, { code: "KeyN", key: "n", ctrlKey: true, shiftKey: true }); expect(readRichEditor(input).entities).toEqual([]);
  });
  it.each([
    ["KeyB", false, "bold"], ["KeyI", false, "italic"], ["KeyU", false, "underline"],
    ["KeyX", true, "strikethrough"], ["KeyM", true, "code"], ["Period", true, "quote"],
  ] as const)("formats selected text with %s, not the whole draft", (code, shiftKey, type) => {
    render(<Fixture />); const input = screen.getByRole("textbox", { name: "Редактор" }); input.focus(); setEditorSelection(input, 0, 4);
    fireEvent.keyDown(input, { code, key: code === "Period" ? "." : code.slice(3), ctrlKey: true, shiftKey });
    expect(JSON.parse(screen.getByTestId("entities").textContent!)).toContainEqual({ type, offset: 0, length: 4 });
    expect(readRichEditor(input).text).toBe("Тест 😀 текст");
  });
  it("opens formatting beside the selected text, applies a mark and restores focus", () => {
    render(<Fixture />); const input = screen.getByRole("textbox", { name: "Редактор" }); input.focus(); setEditorSelection(input, 5, 7);
    fireEvent.contextMenu(input, { clientX: 70, clientY: 90 });
    fireEvent.click(screen.getByRole("button", { name: /Жирный/ }));
    expect(readRichEditor(input).entities).toContainEqual({ type: "bold", offset: 5, length: 2 }); expect(input).toHaveFocus();
  });
  it("validates hyperlinks, and cancellation leaves the draft and selection intact", () => {
    render(<Fixture />); const input = screen.getByRole("textbox", { name: "Редактор" }); input.focus(); setEditorSelection(input, 0, 4);
    fireEvent.keyDown(input, { key: "k", code: "KeyK", ctrlKey: true });
    const link = screen.getByRole("textbox", { name: "Адрес ссылки" }); fireEvent.change(link, { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Применить" })); expect(screen.getByRole("alert")).toHaveTextContent("http://");
    fireEvent.change(link, { target: { value: "https://example.org" } }); fireEvent.click(screen.getByRole("button", { name: "Применить" }));
    expect(readRichEditor(input).entities).toContainEqual({ type: "link", offset: 0, length: 4, url: "https://example.org" });
    setEditorSelection(input, 0, 4); fireEvent.keyDown(input, { key: "k", code: "KeyK", ctrlKey: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Адрес ссылки" }), { target: { value: "https://example.org/updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Применить" }));
    expect(readRichEditor(input).entities).toContainEqual({ type: "link", offset: 0, length: 4, url: "https://example.org/updated" });
    setEditorSelection(input, 5, 7); fireEvent.keyDown(input, { key: "k", code: "KeyK", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Отмена" })); expect(editorSelection(input)).toEqual({ offset: 5, text: "😀" });
  });
  it("pastes literal text, ignores formatting hotkeys during IME and keeps Ctrl+Enter inside the draft", () => {
    render(<Fixture />); const input = screen.getByRole("textbox", { name: "Редактор" }); input.focus(); setEditorSelection(input, 0, 4);
    fireEvent.keyDown(input, { code: "KeyB", ctrlKey: true, isComposing: true }); expect(readRichEditor(input).entities).toEqual([]);
    fireEvent.paste(input, { clipboardData: { files: [], items: [], getData: () => "<b>текст</b>" } }); expect(input.querySelector("b")).toBeNull();
    expect(readRichEditor(input).text).toBe("<b>текст</b> 😀 текст");
    setEditorSelection(input, 11); fireEvent.keyDown(input, { key: "Enter", ctrlKey: true }); expect(readRichEditor(input).text).toContain("\n");
  });
});
