import type { ReactNode } from "react";
import { Button, DrawerBody, DrawerHeader, DrawerHeaderTitle, OverlayDrawer } from "@fluentui/react-components";
import { Dismiss20Regular } from "@fluentui/react-icons";
import "./calendar-agenda-drawer.css";

export function CalendarAgendaDrawer({ open, children, onClose, onExited }: {
  readonly open: boolean;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly onExited: () => void;
}) {
  return <OverlayDrawer open={open} position="end" className="calendar-agenda-drawer"
    surfaceMotion={{ onMotionFinish: (_, data) => { if (data.direction === "exit") onExited(); } }}
    aria-label="Расписание выбранного дня" onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DrawerHeader>
      <DrawerHeaderTitle action={<Button appearance="subtle" icon={<Dismiss20Regular />}
        aria-label="Закрыть расписание" onClick={onClose} disabled={!open} />}>Расписание дня</DrawerHeaderTitle>
    </DrawerHeader>
    <DrawerBody className="calendar-agenda-drawer-body calendar-ux" inert={!open}>{children}</DrawerBody>
  </OverlayDrawer>;
}
