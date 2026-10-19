import { WorkspaceNotice } from "./WorkspaceNotice";
import { useEffect, useRef, useState } from "react";
import { Avatar, Button, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { Input } from "./WorkspaceInput";
import type { ChatMessage, ChatSummary, ForwardSource } from "@yuksalish/contracts";
import { WorkspaceDialog } from "./WorkspaceDialog";

export type ForwardContentAction = (chatId: string, source: ForwardSource, requestId: string) => Promise<ChatMessage | undefined>;

export function ForwardDialog({ source, sources, preview, chats, excludeChatId, onForward, onClose, onForwarded }: {
  readonly source: ForwardSource; readonly preview: string; readonly chats: readonly ChatSummary[];
  readonly sources?: readonly ForwardSource[]; readonly onForwarded?: () => void;
  readonly excludeChatId?: string; readonly onForward: ForwardContentAction; readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const requests = useRef(new Map<string, string>());
  const completed = useRef(new Set<string>());
  const [progress, setProgress] = useState(0);
  const items = sources?.length ? sources : [source];
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => () => {
    const target = returnFocus.current;
    window.requestAnimationFrame(() => { if (target?.isConnected) target.focus({ preventScroll: true }); });
  }, []);
  const targets = chats.filter(chat => chat.id !== excludeChatId && chat.permissions.sendMessages
    && chat.title.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")));
  const send = async (chatId: string) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    setProgress(items.filter(item => completed.current.has(`${chatId}:${item.kind}:${item.id}`)).length);
    try {
      for (const item of items) {
        const key = `${chatId}:${item.kind}:${item.id}`;
        if (completed.current.has(key)) continue;
        const requestId = requests.current.get(key) ?? crypto.randomUUID();
        requests.current.set(key, requestId);
        if (!await onForward(chatId, item, requestId)) throw new Error("Не удалось переслать. Повторите попытку.");
        completed.current.add(key);
        setProgress(items.filter(item => completed.current.has(`${chatId}:${item.kind}:${item.id}`)).length);
      }
      onForwarded?.();
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось переслать"); }
    finally { pending.current = false; setBusy(false); }
  };
  return <WorkspaceDialog open onOpenChange={(_, data) => { if (!data.open && !busy) onClose(); }}>
    <DialogSurface className="forward-dialog" aria-label={items.length > 1 ? "Переслать сообщения" : source.kind === "feed" ? "Переслать объявление" : "Переслать сообщение"}><DialogBody>
      <DialogTitle>Переслать в чат</DialogTitle>
      <DialogContent><p className="forward-dialog-preview">{preview.slice(0, 180)}</p>
        <Input aria-label="Найти чат для пересылки" placeholder="Найти чат" value={query} onChange={(_, data) => setQuery(data.value)} />
        <div className="forward-dialog-chats">
          {targets.map(chat => <button type="button" key={chat.id} disabled={busy} onClick={() => void send(chat.id)}>
            <Avatar name={chat.title} size={40} color="colorful" /><span><strong>{chat.title}</strong><small>{chat.kind === "direct" ? "Личный диалог" : "Рабочий чат"}</small></span>
          </button>)}
          {!targets.length && <p role="status">Нет доступных чатов для отправки</p>}
        </div>{busy && <p role="status">Пересылаем{items.length > 1 ? `: ${progress} из ${items.length}` : "…"}</p>}{error && <WorkspaceNotice tone="error" className="forward-error" role="alert">{items.length > 1 ? `Переслано ${progress} из ${items.length}. ` : ""}{error}</WorkspaceNotice>}
      </DialogContent><DialogActions><Button disabled={busy} onClick={onClose}>Отмена</Button></DialogActions>
    </DialogBody></DialogSurface>
  </WorkspaceDialog>;
}
