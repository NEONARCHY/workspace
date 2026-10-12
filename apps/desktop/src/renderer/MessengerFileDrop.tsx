import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Attach24Regular } from "@fluentui/react-icons";
import "./messenger-file-drop.css";

interface FileReceiver {
  readonly chatId: string;
  readonly title: string;
  readonly blockedReason?: string;
  readonly receive: (files: readonly File[]) => boolean;
  readonly reject: (message: string) => void;
}
const ReceiverContext = createContext<Dispatch<SetStateAction<FileReceiver | undefined>> | undefined>(undefined);

export function useMessengerFileReceiver(
  chatId: string, title: string, blockedReason: string | undefined,
  receive: FileReceiver["receive"], reject: FileReceiver["reject"],
) {
  const register = useContext(ReceiverContext);
  const receiver = useMemo(() => ({ chatId, title, blockedReason, receive, reject }), [chatId, title, blockedReason, receive, reject]);
  useEffect(() => {
    register?.(receiver);
    return () => register?.(current => current === receiver ? undefined : current);
  }, [register, receiver]);
}

const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

/** One native drop target covers both panes; internal chat-card drags remain untouched. */
export function MessengerFileDropSurface({ children, className, activeChatId, blockedReason, onAccepted }: {
  readonly children: ReactNode;
  readonly className: string;
  readonly activeChatId?: string;
  readonly blockedReason?: string;
  readonly onAccepted: () => void;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const [receiver, setReceiver] = useState<FileReceiver>();
  const [dragging, setDragging] = useState(false);
  const reason = blockedReason || (!receiver || receiver.chatId !== activeChatId
    ? "Сначала выберите чат для вложений" : receiver.blockedReason);
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
      if (reason || !receiver || !event.dataTransfer) return;
      if (Array.from(event.dataTransfer.items ?? []).some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
        receiver.reject("Перетащите отдельные файлы или архив — загрузка папок не поддерживается.");
        return;
      }
      const files = Array.from(event.dataTransfer.files);
      if (!files.length) { receiver.reject("Не удалось прочитать файлы. Выберите их кнопкой вложения."); return; }
      if (files.length && receiver.receive(files)) onAccepted();
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
  }, [receiver, reason, onAccepted]);
  return <ReceiverContext.Provider value={setReceiver}>
    <section ref={rootRef} className={className} aria-label="Мессенджер"
      data-file-drop={dragging ? reason ? "blocked" : "ready" : undefined}>
      {children}
      <div className="messenger-file-drop" aria-hidden={!dragging}>
        <div className="messenger-file-drop-copy" role="status" aria-live="polite">
          <span className="messenger-file-drop-icon" aria-hidden="true"><Attach24Regular /></span>
          <strong>{reason || "Отпустите файлы, чтобы прикрепить"}</strong>
          {!reason && <span>В чат «{receiver?.title}»</span>}
          <small>{reason ? "Черновик и переписка останутся без изменений" : "Файлы появятся в черновике. Отправите их после проверки."}</small>
        </div>
      </div>
    </section>
  </ReceiverContext.Provider>;
}
