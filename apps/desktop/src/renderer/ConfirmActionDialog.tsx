import { useId } from "react";
import { Button, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { Delete24Regular } from "@fluentui/react-icons";

import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";

interface ConfirmActionDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly busyLabel?: string;
  readonly busy?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void | Promise<void>;
}

export function ConfirmActionDialog({ open, title, message, confirmLabel = "Удалить", busyLabel = "Удаляем…", busy = false, onCancel, onConfirm }: ConfirmActionDialogProps) {
  const messageId = useId();
  return <Dialog open={open} onOpenChange={(_, data) => { if (!data.open && !busy) onCancel(); }}>
    <DialogSurface className="confirm-action-dialog" aria-describedby={messageId} aria-busy={busy}>
      <DialogBody>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent id={messageId}>{message}</DialogContent>
        <DialogActions>
          <Button className="confirm-action-cancel" disabled={busy} onClick={onCancel}>Отмена</Button>
          <Button className="confirm-action-danger" icon={<Delete24Regular />} disabled={busy} onClick={() => void onConfirm()}>{busy ? busyLabel : confirmLabel}</Button>
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
