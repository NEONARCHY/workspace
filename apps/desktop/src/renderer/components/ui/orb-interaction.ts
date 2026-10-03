import type { RefObject } from "react";

// Returning focus from a dialog is not a fresh keyboard/pointer interaction.
export function attachOrbInteraction(element: HTMLElement, surface: HTMLElement, target: RefObject<number>) {
  let tabFocus = false;
  let keyboardFocused = false;
  const key = (event: KeyboardEvent) => { tabFocus = event.key === "Tab"; };
  const pointer = () => { tabFocus = false; keyboardFocused = false; };
  const consumedFocus = () => { tabFocus = false; };
  const focus = () => { keyboardFocused = tabFocus; target.current = keyboardFocused ? 1 : 0; };
  const blur = () => { keyboardFocused = false; target.current = 0; };
  const leave = () => { target.current = keyboardFocused && document.activeElement === surface ? 1 : 0; };
  const move = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const rect = element.getBoundingClientRect();
    const size = Math.max(1, Math.min(rect.width, rect.height));
    const x = (event.clientX - rect.left - rect.width / 2) * 2 / size;
    const y = (event.clientY - rect.top - rect.height / 2) * 2 / size;
    target.current = Math.hypot(x, y) < .8 ? 1 : 0;
  };
  document.addEventListener("keydown", key, true);
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("focusin", consumedFocus);
  surface.addEventListener("pointermove", move, { passive: true });
  surface.addEventListener("pointerleave", leave);
  surface.addEventListener("focus", focus);
  surface.addEventListener("blur", blur);
  return () => {
    document.removeEventListener("keydown", key, true);
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("focusin", consumedFocus);
    surface.removeEventListener("pointermove", move);
    surface.removeEventListener("pointerleave", leave);
    surface.removeEventListener("focus", focus);
    surface.removeEventListener("blur", blur);
    target.current = 0;
  };
}
