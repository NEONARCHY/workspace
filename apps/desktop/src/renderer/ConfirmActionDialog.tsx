import { useId, useState } from "react";
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
  readonly onExited?: () => void;
  readonly owner?: "assistant";
}

export function ConfirmActionDialog({ open, title, message, confirmLabel = "Удалить", busyLabel = "Удаляем…", busy = false, onCancel, onConfirm, onExited, owner }: ConfirmActionDialogProps) {
  const messageId = useId();
  const [content, setContent] = useState({ title, message, confirmLabel, busyLabel, busy });
  // Callers clear the target when closing; Fluent keeps its surface for exit
  // motion. Retain the last open content, updating before React commits so a
  // new action never paints stale text. No timer or presence lifecycle override.
  if (open && (content.title !== title || content.message !== message
    || content.confirmLabel !== confirmLabel || content.busyLabel !== busyLabel || content.busy !== busy)) {
    setContent({ title, message, confirmLabel, busyLabel, busy });
  }
  return <Dialog open={open} surfaceMotion={{ outScale: 1, inScale: 1, duration: 240, exitDuration: 160,
    easing: "cubic-bezier(0.2, 0, 0, 1)", exitEasing: "cubic-bezier(0.4, 0, 1, 1)",
    onMotionFinish: (_, data) => { if (data.direction === "exit") onExited?.(); } }}
    onOpenChange={(_, data) => { if (open && !data.open && !busy) onCancel(); }}>
    <DialogSurface className={`confirm-action-dialog${owner === "assistant" ? " assistant-owned-dialog" : ""}`}
      backdrop={owner === "assistant" ? { className: "assistant-owned-dialog" } : undefined}
      aria-describedby={messageId} aria-busy={content.busy}>
      <DialogBody>
        <DialogTitle>{content.title}</DialogTitle>
        <DialogContent id={messageId}>{content.message}</DialogContent>
        <DialogActions>
          <Button className="confirm-action-cancel" disabled={!open || content.busy} onClick={onCancel}>Отмена</Button>
          <Button className="confirm-action-danger" icon={<Delete24Regular />} disabled={!open || content.busy} onClick={() => { if (open && !busy) void onConfirm(); }}>{content.busy ? content.busyLabel : content.confirmLabel}</Button>
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
