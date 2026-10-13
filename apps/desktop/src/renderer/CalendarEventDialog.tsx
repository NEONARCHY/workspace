import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { Dismiss20Regular } from "@fluentui/react-icons";
import { WorkspaceDialog } from "./WorkspaceDialog";
import "./calendar-event-dialog.css";

export function CalendarEventDialog({ open, title, editing = false, busy = false, children, onClose, onExited }: {
  readonly open: boolean;
  readonly title: string;
  readonly editing?: boolean;
  readonly busy?: boolean;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly onExited?: () => void;
}) {
  const [content, setContent] = useState({ title, editing, children });
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (open) scrollRef.current?.scrollTo?.({ top: 0 });
  }, [open, title, editing]);
  // Keep the last open card intact during Fluent's exit animation, just like
  // ConfirmActionDialog. Fluent still owns presence, modal focus and restoration.
  if (open && (content.title !== title || content.editing !== editing || content.children !== children)) {
    setContent({ title, editing, children });
  }
  return <WorkspaceDialog open={open} onOpenChange={(_, data) => {
    // A backdrop click or Escape must not silently discard an edit in progress.
    if (!data.open && open && !editing && !busy) onClose();
  }} surfaceMotion={{ outScale: 1, inScale: 1, duration: 300, exitDuration: 180,
    easing: "cubic-bezier(0.2, 0, 0, 1)", exitEasing: "cubic-bezier(0.4, 0, 1, 1)",
    onMotionFinish: (_, data) => { if (data.direction === "exit") onExited?.(); } }}>
    <DialogSurface className="calendar-event-dialog" aria-label={content.title} aria-busy={busy}>
      <DialogBody>
        <div className="calendar-event-dialog-frame" inert={!open}>
        <header className="calendar-event-dialog-heading">
          <div><span>{content.editing ? "Редактирование события" : "Событие календаря"}</span>
            <DialogTitle>{content.title}</DialogTitle></div>
          <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label={content.editing ? "Закрыть форму" : "Закрыть событие"}
            disabled={!open || busy} onClick={onClose} />
        </header>
        <DialogContent ref={scrollRef} className="calendar-event-dialog-content">{content.children}</DialogContent>
        </div>
      </DialogBody>
    </DialogSurface>
  </WorkspaceDialog>;
}
