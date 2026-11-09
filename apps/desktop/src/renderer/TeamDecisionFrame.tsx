import { Suspense, useRef, useState, type ReactNode } from "react";
import { Button, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { WorkspaceDialog, focusWorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";

function DecisionStatus({ loading = false, onClose, onRetry }: {
  readonly loading?: boolean;
  readonly onClose: () => void;
  readonly onRetry: () => Promise<void>;
}) {
  const [open, setOpen] = useState(true);
  const surface = useRef<HTMLDivElement>(null);
  return <WorkspaceDialog open={open} onAfterOpen={() => focusWorkspaceDialog(surface.current)} onAfterClose={onClose} onOpenChange={(_, data) => setOpen(data.open)}>
    <DialogSurface ref={surface} className="team-decision-dialog">
      <DialogBody>
        <DialogTitle action={<Button appearance="subtle" onClick={() => setOpen(false)}>Закрыть</Button>}>{loading ? "Открываем запрос" : "Запрос недоступен"}</DialogTitle>
        <DialogContent>{loading ? <p role="status">Загружаем карточку и доступные действия…</p> : <WorkspaceNotice tone="warning" actions={<Button onClick={() => void onRetry()}>Обновить данные</Button>}>Запрос мог быть завершён, удалён или стать недоступным. Обновите данные, чтобы проверить его состояние.</WorkspaceNotice>}</DialogContent>
      </DialogBody>
    </DialogSurface>
  </WorkspaceDialog>;
}

export function TeamDecisionFrame({ active, available = true, onClose, onRetry, children }: {
  readonly active: boolean;
  readonly available?: boolean;
  readonly onClose: () => void;
  readonly onRetry: () => Promise<void>;
  readonly children: ReactNode;
}) {
  if (!active) return children;
  return <Suspense fallback={<DecisionStatus loading onClose={onClose} onRetry={onRetry} />}>
    {available ? children : <DecisionStatus onClose={onClose} onRetry={onRetry} />}
  </Suspense>;
}
