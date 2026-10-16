import { fireEvent } from "@testing-library/react";
import { expect } from "vitest";
import { readRichEditor } from "../message-rich-text";

/** Real contenteditable input events, while leaving ordinary form fields unchanged. */
export function changeField(element: HTMLElement, options: { target?: { value?: unknown; files?: readonly File[] }; [key: string]: unknown }) {
  if (element.hasAttribute("contenteditable") && typeof options.target?.value === "string") {
    element.textContent = options.target.value;
    fireEvent.input(element, { inputType: "insertText" });
  } else fireEvent.change(element, options);
}
export function editorCaret(element: HTMLElement) {
  const selection = window.getSelection();
  return selection?.anchorNode ? readRichEditor(element).offsetAt(selection.anchorNode, selection.anchorOffset) : undefined;
}
expect.extend({
  toHaveTextValue(element: HTMLElement, expected: unknown) {
    const actual = element.hasAttribute("contenteditable") ? readRichEditor(element).text
      : "value" in element ? element.value : undefined;
    return { pass: actual === expected, message: () => `Expected exact field text ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}` };
  },
});
declare module "vitest" {
  interface Assertion<T> { toHaveTextValue(expected: unknown): T }
}
