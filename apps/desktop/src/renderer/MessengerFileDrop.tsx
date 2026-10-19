import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Attach24Regular } from "@fluentui/react-icons";
import "./messenger-file-drop.css";

const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

/** Keep outside drops inert even when no conversation is selected. */
export function useMessengerFileNavigationGuard(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const preventNavigation = (event: DragEvent) => { if (isFileDrag(event)) event.preventDefault(); };
    window.addEventListener("drop", preventNavigation);
    return () => window.removeEventListener("drop", preventNavigation);
  }, [enabled]);
}

/** The shared conversation is the only target, including embedded object chats. */
export function MessengerFileDropSurface({ children, className, title, blockedReason, receive, reject }: {
  readonly children: ReactNode;
  readonly className: string;
  readonly title: string;
  readonly blockedReason?: string;
  readonly receive: (files: readonly File[]) => boolean;
  readonly reject: (message: string) => void;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const [dragging, setDragging] = useState(false);
  const reason = blockedReason;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let depth = 0;
    let active = false;
    const clear = () => { depth = 0; active = false; setDragging(false); };
    const show = () => { if (!active) { active = true; setDragging(true); } };
    const enter = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault(); depth += 1; show();
    };
    const over = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = reason ? "none" : "copy";
      show();
    };
    const leave = (event: DragEvent) => {
      if (!active) return;
      depth = Math.max(0, depth - 1);
      if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) return;
      if (!depth) clear();
    };
    const drop = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault(); clear();
      if (reason || !event.dataTransfer) return;
      if (Array.from(event.dataTransfer.items ?? []).some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
        reject("Перетащите отдельные файлы или архив — загрузка папок не поддерживается.");
        return;
      }
      const files = Array.from(event.dataTransfer.files);
      if (!files.length) { reject("Не удалось прочитать файлы. Выберите их кнопкой вложения."); return; }
      receive(files);
    };
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData) return;
      // Search/filter/edit fields outside the composer keep their native paste.
      const target = event.target;
      if (target instanceof HTMLElement &&
          (target.matches("input, textarea") || target.isContentEditable) &&
          !target.closest(".composer-input")) return;
      const data = event.clipboardData;
      const items = Array.from(data.items ?? []);
      const files = Array.from(data.files ?? []);
      if (!files.length && !items.some(item => item.kind === "file") &&
          !Array.from(data.types ?? []).includes("Files")) return;
      // Consume file pastes even when blocked: never insert filesystem paths as text.
      event.preventDefault();
      if (reason) { reject(reason); return; }
      if (items.some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
        reject("Вставьте отдельные файлы или архив — загрузка папок не поддерживается.");
        return;
      }
      const pasted = files.length ? files : items.flatMap(item => {
        const file = item.kind === "file" ? item.getAsFile() : null;
        return file ? [file] : [];
      });
      if (!pasted.length) { reject("Не удалось прочитать файлы из буфера. Выберите их кнопкой вложения."); return; }
      receive(pasted);
    };
    // Never navigate away from Workspace if a file is released outside the target.
    const outsideDrop = (event: DragEvent) => { if (isFileDrag(event)) event.preventDefault(); clear(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") clear(); };
    root.addEventListener("dragenter", enter);
    root.addEventListener("dragover", over);
    root.addEventListener("dragleave", leave);
    root.addEventListener("drop", drop);
    root.addEventListener("paste", paste);
    window.addEventListener("drop", outsideDrop);
    window.addEventListener("dragend", clear);
    window.addEventListener("blur", clear);
    window.addEventListener("keydown", escape);
    return () => {
      root.removeEventListener("dragenter", enter);
      root.removeEventListener("dragover", over);
      root.removeEventListener("dragleave", leave);
      root.removeEventListener("drop", drop);
      root.removeEventListener("paste", paste);
      window.removeEventListener("drop", outsideDrop);
      window.removeEventListener("dragend", clear);
      window.removeEventListener("blur", clear);
      window.removeEventListener("keydown", escape);
      clear();
    };
  }, [receive, reject, reason]);
  return <section ref={rootRef} className={`${className} messenger-file-drop-surface`} aria-label={`Чат: ${title}`}
      data-file-drop={dragging ? reason ? "blocked" : "ready" : undefined}>
      {children}
      <div className="messenger-file-drop" aria-hidden={!dragging}>
        <div className="messenger-file-drop-copy" role="status" aria-live="polite">
          <span className="messenger-file-drop-icon" aria-hidden="true"><Attach24Regular /></span>
          <strong>{reason || "Отпустите файлы, чтобы прикрепить"}</strong>
          {!reason && <span>В чат «{title}»</span>}
          <small>{reason ? "Черновик и переписка останутся без изменений" : "Файлы появятся в черновике. Отправите их после проверки."}</small>
        </div>
      </div>
    </section>;
}
