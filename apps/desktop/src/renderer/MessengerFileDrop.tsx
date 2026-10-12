import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Attach24Regular } from "@fluentui/react-icons";
import "./messenger-file-drop.css";

const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

/** Keep outside drops inert even when no conversation is selected. */
export function useMessengerFileNavigationGuard() {
  useEffect(() => {
    const preventNavigation = (event: DragEvent) => { if (isFileDrag(event)) event.preventDefault(); };
    window.addEventListener("drop", preventNavigation);
    return () => window.removeEventListener("drop", preventNavigation);
  }, []);
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
    // Never navigate away from Workspace if a file is released outside the target.
    const outsideDrop = (event: DragEvent) => { if (isFileDrag(event)) event.preventDefault(); clear(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") clear(); };
    root.addEventListener("dragenter", enter);
    root.addEventListener("dragover", over);
    root.addEventListener("dragleave", leave);
    root.addEventListener("drop", drop);
    window.addEventListener("drop", outsideDrop);
    window.addEventListener("dragend", clear);
    window.addEventListener("blur", clear);
    window.addEventListener("keydown", escape);
    return () => {
      root.removeEventListener("dragenter", enter);
      root.removeEventListener("dragover", over);
      root.removeEventListener("dragleave", leave);
      root.removeEventListener("drop", drop);
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
