import { Button, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { ChevronDown16Regular, Person20Regular, Settings20Regular, SignOut20Regular } from "@fluentui/react-icons";
import { useRef, useState } from "react";
import type { WorkspacePerson } from "@yuksalish/contracts";
import { ProfileAvatar } from "./ProfileAvatar";
import { ReleaseHistoryDialog } from "./ReleaseHistoryDialog";

export interface ProfilePanelAnchor {
  readonly offsetRight: number;
  readonly originRight: number;
  readonly top: number;
}

export function WorkspaceIdentity({ person, token, onProfile, onSettings, onLogout }: { person: WorkspacePerson; token: string; onProfile?: () => void; onSettings: (anchor: ProfilePanelAnchor) => void; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = (afterClose?: () => void) => {
    setOpen(false);
    afterClose?.();
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
    setOpen(false);
  };
  return <div className={`workspace-identity${open ? " is-open" : ""}`}>
    <button className="workspace-identity-profile" type="button" aria-label={`Открыть профиль: ${person.name}`} onClick={onProfile}>
      <ProfileAvatar person={person} token={token} size={32} /><span>{person.name}</span>
    </button>
    <Popover open={open} onOpenChange={(_event, data) => {
      setOpen(data.open);
    }} positioning="below-end" withArrow>
      <PopoverTrigger disableButtonEnhancement><button ref={triggerRef} className="workspace-identity-menu" type="button" aria-label="Меню профиля"><ChevronDown16Regular /></button></PopoverTrigger>
      <PopoverSurface className={`identity-popover${open ? "" : " is-closed"}`}>
        {open ? <>
        <button className="identity-popover-profile" type="button" onClick={() => close(onProfile)}><span className="identity-popover-avatar"><ProfileAvatar person={person} token={token} size={48} /></span><span><h3>{person.name}</h3><p>{person.jobTitle ?? person.role}</p></span></button>
        <div className="identity-popover-actions">
          {onProfile ? <Button appearance="subtle" icon={<Person20Regular />} onClick={() => close(onProfile)}>Открыть рабочий профиль</Button> : null}
          <Button appearance="subtle" icon={<Settings20Regular />} onClick={openSettings}>Настройки профиля</Button>
          <Button className="identity-signout" appearance="subtle" icon={<SignOut20Regular />} onClick={() => close(onLogout)}>Выйти</Button>
        </div>
        </> : null}
      </PopoverSurface>
    </Popover>
  </div>;
}

export function ConnectionIndicator({ detail, error, updateAvailable = false }: { detail: string; error: boolean; updateAvailable?: boolean }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  return <>
    <Popover open={popoverOpen} onOpenChange={(_event, data) => setPopoverOpen(data.open)} positioning="below-end">
      <PopoverTrigger disableButtonEnhancement><button type="button" className={`connection-indicator ${error ? "has-error" : ""}`} aria-label={`Подключение: ${detail}`}><i /><span>{detail}</span></button></PopoverTrigger>
      <PopoverSurface className="connection-popover">
        <strong>Связь с рабочим сервером</strong><p>{detail}</p>
        <small>Изменения появляются в рабочем пространстве после подтверждения сервером.</small>
        {updateAvailable ? <Button appearance="primary" onClick={() => { setPopoverOpen(false); window.dispatchEvent(new Event("yuksalish:show-web-update")); }}>Обновить</Button> : null}
        <Button appearance="subtle" onClick={() => { setPopoverOpen(false); setHistoryOpen(true); }}>Ранние обновления</Button>
      </PopoverSurface>
    </Popover>
    <ReleaseHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
  </>;
}
