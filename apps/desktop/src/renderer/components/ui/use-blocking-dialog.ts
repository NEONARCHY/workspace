import { useSyncExternalStore } from "react";

const selector = '[role="dialog"]:not(.assistant-panel), [role="alertdialog"], dialog[open], .account-scrim, .record-composer-backdrop, .fui-DialogSurface__backdrop';

export function hasBlockingDialog() {
  return Array.from(document.querySelectorAll<HTMLElement>(selector))
    .some((element) => !element.closest('[hidden], [aria-hidden="true"]')
      && element.style.display !== "none" && element.style.visibility !== "hidden");
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["role", "aria-hidden", "class", "hidden", "open"] });
  return () => observer.disconnect();
}

export function useBlockingDialog() {
  return useSyncExternalStore(subscribe, hasBlockingDialog, () => false);
}
