import { Button, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { ChevronDown16Regular, Settings20Regular, SignOut20Regular } from "@fluentui/react-icons";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { WorkspacePerson } from "@yuksalish/contracts";
import { ProfileAvatar } from "./ProfileAvatar";
import { ReleaseHistoryDialog } from "./ReleaseHistoryDialog";

export interface ProfilePanelAnchor {
  readonly offsetRight: number;
  readonly originRight: number;
  readonly top: number;
}

export function WorkspaceIdentity({ person, token, onSettings, onLogout }: { person: WorkspacePerson; token: string; onSettings: (anchor: ProfilePanelAnchor) => void; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [originRight, setOriginRight] = useState(24);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef(0);
  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);
  const close = (afterClose?: () => void) => {
    window.clearTimeout(closeTimerRef.current);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setOpen(false);
      setClosing(false);
      afterClose?.();
      return;
    }
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      afterClose?.();
    }, 180);
  };
  const openSettings = () => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (bounds) {
      onSettings({
        top: bounds.bottom + 8,
        offsetRight: Math.max(10, window.innerWidth - bounds.right),
        originRight: bounds.width / 2,
      });
    } else {
      onSettings({ top: 72, offsetRight: 18, originRight: 24 });
    }
    close();
  };
  return <Popover open={open} onOpenChange={(_event, data) => {
    if (data.open) { setOriginRight((triggerRef.current?.getBoundingClientRect().width ?? 48) / 2); setOpen(true); setClosing(false); }
    else if (open && !closing) close();
  }} positioning="below-end" withArrow>
    <PopoverTrigger disableButtonEnhancement><button ref={triggerRef} className={`workspace-identity${open ? " is-open" : ""}`} type="button" aria-label={`Профиль: ${person.name}`}><ProfileAvatar person={person} token={token} size={32} /><span>{person.name}</span><ChevronDown16Regular /></button></PopoverTrigger>
    <PopoverSurface style={{ "--identity-origin-right": `${originRight}px` } as CSSProperties} className={`identity-popover${open ? "" : " is-closed"}${closing ? " is-closing" : " is-opening"}`}>
      {open ? <>
      <div className="identity-popover-profile"><span className="identity-popover-avatar"><ProfileAvatar person={person} token={token} size={48} /></span><span><h3>{person.name}</h3><p>{person.jobTitle ?? person.role}</p></span></div>
      <div className="identity-popover-actions">
        <Button appearance="subtle" icon={<Settings20Regular />} onClick={openSettings}>Настройки профиля</Button>
        <Button className="identity-signout" appearance="subtle" icon={<SignOut20Regular />} onClick={() => close(onLogout)}>Выйти</Button>
      </div>
      </> : null}
    </PopoverSurface>
  </Popover>;
}

export function ConnectionIndicator({ detail, error }: { detail: string; error: boolean }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  return <>
    <Popover open={popoverOpen} onOpenChange={(_event, data) => setPopoverOpen(data.open)} positioning="below-end" withArrow>
      <PopoverTrigger disableButtonEnhancement><button type="button" className={`connection-indicator ${error ? "has-error" : ""}`} aria-label={`Подключение: ${detail}`}><i /><span>{detail}</span></button></PopoverTrigger>
      <PopoverSurface className="connection-popover">
        <strong>Связь с рабочим сервером</strong><p>{detail}</p>
        <small>Изменения появляются в рабочем пространстве после подтверждения сервером.</small>
        <Button appearance="subtle" onClick={() => { setPopoverOpen(false); setHistoryOpen(true); }}>Ранние обновления</Button>
      </PopoverSurface>
    </Popover>
    <ReleaseHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
  </>;
}
