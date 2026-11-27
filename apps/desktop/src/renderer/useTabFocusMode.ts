import { useEffect } from "react";

let subscribers = 0;
let stop: (() => void) | undefined;

/** Focus still works normally; only Tab traversal opts into a visible keyboard ring. */
export function useTabFocusMode() {
  useEffect(() => {
    if (subscribers++ === 0) {
      const clear = () => document.documentElement.removeAttribute("data-workspace-tab-focus");
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey) {
          document.documentElement.setAttribute("data-workspace-tab-focus", "true");
        } else if (event.key === "Meta" || event.key === "OS") clear();
      };
      clear();
      document.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("pointerdown", clear, true);
      window.addEventListener("blur", clear);
      stop = () => {
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("pointerdown", clear, true);
        window.removeEventListener("blur", clear);
        clear();
      };
    }
    return () => {
      if (--subscribers === 0) { stop?.(); stop = undefined; }
    };
  }, []);
}
