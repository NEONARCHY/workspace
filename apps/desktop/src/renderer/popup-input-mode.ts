/** Keep pointer hover separate from Fluent's retained virtual keyboard focus. */
export function observePopupInputMode(doc: Document = document) {
  const root = doc.documentElement;
  const previous = root.getAttribute("data-popup-input");
  const popup = ".fui-Listbox, .fui-MenuList, .identity-popover-actions, .browser-chat-actions-popover, .assistant-context-menu, .assistant-chat-options, .assistant-presets-list, .rail-ai-popover, .person-picker-list, .message-context-menu";
  let point: { x: number; y: number } | undefined;
  const setMode = (mode: "pointer" | "keyboard") => {
    if (root.dataset.popupInput !== mode) root.dataset.popupInput = mode;
  };
  const pointerDown = (event: PointerEvent) => {
    point = { x: event.clientX, y: event.clientY };
    setMode("pointer");
  };
  const pointerMove = (event: PointerEvent) => {
    const moved = !point || point.x !== event.clientX || point.y !== event.clientY;
    point = { x: event.clientX, y: event.clientY };
    // Layout changes can emit stationary pointer events; they must not steal keyboard focus.
    if (moved && event.target instanceof Element && event.target.closest(popup)) setMode("pointer");
  };
  const keyDown = (event: KeyboardEvent) => {
    if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) setMode("keyboard");
  };
  setMode("pointer");
  doc.addEventListener("pointerdown", pointerDown, true);
  doc.addEventListener("pointermove", pointerMove, true);
  doc.addEventListener("keydown", keyDown, true);
  return () => {
    doc.removeEventListener("pointerdown", pointerDown, true);
    doc.removeEventListener("pointermove", pointerMove, true);
    doc.removeEventListener("keydown", keyDown, true);
    if (previous === null) root.removeAttribute("data-popup-input");
    else root.setAttribute("data-popup-input", previous);
  };
}
