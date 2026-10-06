import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@fluentui/react-components";
import { ArrowUndo20Regular, Dismiss20Regular } from "@fluentui/react-icons";
import "./undo-actions.css";

export const UNDO_DURATION_MS = 5_000;
interface UndoAction {
  readonly id: string;
  readonly scope: "notification" | "chat";
  readonly label: string;
  readonly commit: () => Promise<void>;
}
interface PendingAction extends UndoAction { readonly deadline: number; readonly committing: boolean }
function useUndoManager() {
  const [pending, setPending] = useState<readonly PendingAction[]>([]);
  const [error, setError] = useState("");
  const pendingRef = useRef<readonly PendingAction[]>([]);
  const alive = useRef(true);
  const update = (items: readonly PendingAction[]) => { pendingRef.current = items; setPending(items); };
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; pendingRef.current = []; };
  }, []);
  useEffect(() => {
    if (!pending.length) return;
    const timer = window.setInterval(() => {
      const due = pendingRef.current.filter(item => !item.committing && item.deadline <= Date.now());
      if (!due.length) return;
      update(pendingRef.current.map(item => due.includes(item) ? { ...item, committing: true } : item));
      for (const item of due) {
        void Promise.resolve().then(() => { if (alive.current) return item.commit(); }).catch((cause: unknown) => {
          if (alive.current) setError(cause instanceof Error ? cause.message : "Не удалось выполнить действие. Элемент восстановлен.");
        }).finally(() => {
          if (alive.current) update(pendingRef.current.filter(current => current !== item && !(current.scope === item.scope && current.id === item.id)));
        });
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [pending.length]);
  return {
    pending, error, clearError: () => setError(""),
    enqueue: (action: UndoAction) => {
      if (pendingRef.current.some(item => item.scope === action.scope && item.id === action.id)) return;
      setError("");
      update([...pendingRef.current, { ...action, deadline: Date.now() + UNDO_DURATION_MS, committing: false }]);
    },
    undo: (action: PendingAction) => {
      if (action.committing || action.deadline <= Date.now()) return;
      update(pendingRef.current.filter(item => item !== action));
    },
  };
}
type UndoManager = ReturnType<typeof useUndoManager>;
const UndoContext = createContext<UndoManager | null>(null);
export function UndoActionsProvider({ children }: { readonly children: ReactNode }) {
  const manager = useUndoManager();
  return <UndoContext.Provider value={manager}>{children}<UndoActionsToast manager={manager} /></UndoContext.Provider>;
}
// A local manager keeps isolated component tests and embedded QA usable, while
// the authenticated shell provides the persistent cross-section queue.
export function useUndoActions() {
  const shared = useContext(UndoContext);
  const local = useUndoManager();
  return { ...(shared ?? local), isShared: shared !== null };
}
export function UndoActionsToast({ manager }: { readonly manager: UndoManager }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!manager.pending.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [manager.pending.length]);
  return <aside className="workspace-undo-stack" aria-label="Отмена действий">
    {manager.pending.map(item => <div className="workspace-undo-toast" key={`${item.scope}:${item.id}`}>
      <ArrowUndo20Regular aria-hidden="true" />
      <div><strong role="status">{item.label}</strong><small>{item.committing ? "Сохраняем…" : `Можно отменить · ${Math.max(0, Math.min(5, Math.ceil((item.deadline - now) / 1_000)))} сек.`}</small></div>
      <Button size="small" appearance="primary" disabled={item.committing || item.deadline <= now} onClick={() => manager.undo(item)}>Вернуть</Button>
    </div>)}
    {manager.error ? <div className="workspace-undo-toast is-error" role="alert"><span>{manager.error}</span><Button size="small" appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть ошибку удаления" onClick={manager.clearError} /></div> : null}
  </aside>;
}
